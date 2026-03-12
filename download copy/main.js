var images = []; // Stores image data for display and download
var downloadWorker = null;

// ─── Web Worker ───────────────────────────────────────────────────────────────

function initDownloadWorkerIfNeeded() {
  if (downloadWorker) return;
  try {
    downloadWorker = new Worker('download-worker.js');
  } catch (e) {
    console.error('Failed to create download worker:', e);
    downloadWorker = null;
    return;
  }

  downloadWorker.onmessage = function (ev) {
    const data = ev.data || {};
    if (data.status === 'progress') {
      const { completed = 0, total = 0, failed = 0, current = '', chunkIndex, totalChunks } = data;
      const label = chunkIndex ? `Chunk ${chunkIndex}/${totalChunks}: ${current}` : current;
      showDetailedProgress(completed, total, label, Date.now(), failed);
      updateProgress((completed / total) * 100);
    } else if (data.status === 'done') {
      try {
        saveAs(data.blob, data.name || 'selected_images.zip');
        showMessage(`Downloaded ${data.name} (${data.downloaded || 0} files, ${data.failed || 0} failed)`);
      } catch (e) {
        console.error('Error saving blob:', e);
        showMessage('Download complete, but saving failed');
      }
    } else if (data.status === 'error') {
      console.error('Worker error:', data.message);
      showMessage('Download worker error: ' + (data.message || 'unknown'));
    }
  };
}

// ─── IIIF Label Extraction ────────────────────────────────────────────────────

function extractLabelText(label, fallback = "Untitled") {
  if (!label) return fallback;
  if (typeof label === 'string') return label;
  if (Array.isArray(label)) return label[0] ?? fallback;

  // IIIF Presentation 3.0: { "en": ["text"], "@none": ["text"] }
  if (typeof label === 'object') {
    const value = label.en ?? label['@none'] ?? Object.values(label)[0];
    if (Array.isArray(value) && value.length > 0) return value[0];
  }

  try { return String(label); } catch { return fallback; }
}

// ─── Proxy URL Builder ────────────────────────────────────────────────────────

function buildProxyUrl(iiifBase) {
  if (!iiifBase) return null;

  if (iiifBase.includes("dlc.library.columbia.edu")) {
    const m = iiifBase.match(/dlc\.library\.columbia\.edu\/iiif\/\d+\/([^\/]+)\/.*?(\d+)/);
    if (m) {
      return `http://localhost:5000/columbia?id=${encodeURIComponent(decodeURIComponent(m[1]))}&canvas=${m[2]}&size=full`;
    }
    return `http://localhost:5000/proxy?url=${encodeURIComponent(iiifBase + '/full/max/0/default.jpg')}`;
  }

  // ARK-based sources (Gallica, CNRS)
  const ark = iiifBase.match(/ark:\/([^/]+\/[^/]+)/);
  const folio = iiifBase.match(/\/f(\d+)/);
  if (ark && folio) {
    return `http://localhost:5000/download?ark=${encodeURIComponent(ark[1])}&f=${folio[1]}&size=full`;
  }

  return null;
}

// ─── URL Variant Generators ───────────────────────────────────────────────────

function iiifVariants(baseUrl) {
  const sizes   = ['max', 'full', '1200,', '800,', '600,', '400,', ',1200', ',800'];
  const quality = ['default', 'native', 'color'];
  const urls = [];
  for (const size of sizes) {
    for (const q of quality) {
      urls.push(`${baseUrl}/full/${size}/0/${q}.jpg`);
    }
  }
  // Legacy IIIF 1.0 and no-rotation variants
  urls.push(
    `${baseUrl}/full/full/default.jpg`,
    `${baseUrl}/full/max/default.jpg`,
    `${baseUrl}/full/0/native.jpg`,
    `${baseUrl}/full/native.jpg`,
    `${baseUrl}/full/default.jpg`,
    baseUrl,
    `${baseUrl}.jpg`
  );
  return urls;
}

function vaticanVariants(baseUrl, originalUrl) {
  const base = iiifVariants(baseUrl);

  // Alternative path structures used by Vatican/Montecassino systems
  const pathAlts = [
    baseUrl.replace('/iiif/2/', '/iiif/'),
    baseUrl.replace('/iiif/2/', '/images/'),
    baseUrl.replace('/iiif/', '/images/'),
  ].filter(p => p !== baseUrl);

  const altUrls = pathAlts.flatMap(p => [
    `${p}/full/full/0/default.jpg`,
    `${p}/full/max/0/default.jpg`,
  ]);

  // URL-encoding fixes sometimes needed for Vatican systems
  const decoded = originalUrl.replace(/%5B/g, '[').replace(/%5D/g, ']');
  const decodedBase = decoded.includes('/full/') ? decoded.split('/full/')[0] : decoded;
  const decodeAlts = decodedBase !== baseUrl ? [
    decoded,
    `${decodedBase}/full/full/0/default.jpg`,
    `${decodedBase}/full/max/0/default.jpg`,
  ] : [];

  return [...base, ...altUrls, ...decodeAlts];
}

// ─── Main URL-to-Try Builder ──────────────────────────────────────────────────

function buildUrlsToTry(img, index) {
  const urlsToTry = [];

  if (!img?.url) {
    console.warn(`Image ${index} has no URL`);
    return urlsToTry;
  }

  // Proxy always goes first when available
  if (img.proxy) urlsToTry.push(img.proxy);

  const url = img.url;

  // ── Columbia (triclops or dlc) ──
  if (url.includes("triclops.library.columbia.edu") || url.includes("dlc.library.columbia.edu")) {
    console.log(`Image ${index}: Columbia URL`);
    const m = url.match(/(?:triclops|dlc)\.library\.columbia\.edu\/(?:iiif\/\d+\/)?([^\/]+)\/.*?(\d+)/);
    if (m) {
      const id = encodeURIComponent(decodeURIComponent(m[1]));
      const canvas = m[2];
      ['full', '2000', '1500', '1000'].forEach(size =>
        urlsToTry.push(`http://localhost:5000/columbia?id=${id}&canvas=${canvas}&size=${size}`)
      );
    }
    ['max', '2000,', '1500,', '1200,', '800,'].forEach(size =>
      urlsToTry.push(
        `http://localhost:5000/proxy?url=${encodeURIComponent(url.replace(/\/full\/[^\/]+\//, `/full/${size}/`))}`
      )
    );
    urlsToTry.push(url); // direct last — likely CORS-blocked but worth trying
    return [...new Set(urlsToTry)];
  }

  // For all other sources, add primary URL before alternatives
  urlsToTry.push(url);

  // ── Montecassino / Vatican ──
  if (url.includes("omnes.dbseret.com") || url.includes("montecassino") ||
      url.includes("vatlib") || url.includes("digi.vatlib") || url.includes("vatican")) {
    console.log(`Image ${index}: Montecassino/Vatican URL`);
    const baseUrl = url.includes("/full/") ? url.split("/full/")[0] : url;
    urlsToTry.push(...vaticanVariants(baseUrl, url));
    if (!url.includes("/full/")) {
      urlsToTry.push(...['full', 'max', '1200,', '800,'].map(s => `${url}/full/${s}/0/default.jpg`));
    }
  }

  // ── CNRS ──
  else if (url.includes("iiif.irht.cnrs.fr")) {
    console.log(`Image ${index}: CNRS URL`);
    const baseUrl = url.includes("/full/") ? url.split("/full/")[0] : url;
    urlsToTry.push(...iiifVariants(baseUrl));
    urlsToTry.push(`${baseUrl}/full/full/0/default.png`, `${baseUrl}/full/max/0/default.png`);
  }

  // ── Gallica ──
  else if (url.includes("gallica.bnf.fr") && url.includes("/full/")) {
    console.log(`Image ${index}: Gallica URL`);
    const baseUrl = url.split("/full/")[0];
    const ark = baseUrl.match(/ark:\/([^/]+\/[^/]+)/);
    const page = baseUrl.match(/\/f(\d+)/);
    if (ark && page) {
      // Proxy goes to front of the list for Gallica
      urlsToTry.unshift(`http://localhost:5000/download?ark=${encodeURIComponent(ark[1])}&f=${page[1]}&size=full`);
    }
    urlsToTry.push(
      `${baseUrl}/full/full/0/native.jpg`,
      `${baseUrl}/full/full/0/default.jpg`,
      `${baseUrl}/full/max/0/native.jpg`,
      `${baseUrl}/full/max/0/default.jpg`
    );
  }

  // ── Generic IIIF with /full/ segment ──
  else if (url.includes("/full/")) {
    console.log(`Image ${index}: generic IIIF URL`);
    const baseUrl = url.split("/full/")[0];
    urlsToTry.push(...['max', 'full', '2000,', '1500,', '1000,', '800,'].map(
      s => `${baseUrl}/full/${s}/0/default.jpg`
    ));
    urlsToTry.push(baseUrl);
  }

  // ── Other IIIF base URL ──
  else if (url.includes("/iiif/")) {
    urlsToTry.push(`http://localhost:5000/proxy?url=${encodeURIComponent(url)}`);
  }

  const unique = [...new Set(urlsToTry)];
  console.log(`Image ${index}: ${unique.length} URLs to try`);
  return unique;
}

// ─── Manifest Loading ─────────────────────────────────────────────────────────

async function getManifest() {
  const url = document.getElementById("url").value;
  if (!url) { showMessage("Please enter a manifest URL."); return; }

  showMessage("Loading manifest...");

  let manifest;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const detail = (await response.text()).substring(0, 200);
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${detail}`);
    }
    manifest = await response.json();
  } catch (err) {
    showMessage(`Error loading manifest: ${err.message}`);
    console.error("Error loading manifest:", err);
    return;
  }

  document.getElementById("img-container").innerHTML = "";
  images = [];

  // ── Detect IIIF version and extract canvases ──
  let canvases = [];
  let isIIIFP3 = false;

  if (manifest["@context"]?.includes("http://iiif.io/api/presentation/3/context.json")) {
    isIIIFP3 = true;
    canvases = manifest.items ?? [];
  } else if (manifest.sequences?.[0]?.canvases) {
    canvases = manifest.sequences[0].canvases;
  }

  if (canvases.length === 0) {
    showMessage("Error: No canvases found in manifest, or unrecognized IIIF structure.");
    return;
  }

  // ── Show/hide Gallica rate-limit checkbox ──
  const isGallicaManifest = url.includes("gallica.bnf.fr") ||
    canvases.some(c => JSON.stringify(c).includes("gallica.bnf.fr"));
  const gallicaContainer = document.getElementById("gallicaContainer");
  if (gallicaContainer) {
    gallicaContainer.style.display = isGallicaManifest ? "block" : "none";
    if (!isGallicaManifest) document.getElementById("gallicaCheckbox").checked = false;
  }

  // ── Show/hide chunking options ──
  const chunkContainer = document.getElementById("chunkContainer");
  if (chunkContainer) {
    chunkContainer.style.display = canvases.length > 50 ? "block" : "none";
  }

  // ── Process each canvas ──
  canvases.forEach((canvas, index) => {
    const { thumbnailUrl, fullImageUrlBase } = extractCanvasImageUrls(canvas, index, isIIIFP3);

    if (!thumbnailUrl) {
      console.warn(`Canvas ${index}: could not determine image URL, skipping`);
      return;
    }

    const downloadUrl  = resolveDownloadUrl(fullImageUrlBase);
    const isIIIFSvc    = fullImageUrlBase &&
      (fullImageUrlBase.includes("/iiif/image/") || /\/images\/.+\/?$/.test(fullImageUrlBase));
    const infoUrl      = isIIIFSvc ? `${fullImageUrlBase}/info.json` : null;
    const proxyUrl     = buildProxyUrl(fullImageUrlBase);
    const imageLabel   = he.decode(extractLabelText(canvas.label, `Image ${index + 1}`));

    images.push({ url: downloadUrl, proxy: proxyUrl, info: infoUrl, label: imageLabel });

    document.getElementById("img-container").appendChild(
      buildImageCard(images.length - 1, thumbnailUrl, downloadUrl, infoUrl, imageLabel)
    );
  });

  showMessage(`Manifest loaded successfully. ${images.length} images found.`);
}

// Extract thumbnail and full-resolution base URL from a canvas
function extractCanvasImageUrls(canvas, index, isIIIFP3) {
  let thumbnailUrl = "";
  let fullImageUrlBase = "";

  if (isIIIFP3) {
    const body = canvas.items?.[0]?.items?.[0]?.body;
    if (body) {
      const b = Array.isArray(body) ? body[0] : body;
      const svc = Array.isArray(b.service)
        ? b.service.find(s => s.id && (s.id.includes("/iiif/") || s.type === "ImageService2" || s.type === "ImageService3"))
        : (b.service?.id && (b.service.id.includes("/iiif/") || b.service.type === "ImageService2" || b.service.type === "ImageService3"))
          ? b.service : null;

      if (svc) {
        fullImageUrlBase = svc.id.replace(/\/$/, '');
        thumbnailUrl = `${fullImageUrlBase}/full/!400,400/0/default.jpg`;
      } else if (b.id) {
        if (b.id.includes("/iiif/") && !b.id.includes("/full/")) {
          fullImageUrlBase = b.id.replace(/\/$/, '');
          thumbnailUrl = `${fullImageUrlBase}/full/!400,400/0/default.jpg`;
        } else {
          fullImageUrlBase = thumbnailUrl = b.id;
        }
      }
    }

    // Fallback: thumbnail property
    if (!thumbnailUrl && canvas.thumbnail?.[0]?.id) {
      const thumb = canvas.thumbnail[0];
      thumbnailUrl = thumb.id;
      const svcId = thumb.service?.[0]?.id;
      fullImageUrlBase = svcId
        ? svcId.replace(/\/$/, '')
        : (thumb.id.match(/^(.+\/iiif\/[^\/]+)/)?.[1] ?? thumb.id);
    }

    // Fallback: embedded P2-style resource
    if (!thumbnailUrl) {
      const res = canvas.images?.[0]?.resource;
      if (res) {
        if (res.service?.["@id"]) {
          fullImageUrlBase = res.service["@id"].replace(/\/$/, '');
          thumbnailUrl = `${fullImageUrlBase}/full/!400,400/0/default.jpg`;
        } else if (res["@id"]) {
          fullImageUrlBase = thumbnailUrl = res["@id"];
        }
      }
    }
  } else {
    // IIIF Presentation 2.x
    const res = canvas.images?.[0]?.resource;
    if (res) {
      if (res.service?.["@id"]) {
        fullImageUrlBase = res.service["@id"].replace(/\/$/, '');
        thumbnailUrl = `${fullImageUrlBase}/full/!400,400/0/default.jpg`;
      } else if (res["@id"]) {
        fullImageUrlBase = thumbnailUrl = res["@id"];
      }
    }
  }

  console.log(`Canvas ${index}: base=${fullImageUrlBase} thumb=${thumbnailUrl}`);
  return { thumbnailUrl, fullImageUrlBase };
}

// Resolve the best full-resolution download URL for a given IIIF base
function resolveDownloadUrl(base) {
  if (!base) return base;
  const isIIIFBase =
    base.includes("/iiif/image/") ||
    /\/images\/.+\/?$/.test(base) ||
    /\/loris\/.+$/.test(base) ||
    base.includes("iiifimage") ||
    base.includes("gallica.bnf.fr/iiif") ||
    base.includes("dlc.library.columbia.edu");

  if (!isIIIFBase) return base;

  if (base.includes("vatlib") || base.includes("digi.vatlib")) return `${base}/full/full/0/native.jpg`;
  if (base.includes("gallica.bnf.fr"))                          return `${base}/full/full/0/native.jpg`;
  if (base.includes("dlc.library.columbia.edu"))                return `${base}/full/max/0/default.jpg`;
  if (base.includes("fragmentarium"))                           return `${base}/full/full/0/default.jpg`;
  return `${base}/full/max/0/default.jpg`;
}

// Build a single image card DOM element
function buildImageCard(imgIndex, thumbnailUrl, downloadUrl, infoUrl, imageLabel) {
  const container = document.createElement("div");
  container.className = "image-card fade-in-up";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = `img-${imgIndex}`;
  checkbox.value = imgIndex;
  checkbox.setAttribute("aria-label", `Select ${imageLabel}`);

  const selectRow = document.createElement("div");
  selectRow.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:10px;";
  const selectSpan = document.createElement("span");
  selectSpan.textContent = "Select for Download";
  selectRow.append(checkbox, selectSpan);

  const labelWrapper = document.createElement("label");
  labelWrapper.htmlFor = `img-${imgIndex}`;
  labelWrapper.style.display = "block";

  const imgEl = document.createElement("img");
  imgEl.src = thumbnailUrl;
  imgEl.alt = imageLabel;
  imgEl.style.cssText = "max-width:100%; height:auto; display:block; margin-bottom:10px; border-radius:var(--radius-md); border:1px solid var(--border-color);";
  labelWrapper.appendChild(imgEl);

  const labelText = document.createElement("p");
  labelText.textContent = imageLabel;
  labelText.style.cssText = "font-weight:bold; margin-bottom:5px; color:var(--text-primary); font-size:1.1rem;";

  const urlLink = document.createElement("p");
  urlLink.innerHTML = `<strong>Download URL:</strong> <a href="${downloadUrl}" target="_blank" rel="noopener noreferrer">${downloadUrl.substring(0, 40)}...</a>`;
  urlLink.style.cssText = "font-size:0.9rem; color:var(--text-secondary); margin-bottom:3px;";

  const infoLink = document.createElement("p");
  infoLink.innerHTML = infoUrl
    ? `<strong>Info JSON:</strong> <a href="${infoUrl}" target="_blank" rel="noopener noreferrer">View info.json</a>`
    : "Info JSON: N/A";
  infoLink.style.cssText = "font-size:0.9rem; color:var(--text-secondary); margin-bottom:10px;";

  container.append(selectRow, labelWrapper, labelText, urlLink, infoLink);
  return container;
}

// ─── Download Entry Point ─────────────────────────────────────────────────────

async function downloadSelected() {
  const selectedImages = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
    .map(cb => images[parseInt(cb.value)])
    .filter(Boolean);

  if (selectedImages.length === 0) {
    showMessage("No images selected. Please select at least one image to download.");
    return;
  }

  const shouldChunk = document.getElementById("chunkCheckbox")?.checked ?? false;
  const chunkSize   = parseInt(document.getElementById("chunkSize")?.value) || 50;

  const imagesForWorker = selectedImages.map((img, idx) => ({
    label: img.label,
    filename: sanitizeFilename(img.label || `image_${idx + 1}`) + '.jpg',
    urls: buildUrlsToTry(img, idx),
  }));

  initDownloadWorkerIfNeeded();
  if (!downloadWorker) {
    showMessage('Download worker unavailable; cannot proceed.');
    return;
  }

  showMessage('Starting download in background worker...');
  resetProgress();
  downloadWorker.postMessage({
    cmd: 'download',
    images: imagesForWorker,
    options: { shouldChunk, chunkSize, timeoutMs: 30000, outputName: 'selected_images.zip' },
  });
}

// ─── Fetch & Binary Helpers ───────────────────────────────────────────────────

function fetchBinary(url) {
  return fetch(url, { mode: 'cors' }).then(resp => {
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.arrayBuffer();
  });
}

function processBinaryData(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data.charCodeAt(i) & 0xff;
    return out;
  }
  return data;
}

// ─── Progress UI ──────────────────────────────────────────────────────────────

function showDetailedProgress(completed, total, currentAction, startTime = null, failed = 0) {
  let el = document.getElementById("detailed_progress");
  if (!el) {
    el = document.createElement("div");
    el.id = "detailed_progress";
    el.style.cssText = `
      margin:15px 0; padding:15px;
      background:var(--surface-color); border-radius:var(--radius-md);
      border-left:4px solid var(--accent-color);
      font-family:monospace; font-size:14px; line-height:1.4; color:var(--text-primary);
    `;
    const pb = document.getElementById("progress_bar");
    pb.parentNode.insertBefore(el, pb.nextSibling);
  }
  el.style.display = "block";

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  let timeInfo = "";
  if (startTime && completed > 0) {
    const elapsed   = (Date.now() - startTime) / 1000;
    const remaining = (total - completed) * (elapsed / completed);
    timeInfo = `Time: ${formatTime(elapsed)} | ${remaining > 0 ? 'ETA: ' + formatTime(remaining) : 'Almost done!'}`;
  }

  el.innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
      <strong>Download Progress</strong>
      <span style="color:var(--primary-color);">${pct}% (${completed}/${total})</span>
    </div>
    ${timeInfo ? `<div style="color:var(--text-secondary); margin-bottom:8px; font-size:12px;">${timeInfo}</div>` : ''}
    <div style="margin-bottom:8px;"><strong>Status:</strong> ${currentAction}</div>
    ${failed > 0 ? `<div style="color:var(--warning-color); font-size:12px;">⚠️ ${failed} image(s) failed</div>` : ''}
  `;
}

function updateDetailedProgress(completed, total, currentAction, startTime, failed = 0) {
  showDetailedProgress(completed, total, currentAction, startTime, failed);
}

function formatTime(seconds) {
  return seconds < 60
    ? `${Math.round(seconds)}s`
    : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

// ─── General Helpers ──────────────────────────────────────────────────────────

function selectAll() {
  const boxes = document.querySelectorAll('input[type="checkbox"]');
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => (b.checked = !allChecked));
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 100);
}

function showMessage(text) {
  document.getElementById("result").innerText = text;
}

function resetProgress() {
  const pb = document.getElementById("progress_bar");
  pb.querySelector(".progress-bar").style.width = "0%";
  pb.querySelector(".progress-bar").innerText = "0%";
  pb.classList.add("hide");
  const dp = document.getElementById("detailed_progress");
  if (dp) dp.style.display = "none";
}

function updateProgress(percent) {
  const pb = document.getElementById("progress_bar");
  pb.classList.remove("hide");
  pb.querySelector(".progress-bar").style.width = percent + "%";
  pb.querySelector(".progress-bar").innerText = Math.round(percent) + "%";
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("loadManifest").addEventListener("click", getManifest);
  document.getElementById("selectAll").addEventListener("click", selectAll);
  document.getElementById("downloadSelected").addEventListener("click", downloadSelected);
});

console.log("main.js loaded successfully");