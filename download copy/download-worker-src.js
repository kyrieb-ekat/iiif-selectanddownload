/* download-worker-src.js — SOURCE FILE, do not load directly.
   Build with: npm run build  →  produces download-worker.js
   JSZip is bundled at build time; no CDN dependency at runtime.

   Receives:
     { cmd: 'download', images: [{filename, urls, cacheKey}], options }
     { cmd: 'pause' }
     { cmd: 'clear-cache' }
   Posts back: progress events, paused status, and final blob(s).
*/

import JSZip from 'jszip';

// ─── IndexedDB cache ─────────────────────────────────────────────────────────

let _db = null;

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('iiif-blob-cache', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('blobs')) {
        d.createObjectStore('blobs', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

async function cacheGet(key) {
  try {
    const db = await openDB();
    return new Promise(resolve => {
      const req = db.transaction('blobs', 'readonly').objectStore('blobs').get(key);
      req.onsuccess = () => resolve(req.result?.buf ?? null);
      req.onerror   = () => resolve(null);
    });
  } catch { return null; }
}

async function cachePut(key, buf) {
  try {
    const db = await openDB();
    await new Promise(resolve => {
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put({ key, buf, ts: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror    = resolve; // non-fatal
    });
  } catch { /* non-fatal */ }
}

async function clearCache() {
  try {
    const db = await openDB();
    await new Promise(resolve => {
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').clear();
      tx.oncomplete = resolve;
      tx.onerror    = resolve;
    });
  } catch {}
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

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

// ─── Pause flag ───────────────────────────────────────────────────────────────

let pauseRequested = false;

// ─── Message handler ──────────────────────────────────────────────────────────

self.addEventListener('message', async (ev) => {
  const data = ev.data || {};

  if (data.cmd === 'pause') {
    pauseRequested = true;
    return;
  }

  if (data.cmd === 'clear-cache') {
    await clearCache();
    self.postMessage({ status: 'cache-cleared' });
    return;
  }

  if (data.cmd !== 'download') return;

  pauseRequested = false;

  const images  = data.images  || [];
  const options = data.options || {};

  const shouldChunk = options.shouldChunk && options.chunkSize && options.chunkSize > 0;
  const chunkSize = shouldChunk ? options.chunkSize : images.length;

  const chunks = [];
  for (let i = 0; i < images.length; i += chunkSize) {
    chunks.push(images.slice(i, i + chunkSize));
  }

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const zip   = new JSZip();
    let count = 0, errors = 0, fromCache = 0;

    for (let i = 0; i < chunk.length; i++) {

      // ── Pause between images ──
      if (pauseRequested) {
        const downloaded = count - errors;
        let partialBlob = null;
        if (downloaded > 0) {
          try { partialBlob = await zip.generateAsync({ type: 'blob' }); } catch (_) {}
        }
        self.postMessage({
          status:          'paused',
          partialBlob,
          partialCount:    downloaded,
          completed:       count,
          failed:          errors,
          remaining:       chunk.slice(i),
          remainingChunks: chunks.slice(c + 1).flat(),
        });
        return;
      }

      const img      = chunk[i];
      const filename = sanitizeFilename(img.filename || img.label || `image_${i + 1}`);
      const cacheKey = img.cacheKey || filename;
      let   success  = false;

      // ── Cache-first fetch ──
      const cached = await cacheGet(cacheKey);
      if (cached && cached.byteLength > 5000) {
        zip.file(filename, cached, { binary: true });
        success = true;
        fromCache++;
      } else {
        for (const url of (img.urls || [])) {
          try {
            const buf = await tryFetchArrayBuffer(url, options.timeoutMs || 30000);
            if (buf && buf.byteLength > 5000) {
              await cachePut(cacheKey, buf);
              zip.file(filename, buf, { binary: true });
              success = true;
              break;
            }
          } catch (_) { /* try next URL */ }
        }
      }

      if (!success) errors++;
      count++;

      self.postMessage({
        status:      'progress',
        completed:   count,
        total:       chunk.length,
        failed:      errors,
        fromCache,
        current:     filename,
        chunkIndex:  c + 1,
        totalChunks: chunks.length,
      });
    }

    try {
      const downloaded = chunk.length - errors;
      const chunkName  = shouldChunk
        ? `images_chunk_${String(c + 1).padStart(3, '0')}.zip`
        : (options.outputName || 'selected_images.zip');
      if (downloaded === 0) {
        self.postMessage({
          status: 'done', blob: null,
          chunkIndex: c + 1, totalChunks: chunks.length,
          name: chunkName, downloaded: 0, failed: errors,
        });
      } else {
        const blob = await zip.generateAsync({ type: 'blob' });
        self.postMessage({
          status: 'done', blob,
          chunkIndex: c + 1, totalChunks: chunks.length,
          name: chunkName, downloaded, failed: errors,
        });
      }
    } catch (e) {
      self.postMessage({ status: 'error', message: String(e), chunkIndex: c + 1 });
    }
  }
});
