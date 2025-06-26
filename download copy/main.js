var images = []; // Stores image data for display and download

// --- Core Function: Get and Display Manifest ---
async function getManifest() {
  var url = document.getElementById("url").value;
  if (!url) {
    showMessage("Please enter a manifest URL.");
    return;
  }

  showMessage("Loading manifest...");
  console.log("Fetching manifest from URL:", url);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP error! Status: ${response.status} - ${
          response.statusText
        }. Details: ${errorText.substring(0, 200)}...`
      );
    }
    const manifest = await response.json();

    console.log("Manifest loaded successfully:", manifest);
    document.getElementById("img-container").innerHTML = ""; // Clear previous images
    images = []; // Reset images array

        function buildProxyUrl(iiifBase) {
      // Works for Gallica: …/iiif/ark:/12148/btv1b55010551d/f39
      const arkMatch  = iiifBase.match(/ark:\/([^/]+\/[^/]+)/); // 12148/btv1b55010551d
      const pageMatch = iiifBase.match(/\/f(\d+)/);             // 39
      if (arkMatch && pageMatch) {
        const ark  = encodeURIComponent(arkMatch[1]);
        const page = pageMatch[1];
        return `/download?ark=${ark}&f=${page}&size=full`;
      }
      return null;   // not a Gallica IIIF URL → fall back to direct
    }

    let canvases = [];
    let isIIIFP3 = false;

    // --- IIIF Version Detection and Canvas Extraction ---
    if (
      manifest["@context"] &&
      manifest["@context"].includes(
        "http://iiif.io/api/presentation/3/context.json"
      )
    ) {
      isIIIFP3 = true;
      if (manifest.items && Array.isArray(manifest.items)) {
        canvases = manifest.items; // In P3, canvases are directly in 'items'
      }
    } else if (
      manifest.sequences &&
      manifest.sequences[0] &&
      manifest.sequences[0].canvases
    ) {
      // Assume IIIF Presentation 2.x
      canvases = manifest.sequences[0].canvases;
    }

    if (canvases.length === 0) {
      showMessage(
        "Error: No valid images or canvases found in manifest, or unrecognized IIIF structure."
      );
      console.error(
        "No valid images or canvases found or invalid manifest structure for P2/P3:",
        manifest
      );
      return;
    }

    // Check if this is a Gallica manifest and show/hide the checkbox
    const isGallicaManifest = url.includes("gallica.bnf.fr") || 
                              canvases.some(canvas => {
                                const hasGallicaUrl = JSON.stringify(canvas).includes("gallica.bnf.fr");
                                return hasGallicaUrl;
                              });
    
    const gallicaContainer = document.getElementById("gallicaContainer");
    if (isGallicaManifest) {
      gallicaContainer.style.display = "block";
      document.getElementById("gallicaCheckbox").checked = true;
    } else {
      gallicaContainer.style.display = "none";
      document.getElementById("gallicaCheckbox").checked = false;
    }

    // --- Process Each Canvas ---
    canvases.forEach((canvas, index) => {
      console.log("Processing canvas:", canvas);
      let thumbnailUrl = "";
      let fullImageUrlBase = "";
      let imageLabel = he.decode(canvas.label || `Image ${index + 1}`);

      // Debug: Log the raw canvas structure
      console.log(`Canvas ${index} structure:`, {
        label: canvas.label,
        images: canvas.images,
        items: canvas.items,
      });
      // --- Extract Image URLs based on IIIF Version and Fallbacks ---
      if (isIIIFP3) {
        // --- Try IIIF Presentation 3.0 parsing first ---
        const annotationPage = canvas.items && canvas.items[0];
        const annotation =
          annotationPage && annotationPage.items && annotationPage.items[0];
        const body = annotation && annotation.body;

        if (body) {
          if (
            body.service &&
            Array.isArray(body.service) &&
            body.service.length > 0
          ) {
            const imageService = body.service.find(
              (s) =>
                s.id &&
                (s.id.includes("/iiif/image/") ||
                  s.id.match(/\/images\/.+\/?$/) ||
                  s.type === "ImageService2" ||
                  s.type === "ImageService3")
            );
            if (imageService) {
              fullImageUrlBase = imageService.id.endsWith("/")
                ? imageService.id.slice(0, -1)
                : imageService.id;
              thumbnailUrl = `${fullImageUrlBase}/full/!400,400/0/default.jpg`;
            } else if (body.id) {
              fullImageUrlBase = body.id;
              thumbnailUrl = body.id;
            }
          } else if (body.id) {
            fullImageUrlBase = body.id;
            thumbnailUrl = body.id;
          }
        }

        // --- FALLBACK for P3 manifests that embed P2-style images array ---
        if (!thumbnailUrl) {
          console.log(
            "P3 parsing failed for canvas, attempting P2 fallback:",
            canvas
          );
          const imageResource =
            canvas.images && canvas.images[0] && canvas.images[0].resource;
          if (imageResource) {
            if (imageResource.service && imageResource.service["@id"]) {
              fullImageUrlBase = imageResource.service["@id"].endsWith("/")
                ? imageResource.service["@id"].slice(0, -1)
                : imageResource.service["@id"];
              thumbnailUrl = `${fullImageUrlBase}/full/!400,400/0/default.jpg`;
            } else if (imageResource["@id"]) {
              fullImageUrlBase = imageResource["@id"];
              thumbnailUrl = imageResource["@id"];
            }
          }
        }
      } else {
        // This block handles true IIIF Presentation 2.x manifests
        const imageResource =
          canvas.images && canvas.images[0] && canvas.images[0].resource;
        if (imageResource) {
          if (imageResource.service && imageResource.service["@id"]) {
            fullImageUrlBase = imageResource.service["@id"].endsWith("/")
              ? imageResource.service["@id"].slice(0, -1)
              : imageResource.service["@id"];
            thumbnailUrl = `${fullImageUrlBase}/full/!400,400/0/default.jpg`;
          } else if (imageResource["@id"]) {
            fullImageUrlBase = imageResource["@id"];
            thumbnailUrl = imageResource["@id"];
          }
        }
      }

      if (!thumbnailUrl) {
        console.warn(
          "Could not determine image URL for canvas. Canvas data:",
          canvas
        );
        return; // Skip this canvas if no displayable image URL found
      }

      // Determine download URL (full resolution)
      let downloadUrl = fullImageUrlBase;
      if (
        fullImageUrlBase &&
        (fullImageUrlBase.includes("/iiif/image/") ||
          fullImageUrlBase.match(/\/images\/.+\/?$/) ||
          fullImageUrlBase.match(/\/loris\/.+$/) ||
          fullImageUrlBase.includes("iiifimage") ||
          fullImageUrlBase.includes("gallica.bnf.fr/iiif"))
      ) {
        // Try different IIIF Image API parameters based on institution
        if (
          fullImageUrlBase.includes("vatlib") ||
          fullImageUrlBase.includes("digi.vatlib")
        ) {
          // Vatican Library uses specific parameters: /full/full/0/native.jpg
          downloadUrl = `${fullImageUrlBase}/full/full/0/native.jpg`;
        } else if (fullImageUrlBase.includes("gallica.bnf.fr")) {
          // Gallica (French National Library) uses: /full/full/0/native.jpg
          downloadUrl = `${fullImageUrlBase}/full/full/0/native.jpg`;
        } else if (fullImageUrlBase.includes("fragmentarium")) {
          // Fragmentarium might need different parameters
          downloadUrl = `${fullImageUrlBase}/full/full/0/default.jpg`;
        } else {
          downloadUrl = `${fullImageUrlBase}/full/max/0/default.jpg`;
        }
      }

      console.log(`Canvas ${index}: fullImageUrlBase = ${fullImageUrlBase}`);
      console.log(`Canvas ${index}: downloadUrl = ${downloadUrl}`);
      // Standardize the info URL for the service (if an Image Service was found)
      const isIIIFImageService =
        fullImageUrlBase &&
        (fullImageUrlBase.includes("/iiif/image/") ||
          fullImageUrlBase.match(/\/images\/.+\/?$/));
      var infoUrl = isIIIFImageService ? `${fullImageUrlBase}/info.json` : null;
      const proxyUrl = buildProxyUrl(fullImageUrlBase); 

      images.push({
        url: downloadUrl,       // original remote image
        proxy: proxyUrl,        // same image via your Flask proxy
        info: infoUrl,
        label: imageLabel,
      });

      // --- Create HTML Elements for Image Display ---
      var container = document.createElement("div");
      container.className = "image-card fade-in-up";

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `img-${images.length - 1}`;
      checkbox.value = images.length - 1;
      checkbox.setAttribute("aria-label", `Select ${imageLabel}`);

      var labelWrapper = document.createElement("label");
      labelWrapper.htmlFor = `img-${images.length - 1}`;
      labelWrapper.style.display = "block";

      var imgElement = document.createElement("img");
      imgElement.src = thumbnailUrl;
      imgElement.alt = imageLabel;
      imgElement.style.maxWidth = "100%";
      imgElement.style.height = "auto";
      imgElement.style.display = "block";
      imgElement.style.marginBottom = "10px";
      imgElement.style.borderRadius = "var(--radius-md)";
      imgElement.style.border = "1px solid var(--border-color)";

      labelWrapper.appendChild(imgElement);

      var labelText = document.createElement("p");
      labelText.textContent = imageLabel;
      labelText.style.fontWeight = "bold";
      labelText.style.marginBottom = "5px";
      labelText.style.color = "var(--text-primary)";
      labelText.style.fontSize = "1.1rem";

      var apiLink = document.createElement("p");
      apiLink.innerHTML = `<strong>Download URL:</strong> <a href="${downloadUrl}" target="_blank" rel="noopener noreferrer">${downloadUrl.substring(
        0,
        40
      )}...</a>`;
      apiLink.style.fontSize = "0.9rem";
      apiLink.style.color = "var(--text-secondary)";
      apiLink.style.marginBottom = "3px";

      var infoJsonLink = document.createElement("p");
      if (infoUrl) {
        infoJsonLink.innerHTML = `<strong>Info JSON:</strong> <a href="${infoUrl}" target="_blank" rel="noopener noreferrer">View info.json</a>`;
      } else {
        infoJsonLink.textContent = `Info JSON: N/A`;
      }
      infoJsonLink.style.fontSize = "0.9rem";
      infoJsonLink.style.color = "var(--text-secondary)";
      infoJsonLink.style.marginBottom = "10px";

      var selectContainer = document.createElement("div");
      selectContainer.style.display = "flex";
      selectContainer.style.alignItems = "center";
      selectContainer.style.gap = "8px";
      selectContainer.style.marginBottom = "10px";
      selectContainer.appendChild(checkbox);
      var selectLabelText = document.createElement("span");
      selectLabelText.textContent = "Select for Download";
      selectContainer.appendChild(selectLabelText);

      container.appendChild(selectContainer);
      container.appendChild(labelWrapper);
      container.appendChild(labelText);
      container.appendChild(apiLink);
      container.appendChild(infoJsonLink);

      document.getElementById("img-container").appendChild(container);
    });

    showMessage(`Manifest loaded successfully. ${images.length} images found.`);
  } catch (error) {
    showMessage(`Error loading manifest: ${error.message}`);
    console.error("Error loading manifest:", error);
  }
}

// --- Utility Functions ---
function selectAll() {
  var checkboxes = document.querySelectorAll('input[type="checkbox"]');
  var allChecked = Array.from(checkboxes).every((checkbox) => checkbox.checked);
  checkboxes.forEach((checkbox) => (checkbox.checked = !allChecked));
}

// --- Download Selected Images (with Gallica rate limiting support) ---
async function downloadSelected() {
  var selectedImages = Array.from(
    document.querySelectorAll('input[type="checkbox"]:checked')
  ).map((checkbox) => images[parseInt(checkbox.value)]);

  if (selectedImages.length === 0) {
    showMessage(
      "No images selected. Please select at least one image to download."
    );
    return;
  }

  // Check if Gallica rate limiting is enabled
  const isGallica = document.getElementById("gallicaCheckbox") && 
                    document.getElementById("gallicaCheckbox").checked;

  if (isGallica) {
    // Use sequential download with rate limiting for Gallica
    await downloadSelectedSequential(selectedImages);
  } else {
    // Use parallel download for other manuscripts
    downloadSelectedParallel(selectedImages);
  }
}

// --- Sequential Download with Rate Limiting (for Gallica) ---
async function downloadSelectedSequential(selectedImages) {
  var zip = new JSZip();
  var count = 0;
  var errors = 0;

  showMessage("Preparing images for download (with rate limiting)...");
  resetProgress();

  console.log(`Starting sequential download of ${selectedImages.length} images...`);
  console.log("Selected images:", selectedImages);

  for (let i = 0; i < selectedImages.length; i++) {
    const img = selectedImages[i];
    console.log(`Processing image ${i}:`, img);
    
    if (!img) {
      console.error(`Image at index ${i} is undefined`);
      errors++;
      count++;
      continue;
    }
    
    const filename = sanitizeFilename(img.label) + ".jpg";
    const urlsToTry = [];
    
    // Build URLs to try in order of preference
    if (img.proxy) urlsToTry.push(img.proxy);
    if (img.url) urlsToTry.push(img.url);
    
    // Add fallback URLs if it's a IIIF URL
    if (img.url && img.url.includes("/full/")) {
      const baseUrl = img.url.split("/full/")[0];
      if (baseUrl.includes("gallica.bnf.fr")) {
        const corsProxy = "https://api.allorigins.win/raw?url=";
        urlsToTry.push(
          corsProxy + encodeURIComponent(`${baseUrl}/full/full/0/native.jpg`),
          corsProxy + encodeURIComponent(`${baseUrl}/full/full/0/default.jpg`),
          corsProxy + encodeURIComponent(`${baseUrl}/full/max/0/native.jpg`),
          corsProxy + encodeURIComponent(`${baseUrl}/full/max/0/default.jpg`),
          `${baseUrl}/full/full/0/native.jpg`,
          `${baseUrl}/full/full/0/default.jpg`
        );
      }
    }
    
    console.log(`URLs to try for ${filename}:`, urlsToTry);

    
    let success = false;

    for (const url of urlsToTry) {
      try {
        console.log(`Attempting download: ${url}`);
        const data = await fetchBinary(url);

        let binaryData;
        if (typeof data === "string") {
          binaryData = new Uint8Array(data.length);
          for (let j = 0; j < data.length; j++) {
            binaryData[j] = data.charCodeAt(j) & 0xff;
          }
        } else if (data instanceof ArrayBuffer) {
          binaryData = new Uint8Array(data);
        } else {
          binaryData = data;
        }

        if (binaryData.length > 1000) {
          zip.file(filename, binaryData, { binary: true });
          console.log(`✓ Added ${filename} to zip: ${binaryData.length} bytes`);
          success = true;
          break;
        } else {
          console.warn(`Data too small (${binaryData.length} bytes)`);
        }
      } catch (err) {
        console.warn(`Failed to download from ${url}:`, err);
      }
    }

    if (!success) {
      console.error(`Failed to download ${filename} from all URLs`);
      errors++;
    }

    count++;
    updateProgress((count / selectedImages.length) * 100);

    // Add delay between downloads for Gallica (except for the last image)
    if (count < selectedImages.length) {
      showMessage(`Downloaded ${count}/${selectedImages.length} images. Waiting 15 seconds...`);
      await sleep(15000);
      showMessage(`Downloading image ${count + 1}/${selectedImages.length}...`);
    }
  }

  await completeZipDownload(zip, count, errors, selectedImages.length);
}

// --- Parallel Download (for non-Gallica manuscripts) ---
function downloadSelectedParallel(selectedImages) {
  var zip = new JSZip();
  var count = 0;
  var errors = 0;

  showMessage("Preparing images for download...");
  resetProgress();

  console.log(`Starting parallel download of ${selectedImages.length} images...`);

  selectedImages.forEach(function (img, index) {
    var filename = sanitizeFilename(img.label) + ".jpg";

    console.log(`Downloading ${filename} from ${img.url}`);

    // For IIIF servers that might not support our first URL attempt,
    // let's try a few different approaches
    const urlsToTry = [];
    if (img.proxy) urlsToTry.push(img.proxy);   // ① local backend (no CORS)
    urlsToTry.push(img.url); // ② original URL (may fail due to CORS)   

    // If it's a IIIF URL that failed, try some alternatives
    if (img.url.includes("/full/")) {
      const baseUrl = img.url.split("/full/")[0];

      if (baseUrl.includes("vatlib") || baseUrl.includes("digi.vatlib")) {
        // Vatican Library specific fallbacks
        urlsToTry.push(
          `${baseUrl}/full/full/0/native.jpg`,
          `${baseUrl}/full/1000,/0/native.jpg`,
          `${baseUrl}/full/max/0/native.jpg`,
          `${baseUrl}/full/full/0/default.jpg`
        );
      } else if (baseUrl.includes("gallica.bnf.fr")) {
        // Gallica (French National Library) has very strict CORS - try proxied versions
        const corsProxy = "https://api.allorigins.win/raw?url=";
        urlsToTry.push(
          corsProxy + encodeURIComponent(`${baseUrl}/full/full/0/native.jpg`),
          corsProxy + encodeURIComponent(`${baseUrl}/full/full/0/default.jpg`),
          corsProxy + encodeURIComponent(`${baseUrl}/full/max/0/native.jpg`),
          corsProxy + encodeURIComponent(`${baseUrl}/full/max/0/default.jpg`),
          corsProxy + encodeURIComponent(`${baseUrl}/full/1000,/0/native.jpg`),
          `${baseUrl}/full/full/0/native.jpg`, // Try direct as last resort
          `${baseUrl}/full/full/0/default.jpg`
        );
      } else {
        // Standard IIIF fallbacks
        urlsToTry.push(
          `${baseUrl}/full/max/0/default.jpg`,
          `${baseUrl}/full/full/0/default.jpg`,
          `${baseUrl}/full/1000,/0/default.jpg`,
          `${baseUrl}/full/,1000/0/default.jpg`,
          baseUrl // Try the base image service URL directly
        );
      }
    }

    let attemptIndex = 0;

    function tryDownload() {
      if (attemptIndex >= urlsToTry.length) {
        errors++;
        console.error(`All download attempts failed for ${filename}`);
        count++;
        updateProgress((count / selectedImages.length) * 100);

        if (count === selectedImages.length) {
          completeZipDownload(zip, count, errors, selectedImages.length);
        }
        return;
      }

      const currentUrl = urlsToTry[attemptIndex];
      console.log(`Attempt ${attemptIndex + 1} for ${filename}: ${currentUrl}`);

      JSZipUtils.getBinaryContent(currentUrl, function (err, data) {
        if (err) {
          console.log(
            `Attempt ${attemptIndex + 1} failed for ${filename}:`,
            err
          );
          attemptIndex++;
          tryDownload(); // Try next URL
          return;
        }

        console.log(
          `✓ Successfully downloaded ${filename}`,
          typeof data,
          data.length || data.byteLength
        );

        // Handle different data types that JSZipUtils might return
        let binaryData;
        if (typeof data === "string") {
          // JSZipUtils often returns binary strings - convert to Uint8Array
          binaryData = new Uint8Array(data.length);
          for (let i = 0; i < data.length; i++) {
            binaryData[i] = data.charCodeAt(i) & 0xff;
          }
          console.log(
            `Converted string to Uint8Array: ${binaryData.length} bytes`
          );
        } else if (data instanceof ArrayBuffer) {
          binaryData = new Uint8Array(data);
          console.log(`Using ArrayBuffer: ${binaryData.length} bytes`);
        } else {
          binaryData = data;
          console.log(`Using data as-is: ${data.length} bytes`);
        }

        // Verify we have actual image data (should be much larger than 500 bytes for real images)
        if (binaryData.length > 1000) {
          zip.file(filename, binaryData, { binary: true });
          console.log(`✓ Added ${filename} to zip: ${binaryData.length} bytes`);
        } else {
          console.log(
            `Data too small (${binaryData.length} bytes), trying next URL...`
          );
          attemptIndex++;
          tryDownload(); // Try next URL
          return;
        }

        count++;
        updateProgress((count / selectedImages.length) * 100);

        // When all downloads are complete (successful or failed)
        if (count === selectedImages.length) {
          completeZipDownload(zip, count, errors, selectedImages.length);
        }
      });
    }

    tryDownload(); // Start the download attempts
  });
}

// --- Complete Zip Download (shared by both sequential and parallel) ---
async function completeZipDownload(zip, count, errors, totalImages) {
  const successCount = count - errors;

  if (successCount === 0) {
    showMessage("Error: No images were successfully downloaded.");
    resetProgress();
    return;
  }

  showMessage("Creating zip file...");

  try {
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "selected_images.zip");
    showMessage(
      `Download complete! ${successCount}/${totalImages} images downloaded.${
        errors > 0 ? ` ${errors} failed.` : ""
      }`
    );
    resetProgress();
  } catch (error) {
    showMessage("Error creating zip file.");
    console.error("Error creating zip file:", error);
    resetProgress();
  }
}

// --- Helper Functions ---
function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 100);
}

function showMessage(text) {
  var resultContainer = document.getElementById("result");
  resultContainer.innerText = text;
}

function resetProgress() {
  var progressBar = document.getElementById("progress_bar");
  progressBar.querySelector(".progress-bar").style.width = "0%";
  progressBar.querySelector(".progress-bar").innerText = "0%";
  progressBar.classList.add("hide");
}

function updateProgress(percent) {
  var progressBar = document.getElementById("progress_bar");
  progressBar.classList.remove("hide");
  progressBar.querySelector(".progress-bar").style.width = percent + "%";
  progressBar.querySelector(".progress-bar").innerText =
    Math.round(percent) + "%";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    JSZipUtils.getBinaryContent(url, function (err, data) {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// --- Event Listeners ---
document.addEventListener("DOMContentLoaded", function () {
  document
    .getElementById("loadManifest")
    .addEventListener("click", getManifest);
  document.getElementById("selectAll").addEventListener("click", selectAll);
  document
    .getElementById("downloadSelected")
    .addEventListener("click", downloadSelected);
});

console.log(
  "main.js loaded successfully with Gallica rate limiting support"
);