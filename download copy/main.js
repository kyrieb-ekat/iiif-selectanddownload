var images = [];

function getManifest() {
  var url = document.getElementById("url").value;
  if (!url) {
    showMessage("Please enter a manifest URL.");
    return;
  }

  showMessage("Loading manifest...");
  console.log("Fetching manifest from URL:", url);

  $.getJSON(url)
    .done(function (manifest) {
      console.log("Manifest loaded successfully:", manifest);
      document.getElementById("img-container").innerHTML = "";
      images = [];

      if (
        !manifest.sequences ||
        !manifest.sequences[0] ||
        !manifest.sequences[0].canvases
      ) {
        showMessage("Error: Invalid manifest structure.");
        console.error("Invalid manifest structure:", manifest);
        return;
      }

      manifest.sequences[0].canvases.forEach((canvas, index) => {
        console.log("Processing canvas:", canvas);
        if (!canvas.images || !canvas.images[0] || !canvas.images[0].resource) {
          console.warn("Invalid canvas structure:", canvas);
          return;
        }

        var img = canvas.images[0].resource;
        var info =
          img.service && img.service["@id"] ? img.service["@id"] : null;
        if (info && !info.endsWith("/info.json")) info += "/info.json";

        images.push({
          url: img["@id"],
          info: info,
          label: he.decode(canvas.label || `Image ${index + 1}`),
        });

        // Create HTML elements dynamically
        var container = document.createElement("div");
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = `img-${index}`;
        checkbox.value = index;
        checkbox.setAttribute("aria-label", `Select ${images[index].label}`);

        var label = document.createElement("label");
        label.htmlFor = `img-${index}`;
        var imgElement = document.createElement("img");
        imgElement.src = img["@id"];
        imgElement.alt = he.decode(canvas.label || `Image ${index + 1}`);
        imgElement.style.width = "100px";

        label.appendChild(imgElement);

        var labelText = document.createElement("p");
        labelText.textContent = he.decode(canvas.label || `Image ${index + 1}`);

        var directLink = document.createElement("p");
        directLink.textContent = `Direct link: ${img["@id"]}`;

        var infoLink = document.createElement("p");
        infoLink.textContent = `Image info link: ${info || "N/A"}`;

        container.appendChild(checkbox);
        container.appendChild(label);
        container.appendChild(labelText);
        container.appendChild(directLink);
        container.appendChild(infoLink);
        document.getElementById("img-container").appendChild(container);
      });
      showMessage(
        `Manifest loaded successfully. ${images.length} images found.`
      );
    })
    .fail(function (jqXHR, textStatus, errorThrown) {
      showMessage(`Error loading manifest: ${textStatus}, ${errorThrown}`);
      console.error("Error loading manifest:", textStatus, errorThrown);
    });
}

function selectAll() {
  var checkboxes = document.querySelectorAll('input[type="checkbox"]');
  var allChecked = Array.from(checkboxes).every((checkbox) => checkbox.checked);
  checkboxes.forEach((checkbox) => (checkbox.checked = !allChecked));
}

// COMPLETELY REWRITTEN: Parallel processing with enhanced progress tracking
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
    // Configure zip.js for streaming
    zip.configure({
      useWebWorkers: true, // Enable web workers for better performance
      maxWorkers: 4, // Allow more concurrent workers
    });

    // Create streaming zip writer
    const fileStream = streamSaver.createWriteStream("selected_images.zip");
    const zipWriter = new zip.ZipWriter(fileStream);

    console.log(`Starting download of ${selectedImages.length} images...`);

    // Track progress
    let completed = 0;
    let failed = 0;
    const startTime = Date.now();

    // Process images in parallel batches (controlled concurrency)
    const BATCH_SIZE = 5; // Process 5 images simultaneously
    const results = [];

    for (let i = 0; i < selectedImages.length; i += BATCH_SIZE) {
      const batch = selectedImages.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      const batchPromises = batch.map(async (img, batchIndex) => {
        const globalIndex = i + batchIndex;
        const filename = sanitizeFilename(img.label) + ".jpg";

        try {
          updateDetailedProgress(
            completed,
            selectedImages.length,
            `Downloading ${filename}...`,
            startTime,
            failed
          );

          // Fetch image with timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout

          const response = await fetch(img.url, {
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          // Add to zip
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
          console.error(`✗ Error processing ${filename}:`, error);

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

      // Wait for this batch to complete before starting next batch
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Small delay between batches to prevent overwhelming the server
      if (i + BATCH_SIZE < selectedImages.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Close the zip and start download
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

    setTimeout(() => resetProgress(), 3000); // Hide progress after 3 seconds

    console.log(
      `Zip creation completed: ${successCount}/${selectedImages.length} successful, ${failed} failed`
    );
  } catch (error) {
    showMessage("Error creating zip file: " + error.message);
    console.error("Error creating zip file:", error);
    resetProgress();
  }
}

// NEW FUNCTION: Sanitize filenames for zip compatibility
function sanitizeFilename(filename) {
  // Remove or replace characters that might cause issues in zip files
  return filename
    .replace(/[<>:"/\\|?*]/g, "_") // Replace illegal characters
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/_{2,}/g, "_") // Replace multiple underscores with single
    .replace(/^_|_$/g, "") // Remove leading/trailing underscores
    .substring(0, 100); // Limit length to avoid filesystem issues
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

  // Also reset detailed progress
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

// NEW FUNCTION: Enhanced progress display with detailed information
function showDetailedProgress(
  completed,
  total,
  currentAction,
  startTime = null,
  failed = 0
) {
  let detailedProgress = document.getElementById("detailed_progress");

  // Create detailed progress element if it doesn't exist
  if (!detailedProgress) {
    detailedProgress = document.createElement("div");
    detailedProgress.id = "detailed_progress";
    detailedProgress.style.cssText = `
            margin: 15px 0;
            padding: 15px;
            background: #f5f5f5;
            border-radius: 8px;
            border-left: 4px solid #007bff;
            font-family: monospace;
            font-size: 14px;
            line-height: 1.4;
        `;

    // Insert after the main progress bar
    const progressBar = document.getElementById("progress_bar");
    progressBar.parentNode.insertBefore(
      detailedProgress,
      progressBar.nextSibling
    );
  }

  detailedProgress.style.display = "block";

  // Calculate stats
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

  // Build status display
  let statusHtml = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <strong>Download Progress</strong>
            <span style="color: #007bff;">${percentage}% (${completed}/${total})</span>
        </div>
    `;

  if (timeInfo) {
    statusHtml += `
            <div style="color: #666; margin-bottom: 8px; font-size: 12px;">
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
            <div style="color: #dc3545; font-size: 12px;">
                ⚠️ ${failed} image(s) failed to download
            </div>
        `;
  }

  detailedProgress.innerHTML = statusHtml;
}

// NEW FUNCTION: Update detailed progress during download
function updateDetailedProgress(
  completed,
  total,
  currentAction,
  startTime,
  failed = 0
) {
  showDetailedProgress(completed, total, currentAction, startTime, failed);
}

// NEW FUNCTION: Format seconds into readable time
function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

// Add event listeners after the DOM is fully loaded
document.addEventListener("DOMContentLoaded", function () {
  document
    .getElementById("loadManifest")
    .addEventListener("click", getManifest);
  document.getElementById("selectAll").addEventListener("click", selectAll);
  document
    .getElementById("downloadSelected")
    .addEventListener("click", downloadSelected);
});

console.log("main.js loaded successfully with streaming zip support");
