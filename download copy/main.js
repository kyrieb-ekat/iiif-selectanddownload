var images = []; // Stores image data for display and download

// --- Core Function: Get and Display Manifest ---
var images = []; // Stores image data for display and download

// --- Core Function: Get and Display Manifest ---
var images = []; // Stores image data for display and download

// --- Core Function: Get and Display Manifest ---
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

    // --- Process Each Canvas ---
    canvases.forEach((canvas, index) => {
      console.log("Processing canvas:", canvas);
      let thumbnailUrl = "";
      let fullImageUrlBase = "";
      let imageLabel = he.decode(canvas.label || `Image ${index + 1}`);

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
        // If no image URL found with P3 parsing, try P2 parsing within this canvas
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

      // Standardize the info URL for the service (if an Image Service was found)
      const isIIIFImageService =
        fullImageUrlBase &&
        (fullImageUrlBase.includes("/iiif/image/") ||
          fullImageUrlBase.match(/\/images\/.+\/?$/) ||
          fullImageUrlBase.match(/\/iiif\/[0-9]\/?$/));
      var infoUrl = isIIIFImageService ? `${fullImageUrlBase}/info.json` : null;

      // Store image data
      images.push({
        thumbnail: thumbnailUrl,
        fullImageApiBase: fullImageUrlBase,
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
      apiLink.innerHTML = `<strong>Image API Base:</strong> <a href="${fullImageUrlBase}" target="_blank" rel="noopener noreferrer">${fullImageUrlBase.substring(
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

// --- Download Selected Images ---
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

  showMessage("Preparing images for download...");
  resetProgress();
  showDetailedProgress(0, selectedImages.length, "Initializing...");

  try {
    zip.configure({
      useWebWorkers: true,
      maxWorkers: 4,
    });

    const fileStream = streamSaver.createWriteStream("selected_images.zip");
    const zipWriter = new zip.ZipWriter(fileStream);

    console.log(`Starting download of ${selectedImages.length} images...`);

    let completed = 0;
    let failed = 0;
    const startTime = Date.now();

    const BATCH_SIZE = 5;
    const results = [];

    for (let i = 0; i < selectedImages.length; i += BATCH_SIZE) {
      const batch = selectedImages.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (img, batchIndex) => {
        const globalIndex = i + batchIndex;
        const filename = sanitizeFilename(img.label) + ".jpg";

        // --- CRUCIAL: Construct full-resolution image URL for download ---
        // If it's a IIIF Image API base, request full/max size.
        // Otherwise, assume it's a direct image URL and use it as is.
        let imageUrlToDownload = img.fullImageApiBase;
        if (
          imageUrlToDownload &&
          (imageUrlToDownload.includes("/iiif/image/") ||
            imageUrlToDownload.match(/\/images\/.+\/?$/))
        ) {
          imageUrlToDownload = `${imageUrlToDownload}/full/max/0/default.jpg`;
        }
        // If fullImageApiBase was null or not an Image API, img.thumbnail would be the direct image URL,
        // so we could fall back to that if fullImageApiBase wasn't specifically an image service.
        // For simplicity and robustness, we'll use `fullImageApiBase` as the source for the highest resolution.
        // If it was a direct image URL, it's already "full".

        try {
          updateDetailedProgress(
            completed,
            selectedImages.length,
            `Downloading ${filename}...`,
            startTime,
            failed
          );

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000);

          const response = await fetch(imageUrlToDownload, {
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}: ${response.statusText} from ${imageUrlToDownload}`
            );
          }

          await zipWriter.add(filename, response.body);

          completed++;
          updateDetailedProgress(
            completed,
            selectedImages.length,
            `Added ${filename}`,
            startTime,
            failed
          );
          updateProgress((completed / selectedImages.length) * 100);

          console.log(
            `✓ Successfully added ${filename} (${completed}/${selectedImages.length})`
          );
          return { success: true, filename, index: globalIndex };
        } catch (error) {
          failed++;
          console.error(
            `✗ Error processing ${filename} (URL: ${imageUrlToDownload}):`,
            error
          );

          updateDetailedProgress(
            completed,
            selectedImages.length,
            `Failed: ${filename}`,
            startTime,
            failed
          );

          return {
            success: false,
            filename,
            error: error.message,
            index: globalIndex,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      if (i + BATCH_SIZE < selectedImages.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    updateDetailedProgress(
      completed,
      selectedImages.length,
      "Finalizing zip file...",
      startTime,
      failed
    );
    await zipWriter.close();

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const successCount = results.filter((r) => r.success).length;

    showMessage(
      `Download complete! ${successCount}/${
        selectedImages.length
      } images downloaded in ${totalTime}s. ${
        failed > 0 ? `${failed} failed.` : ""
      }`
    );
    showDetailedProgress(
      completed,
      selectedImages.length,
      "Complete!",
      startTime,
      failed
    );

    setTimeout(() => resetProgress(), 3000);

    console.log(
      `Zip creation completed: ${successCount}/${selectedImages.length} successful, ${failed} failed`
    );
  } catch (error) {
    showMessage("Error creating zip file: " + error.message);
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

  const detailedProgress = document.getElementById("detailed_progress");
  if (detailedProgress) {
    detailedProgress.style.display = "none";
  }
}

function updateProgress(percent) {
  var progressBar = document.getElementById("progress_bar");
  progressBar.classList.remove("hide");
  progressBar.querySelector(".progress-bar").style.width = percent + "%";
  progressBar.querySelector(".progress-bar").innerText =
    Math.round(percent) + "%";
}

function showDetailedProgress(
  completed,
  total,
  currentAction,
  startTime = null,
  failed = 0
) {
  let detailedProgress = document.getElementById("detailed_progress");

  if (!detailedProgress) {
    detailedProgress = document.createElement("div");
    detailedProgress.id = "detailed_progress";
    detailedProgress.style.cssText = `
            margin: 15px 0;
            padding: 15px;
            background: var(--surface-color); /* Using CSS variable */
            border-radius: var(--radius-md); /* Using CSS variable */
            border-left: 4px solid var(--accent-color); /* Using CSS variable */
            font-family: monospace;
            font-size: 14px;
            line-height: 1.4;
            color: var(--text-primary); /* Using CSS variable */
        `;

    const progressSection = document.getElementById("progress_bar");
    progressSection.parentNode.insertBefore(
      detailedProgress,
      progressSection.nextSibling
    );
  }

  detailedProgress.style.display = "block";

  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  let timeInfo = "";

  if (startTime && completed > 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    const avgTime = elapsed / completed;
    const remaining = (total - completed) * avgTime;
    const eta =
      remaining > 0 ? `ETA: ${formatTime(remaining)}` : "Almost done!";
    timeInfo = `Time: ${formatTime(elapsed)} | ${eta}`;
  }

  let statusHtml = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <strong>Download Progress</strong>
            <span style="color: var(--primary-color);">${percentage}% (${completed}/${total})</span>
        </div>
    `;

  if (timeInfo) {
    statusHtml += `
            <div style="color: var(--text-secondary); margin-bottom: 8px; font-size: 12px;">
                ${timeInfo}
            </div>
        `;
  }

  statusHtml += `
        <div style="margin-bottom: 8px;">
            <strong>Status:</strong> ${currentAction}
        </div>
    `;

  if (failed > 0) {
    statusHtml += `
            <div style="color: var(--warning-color); font-size: 12px;">
                ⚠️ ${failed} image(s) failed to download
            </div>
        `;
  }

  detailedProgress.innerHTML = statusHtml;
}

function updateDetailedProgress(
  completed,
  total,
  currentAction,
  startTime,
  failed = 0
) {
  showDetailedProgress(completed, total, currentAction, startTime, failed);
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
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
  "main.js loaded successfully with IIIF P2/P3 auto-detection and streaming zip support"
);
