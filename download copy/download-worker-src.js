/* download-worker-src.js — SOURCE FILE, do not load directly.
   Build with: npm run build  →  produces download-worker.js
   JSZip is bundled at build time; no CDN dependency at runtime.

   Receives: { cmd: 'download', images: [{filename, urls}], options }
   Posts back: progress events and final blob(s).
*/

import JSZip from 'jszip';

function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 100);
}

async function tryFetchArrayBuffer(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { mode: 'cors', signal: controller.signal });
    clearTimeout(id);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.arrayBuffer();
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

self.addEventListener('message', async (ev) => {
  const data = ev.data || {};
  if (data.cmd !== 'download') return;

  const images = data.images || [];
  const options = data.options || {};

  const shouldChunk = options.shouldChunk && options.chunkSize && options.chunkSize > 0;
  const chunkSize = shouldChunk ? options.chunkSize : images.length;

  const chunks = [];
  for (let i = 0; i < images.length; i += chunkSize) {
    chunks.push(images.slice(i, i + chunkSize));
  }

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const zip = new JSZip();
    let count = 0;
    let errors = 0;

    for (let i = 0; i < chunk.length; i++) {
      const img = chunk[i];
      const filename = sanitizeFilename(img.filename || img.label || `image_${i + 1}`);
      let success = false;

      for (const url of (img.urls || [])) {
        try {
          const buf = await tryFetchArrayBuffer(url, options.timeoutMs || 30000);
          if (buf && buf.byteLength > 5000) {
            zip.file(filename, buf, { binary: true });
            success = true;
            break;
          }
        } catch (_) {
          // try next URL
        }
      }

      if (!success) errors++;
      count++;
      self.postMessage({
        status: 'progress',
        completed: count,
        total: chunk.length,
        failed: errors,
        current: filename,
        chunkIndex: c + 1,
        totalChunks: chunks.length,
      });
    }

    try {
      const blob = await zip.generateAsync({ type: 'blob' });
      const chunkName = shouldChunk
        ? `images_chunk_${String(c + 1).padStart(3, '0')}.zip`
        : (options.outputName || 'selected_images.zip');
      self.postMessage({
        status: 'done',
        blob,
        chunkIndex: c + 1,
        totalChunks: chunks.length,
        name: chunkName,
        downloaded: chunk.length - errors,
        failed: errors,
      });
    } catch (e) {
      self.postMessage({ status: 'error', message: String(e), chunkIndex: c + 1 });
    }
  }
});
