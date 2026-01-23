// Worker for downloading a chunk of images, zipping them, and reporting progress
self.importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

async function headContentLength(url) {
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    if (resp && resp.ok) {
      const cl = resp.headers.get('Content-Length');
      if (cl) return parseInt(cl, 10);
    }
  } catch (e) {
    // ignore
  }
  return null;
}

async function fetchArrayBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  return await resp.arrayBuffer();
}

self.onmessage = async function (ev) {
  const msg = ev.data;
  if (!msg || msg.cmd !== 'downloadChunk') return;

  const { chunk, chunkNumber, totalChunks, options } = msg;
  const zip = new self.JSZip();
  let failed = 0;
  let completed = 0;
  let bytesDownloaded = 0;

  // First, attempt to probe sizes to estimate ETA
  const sizes = new Array(chunk.length).fill(null);
  for (let i = 0; i < chunk.length; i++) {
    const item = chunk[i];
    for (let u = 0; u < item.urls.length; u++) {
      const url = item.urls[u];
      try {
        const cl = await headContentLength(url);
        if (cl && cl > 0) {
          sizes[i] = cl;
          item._probableUrl = url;
          break;
        }
      } catch (e) {
        // try next
      }
    }
  }

  const knownTotal = sizes.filter(s => s && !isNaN(s)).reduce((a,b)=>a+(b||0),0);
  const knownCount = sizes.filter(s => s && !isNaN(s)).length;
  const avgSize = knownCount > 0 ? Math.round(knownTotal/knownCount) : 500000;
  const estimatedTotalBytes = knownTotal + (chunk.length - knownCount) * avgSize;

  // Download each file sequentially inside the chunk (reduces memory surge)
  for (let i = 0; i < chunk.length; i++) {
    const item = chunk[i];
    const filename = item.filename || (item.label ? item.label + '.jpg' : `image_${i+1}.jpg`);
    let success = false;

    for (let u = 0; u < item.urls.length; u++) {
      const url = item.urls[u];
      try {
        postMessage({ type: 'progress', chunkNumber, completed, total: chunk.length, bytesDownloaded, estimatedTotalBytes, currentAction: `HEAD/${filename} -> ${url.substring(0,80)}` });
        const data = await fetchArrayBuffer(url);
        const bytes = data.byteLength || (data.length || 0);
        if (bytes > 1000) {
          zip.file(filename, data, { binary: true });
          bytesDownloaded += bytes;
          completed++;
          success = true;

          postMessage({ type: 'progress', chunkNumber, completed, total: chunk.length, bytesDownloaded, estimatedTotalBytes, currentAction: `Added ${filename}` });
          break;
        }
      } catch (err) {
        // try next url
        postMessage({ type: 'progress', chunkNumber, completed, total: chunk.length, bytesDownloaded, estimatedTotalBytes, currentAction: `Failed ${url.substring(0,80)}` });
      }
    }

    if (!success) {
      failed++;
      postMessage({ type: 'progress', chunkNumber, completed, total: chunk.length, bytesDownloaded, estimatedTotalBytes, currentAction: `Failed all for ${filename}` });
    }
  }

  // generate zip blob
  try {
    const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
      postMessage({ type: 'zip-progress', chunkNumber, percent: meta.percent });
    });

    postMessage({ type: 'done', chunkNumber, blob, downloaded: completed, failed, total: chunk.length });
  } catch (err) {
    postMessage({ type: 'error', message: err.message || String(err) });
  }
};
