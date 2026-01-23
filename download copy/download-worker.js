/* download-worker.js
   Runs in a Web Worker. Receives a message with { cmd: 'download', images: [{filename, urls}], options }
   Uses importScripts to load JSZip and creates a zip blob, posting progress and final blob back.
*/

importScripts('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');

function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:\"/\\|?*]/g, '_')
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
    const buf = await resp.arrayBuffer();
    return buf;
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

  // Split into chunks
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

      for (let j = 0; j < (img.urls || []).length; j++) {
        const url = img.urls[j];
        try {
          const buf = await tryFetchArrayBuffer(url, options.timeoutMs || 30000);
          if (buf && buf.byteLength > 5000) {
            zip.file(filename, buf, { binary: true });
            success = true;
            break;
          }
        } catch (e) {
          // ignore and try next URL
        }
      }

      if (!success) errors++;
      count++;
      // Post progress for this chunk
      self.postMessage({ status: 'progress', completed: count, total: chunk.length, failed: errors, current: filename, chunkIndex: c + 1, totalChunks: chunks.length });
    }

    try {
      const blob = await zip.generateAsync({ type: 'blob' });
      const chunkName = shouldChunk ? `images_chunk_${String(c + 1).padStart(3, '0')}.zip` : (options.outputName || 'selected_images.zip');
      // Transfer the blob back to main thread with metadata
      self.postMessage({ status: 'done', blob, chunkIndex: c + 1, totalChunks: chunks.length, name: chunkName, downloaded: chunk.length - errors, failed: errors }, [blob]);
    } catch (e) {
      self.postMessage({ status: 'error', message: String(e), chunkIndex: c + 1 });
    }
  }
});
