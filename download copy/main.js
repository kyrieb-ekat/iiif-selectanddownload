var images = []; // Stores image data for display and download
var downloadWorker = null;
var workerStartTime = null;
var pendingImages   = []; // images remaining after a pause

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
      const { completed = 0, total = 0, failed = 0, fromCache = 0, current = '', chunkIndex, totalChunks } = data;
      const label = chunkIndex ? `Chunk ${chunkIndex}/${totalChunks}: ${current}` : current;
      document.querySelector('.progress-bar--indeterminate')?.classList.remove('progress-bar--indeterminate');
      showDetailedProgress(completed, total, label, workerStartTime, failed, fromCache);
      updateProgress((completed / total) * 100);

    } else if (data.status === 'done') {
      try {
        const cacheNote = data.fromCache > 0 ? `, ${data.fromCache} from cache` : '';
        if (data.blob) {
          saveAs(data.blob, data.name || 'selected_images.zip');
          showMessage(`Downloaded ${data.name} (${data.downloaded || 0} files${cacheNote}, ${data.failed || 0} failed)`);
        } else {
          showMessage(`Chunk ${data.chunkIndex} — no images downloaded (${data.failed || 0} failed)`);
        }
        if (data.chunkIndex === data.totalChunks) {
          clearSession();
          setPauseButtonState('hidden');
        }
      } catch (e) {
        console.error('Error saving blob:', e);
        showMessage('Download complete, but saving failed');
      }

    } else if (data.status === 'paused') {
      setPauseButtonState('resume');
      pendingImages = [...(data.remaining || []), ...(data.remainingChunks || [])];
      updateSessionRemaining(pendingImages);

      if (data.partialBlob && data.partialCount > 0) {
        saveAs(data.partialBlob, 'partial_download.zip');
        showMessage(
          `Paused — saved ${data.partialCount} image(s) to partial_download.zip. ` +
          `${pendingImages.length} image(s) remaining; click Resume to continue.`
        );
      } else {
        showMessage(`Paused — ${pendingImages.length} image(s) remaining. Click Resume to continue.`);
      }

    } else if (data.status === 'cache-cleared') {
      showMessage('Download cache cleared.');

    } else if (data.status === 'error') {
      console.error('Worker error:', data.message);
      showMessage('Download worker error: ' + (data.message || 'unknown'));
      setPauseButtonState('hidden');
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

// ─── Flask Token ──────────────────────────────────────────────────────────────

function getFlaskToken() {
  // Read from the token input, falling back to a ?token= URL param on page load.
  const inputVal = document.getElementById('flaskToken')?.value.trim();
  if (inputVal) return inputVal;
  return new URLSearchParams(window.location.search).get('token') || '';
}

function flaskUrl(path, params) {
  const token = getFlaskToken();
  const qs = new URLSearchParams({ ...params, ...(token ? { token } : {}) });
  return `http://localhost:5000${path}?${qs}`;
}

// ─── Proxy URL Builder ────────────────────────────────────────────────────────

function buildProxyUrl(iiifBase) {
  if (!iiifBase) return null;

  if (iiifBase.includes("dlc.library.columbia.edu")) {
    const m = iiifBase.match(/dlc\.library\.columbia\.edu\/iiif\/\d+\/([^\/]+)\/.*?(\d+)/);
    if (m) {
      return flaskUrl('/columbia', {
        id: decodeURIComponent(m[1]),
        canvas: m[2],
        size: 'full',
      });
    }
    return flaskUrl('/proxy', { url: iiifBase + '/full/max/0/default.jpg' });
  }

  // ARK-based sources (Gallica, CNRS)
  const ark = iiifBase.match(/ark:\/([^/]+\/[^/]+)/);
  const folio = iiifBase.match(/\/f(\d+)/);
  if (ark && folio) {
    return flaskUrl('/download', { ark: ark[1], f: folio[1], size: 'full' });
  }

  return null;
}

// ─── URL Variant Generators ───────────────────────────────────────────────────

function iiifVariants(baseUrl, format = 'jpg') {
  const sizes   = ['max', 'full', '1200,', '800,', '600,', '400,', ',1200', ',800'];
  const quality = ['default', 'native', 'color'];
  const urls = [];
  for (const size of sizes) {
    for (const q of quality) {
      urls.push(`${baseUrl}/full/${size}/0/${q}.${format}`);
    }
  }
  // Legacy IIIF 1.0 and no-rotation variants
  urls.push(
    `${baseUrl}/full/full/default.${format}`,
    `${baseUrl}/full/max/default.${format}`,
    `${baseUrl}/full/0/native.${format}`,
    `${baseUrl}/full/native.${format}`,
    `${baseUrl}/full/default.${format}`,
    baseUrl,
    `${baseUrl}.${format}`
  );
  return urls;
}

function vaticanVariants(baseUrl, originalUrl, format = 'jpg') {
  const base = iiifVariants(baseUrl, format);

  // Alternative path structures used by Vatican/Montecassino systems
  const pathAlts = [
    baseUrl.replace('/iiif/2/', '/iiif/'),
    baseUrl.replace('/iiif/2/', '/images/'),
    baseUrl.replace('/iiif/', '/images/'),
  ].filter(p => p !== baseUrl);

  const altUrls = pathAlts.flatMap(p => [
    `${p}/full/full/0/default.${format}`,
    `${p}/full/max/0/default.${format}`,
  ]);

  // URL-encoding fixes sometimes needed for Vatican systems
  const decoded = originalUrl.replace(/%5B/g, '[').replace(/%5D/g, ']');
  const decodedBase = decoded.includes('/full/') ? decoded.split('/full/')[0] : decoded;
  const decodeAlts = decodedBase !== baseUrl ? [
    decoded,
    `${decodedBase}/full/full/0/default.${format}`,
    `${decodedBase}/full/max/0/default.${format}`,
  ] : [];

  return [...base, ...altUrls, ...decodeAlts];
}

// ─── Main URL-to-Try Builder ──────────────────────────────────────────────────

function buildUrlsToTry(img, index, format = 'jpg') {
  const urlsToTry = [];

  if (!img?.url) {
    console.warn(`Image ${index} has no URL`);
    return urlsToTry;
  }

  // Flask proxy endpoints only serve JPEG; skip them for other formats
  if (format === 'jpg' && img.proxy) urlsToTry.push(img.proxy);

  // Rewrite primary URL's format suffix when not JPEG
  const url = format === 'jpg' ? img.url : img.url.replace(/\.jpg$/i, `.${format}`);

  // ── Columbia (triclops or dlc) ──
  if (url.includes("triclops.library.columbia.edu") || url.includes("dlc.library.columbia.edu")) {
    console.log(`Image ${index}: Columbia URL`);
    const m = url.match(/(?:triclops|dlc)\.library\.columbia\.edu\/(?:iiif\/\d+\/)?([^\/]+)\/.*?(\d+)/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const canvas = m[2];
      // /columbia endpoint only serves JPEG; skip for other formats
      if (format === 'jpg') {
        ['full', '2000', '1500', '1000'].forEach(size =>
          urlsToTry.push(flaskUrl('/columbia', { id, canvas, size }))
        );
      }
    }
    ['max', '2000,', '1500,', '1200,', '800,'].forEach(size =>
      urlsToTry.push(
        flaskUrl('/proxy', { url: url.replace(/\/full\/[^\/]+\//, `/full/${size}/`) })
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
    urlsToTry.push(...vaticanVariants(baseUrl, url, format));
    if (!url.includes("/full/")) {
      urlsToTry.push(...['full', 'max', '1200,', '800,'].map(s => `${url}/full/${s}/0/default.${format}`));
    }
  }

  // ── CNRS ──
  else if (url.includes("iiif.irht.cnrs.fr")) {
    console.log(`Image ${index}: CNRS URL`);
    const baseUrl = url.includes("/full/") ? url.split("/full/")[0] : url;
    urlsToTry.push(...iiifVariants(baseUrl, format));
    // PNG fallback only makes sense for JPEG mode
    if (format === 'jpg') {
      urlsToTry.push(`${baseUrl}/full/full/0/default.png`, `${baseUrl}/full/max/0/default.png`);
    }
  }

  // ── Gallica ──
  else if (url.includes("gallica.bnf.fr") && url.includes("/full/")) {
    console.log(`Image ${index}: Gallica URL`);
    const baseUrl = url.split("/full/")[0];
    const ark = baseUrl.match(/ark:\/([^/]+\/[^/]+)/);
    const page = baseUrl.match(/\/f(\d+)/);
    // /download endpoint only serves JPEG; skip for other formats
    if (format === 'jpg' && ark && page) {
      urlsToTry.unshift(flaskUrl('/download', { ark: ark[1], f: page[1], size: 'full' }));
    }
    urlsToTry.push(
      `${baseUrl}/full/full/0/native.${format}`,
      `${baseUrl}/full/full/0/default.${format}`,
      `${baseUrl}/full/max/0/native.${format}`,
      `${baseUrl}/full/max/0/default.${format}`
    );
  }

  // ── Generic IIIF with /full/ segment ──
  else if (url.includes("/full/")) {
    console.log(`Image ${index}: generic IIIF URL`);
    const baseUrl = url.split("/full/")[0];
    urlsToTry.push(...['max', 'full', '2000,', '1500,', '1000,', '800,'].map(
      s => `${baseUrl}/full/${s}/0/default.${format}`
    ));
    urlsToTry.push(baseUrl);
  }

  // ── Other IIIF base URL (no /full/ in URL — treat as image service base) ──
  else if (url.includes("/iiif/")) {
    const cleanBase = url.replace(/\/$/, '');
    urlsToTry.push(...['max', 'full', '2000,', '1500,', '1000,', '800,'].map(
      s => `${cleanBase}/full/${s}/0/default.${format}`
    ));
    if (format === 'jpg') {
      urlsToTry.push(flaskUrl('/proxy', { url: `${cleanBase}/full/max/0/default.jpg` }));
    }
  }

  const unique = [...new Set(urlsToTry)];
  console.log(`Image ${index}: ${unique.length} URLs to try`);
  return unique;
}

// ─── Manifest Loading ─────────────────────────────────────────────────────────

async function getManifest() {
  const url = document.getElementById("url").value;
  if (!url) { showMessage("Please enter a manifest URL."); return; }

  const btn       = document.getElementById("loadManifest");
  const container = document.getElementById("img-container");

  btn.disabled    = true;
  btn.textContent = "Loading…";
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Fetching manifest…</p></div>';
  images = [];

  let manifest;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const detail = (await response.text()).substring(0, 200);
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${detail}`);
    }
    manifest = await response.json();
  } catch (err) {
    container.innerHTML = "";
    showMessage(`Error loading manifest: ${err.message}`);
    console.error("Error loading manifest:", err);
    btn.disabled    = false;
    btn.textContent = "Load Manifest";
    return;
  }

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
    container.innerHTML = "";
    showMessage("Error: No canvases found in manifest, or unrecognized IIIF structure.");
    btn.disabled    = false;
    btn.textContent = "Load Manifest";
    return;
  }

  // ── Show/hide chunking options ──
  const chunkContainer = document.getElementById("chunkContainer");
  if (chunkContainer) {
    chunkContainer.style.display = canvases.length > 50 ? "block" : "none";
  }

  // ── Process canvases, yielding to the browser every 10 to keep UI responsive ──
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Building image list… 0/' + canvases.length + '</p></div>';
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < canvases.length; index++) {
    if (index % 10 === 0 && index > 0) {
      const statusEl = container.querySelector(".loading-state p");
      if (statusEl) statusEl.textContent = `Building image list… ${index}/${canvases.length}`;
      container.appendChild(fragment.cloneNode(true));
      while (fragment.firstChild) fragment.removeChild(fragment.firstChild);
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const canvas = canvases[index];
    const { thumbnailUrl, fullImageUrlBase } = extractCanvasImageUrls(canvas, index, isIIIFP3);

    if (!thumbnailUrl) {
      console.warn(`Canvas ${index}: could not determine image URL, skipping`);
      continue;
    }

    const downloadUrl = resolveDownloadUrl(fullImageUrlBase);
    const isIIIFSvc  = fullImageUrlBase &&
      (fullImageUrlBase.includes("/iiif/image/") || /\/images\/.+\/?$/.test(fullImageUrlBase));
    const infoUrl    = isIIIFSvc ? `${fullImageUrlBase}/info.json` : null;
    const proxyUrl   = buildProxyUrl(fullImageUrlBase);
    const imageLabel = he.decode(extractLabelText(canvas.label, `Image ${index + 1}`));

    images.push({ url: downloadUrl, proxy: proxyUrl, info: infoUrl, label: imageLabel });
    fragment.appendChild(buildImageCard(images.length - 1, thumbnailUrl, downloadUrl, infoUrl, imageLabel));
  }

  // Flush remaining cards and remove the spinner placeholder
  const spinner = container.querySelector(".loading-state");
  if (spinner) spinner.remove();
  container.appendChild(fragment);

  btn.disabled    = false;
  btn.textContent = "Load Manifest";
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
    base.includes("/image/iiif/") ||   // Internet Archive and similar
    /\/iiif\/[23]\//.test(base) ||     // IIIF Image API v2/v3 base pattern
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
  urlLink.style.cssText = "font-size:0.9rem; color:var(--text-secondary); margin-bottom:3px;";
  const urlStrong = document.createElement("strong");
  urlStrong.textContent = "Download URL: ";
  urlLink.appendChild(urlStrong);
  if (downloadUrl && /^https?:\/\//.test(downloadUrl)) {
    const urlAnchor = document.createElement("a");
    urlAnchor.href = downloadUrl;
    urlAnchor.textContent = downloadUrl.substring(0, 40) + "...";
    urlAnchor.target = "_blank";
    urlAnchor.rel = "noopener noreferrer";
    urlLink.appendChild(urlAnchor);
  } else {
    urlLink.appendChild(document.createTextNode(downloadUrl ? downloadUrl.substring(0, 40) + "..." : "N/A"));
  }

  const infoLink = document.createElement("p");
  infoLink.style.cssText = "font-size:0.9rem; color:var(--text-secondary); margin-bottom:10px;";
  const infoStrong = document.createElement("strong");
  infoStrong.textContent = "Info JSON: ";
  infoLink.appendChild(infoStrong);
  if (infoUrl && /^https?:\/\//.test(infoUrl)) {
    const infoAnchor = document.createElement("a");
    infoAnchor.href = infoUrl;
    infoAnchor.textContent = "View info.json";
    infoAnchor.target = "_blank";
    infoAnchor.rel = "noopener noreferrer";
    infoLink.appendChild(infoAnchor);
  } else {
    infoLink.appendChild(document.createTextNode("N/A"));
  }

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

  const chunkSize    = parseInt(document.getElementById("chunkSize")?.value) || 50;
  const shouldChunk  = selectedImages.length > chunkSize;
  const outputFormat = document.getElementById('outputFormat')?.value || 'jpg';

  const manifestUrl = document.getElementById('url').value;
  const imagesForWorker = selectedImages.map((img, idx) => ({
    label:    img.label,
    filename: sanitizeFilename(img.label || `image_${idx + 1}`) + '.' + outputFormat,
    urls:     buildUrlsToTry(img, idx, outputFormat),
    cacheKey: `${manifestUrl}|${sanitizeFilename(img.label || `image_${idx + 1}`)}.${outputFormat}`,
  }));

  initDownloadWorkerIfNeeded();
  if (!downloadWorker) {
    showMessage('Download worker unavailable; cannot proceed.');
    return;
  }

  workerStartTime = Date.now();
  pendingImages   = [];
  resetProgress();

  saveSession(imagesForWorker, { shouldChunk, chunkSize, timeoutMs: 30000, outputName: 'selected_images.zip' });
  setPauseButtonState('pause');

  const pb  = document.getElementById("progress_bar");
  pb.classList.remove("hide");
  pb.querySelector(".progress-bar").classList.add("progress-bar--indeterminate");
  showMessage(`Starting download — fetching ${selectedImages.length} image(s)…`);

  downloadWorker.postMessage({
    cmd:     'download',
    images:  imagesForWorker,
    options: { shouldChunk, chunkSize, timeoutMs: 30000, outputName: 'selected_images.zip' },
  });
}

// ─── Progress UI ──────────────────────────────────────────────────────────────

function showDetailedProgress(completed, total, currentAction, startTime = null, failed = 0, fromCache = 0) {
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
    ${fromCache > 0 ? `<div style="color:var(--success-color); font-size:12px;">⚡ ${fromCache} loaded from cache</div>` : ''}
    ${failed > 0 ? `<div style="color:var(--warning-color); font-size:12px;">⚠️ ${failed} image(s) failed</div>` : ''}
  `;
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

// ─── Session persistence ──────────────────────────────────────────────────────

const SESSION_KEY = 'iiif-download-session';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function saveSession(images, options) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      manifestUrl: document.getElementById('url').value,
      images,
      options,
      timestamp: Date.now(),
    }));
  } catch (e) {
    console.warn('Could not save session:', e);
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() - s.timestamp > SESSION_TTL) { clearSession(); return null; }
    return s;
  } catch { return null; }
}

function updateSessionRemaining(remaining) {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    s.images = remaining;
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {}
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ─── Pause / Resume ───────────────────────────────────────────────────────────

function pauseDownload() {
  if (!downloadWorker) return;
  downloadWorker.postMessage({ cmd: 'pause' });
  showMessage('Pausing after current image…');
}

function resumeDownload() {
  const imagesToResume = pendingImages.length > 0
    ? pendingImages
    : loadSession()?.images;

  if (!imagesToResume || imagesToResume.length === 0) {
    showMessage('No paused session to resume.');
    return;
  }

  const session = loadSession();
  const options = session?.options || { shouldChunk: false, chunkSize: 50, timeoutMs: 30000, outputName: 'selected_images.zip' };

  initDownloadWorkerIfNeeded();
  if (!downloadWorker) { showMessage('Download worker unavailable.'); return; }

  workerStartTime = Date.now();
  pendingImages   = [];
  resetProgress();
  setPauseButtonState('pause');
  showMessage(`Resuming — ${imagesToResume.length} image(s) remaining (cached images will load instantly)…`);

  downloadWorker.postMessage({ cmd: 'download', images: imagesToResume, options });
}

function setPauseButtonState(state) {
  const btn = document.getElementById('pauseResumeBtn');
  if (!btn) return;
  if (state === 'hidden') {
    btn.style.display = 'none';
  } else if (state === 'pause') {
    btn.style.display = '';
    btn.textContent   = 'Pause';
    btn.dataset.state = 'pause';
  } else if (state === 'resume') {
    btn.style.display = '';
    btn.textContent   = 'Resume';
    btn.dataset.state = 'resume';
  }
}

function clearDownloadCache() {
  initDownloadWorkerIfNeeded();
  if (downloadWorker) downloadWorker.postMessage({ cmd: 'clear-cache' });
  clearSession();
  hideSavedSessionBanner();
  showMessage('Clearing download cache…');
}

function showSavedSessionBanner(session) {
  const banner = document.getElementById('sessionBanner');
  if (!banner) return;
  const age   = Math.round((Date.now() - session.timestamp) / 60000);
  const label = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
  document.getElementById('sessionBannerText').textContent =
    `${session.images.length} image(s) from a previous download, saved ${label}. Cached images will load instantly.`;
  banner.style.display = 'flex';
}

function hideSavedSessionBanner() {
  const banner = document.getElementById('sessionBanner');
  if (banner) banner.style.display = 'none';
}

function checkForSavedSession() {
  const session = loadSession();
  if (session && session.images?.length > 0) {
    showSavedSessionBanner(session);
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  // Pre-fill token from ?token= URL param so users can bookmark a URL with it
  const urlToken = new URLSearchParams(window.location.search).get('token');
  if (urlToken) {
    const tokenInput = document.getElementById('flaskToken');
    if (tokenInput) tokenInput.value = urlToken;
  }

  document.getElementById("loadManifest").addEventListener("click", getManifest);
  document.getElementById("selectAll").addEventListener("click", selectAll);
  document.getElementById("downloadSelected").addEventListener("click", downloadSelected);

  const pauseBtn = document.getElementById("pauseResumeBtn");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      if (pauseBtn.dataset.state === 'pause') pauseDownload();
      else resumeDownload();
    });
  }

  document.getElementById("resumeSessionBtn")?.addEventListener("click", () => {
    hideSavedSessionBanner();
    resumeDownload();
  });

  document.getElementById("dismissSessionBtn")?.addEventListener("click", () => {
    hideSavedSessionBanner();
    clearSession();
  });

  document.getElementById("clearCacheBtn")?.addEventListener("click", clearDownloadCache);

  checkForSavedSession();
});

console.log("main.js loaded successfully");