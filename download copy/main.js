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
      // Check if this is a CNRS URL that might need proxying
      if (iiifBase && iiifBase.includes("iiif.irht.cnrs.fr")) {
        // For CNRS URLs, try to extract ARK and folio info
        const arkMatch = iiifBase.match(/ark:\/([^/]+\/[^/]+)/);
        const folioMatch = iiifBase.match(/\/f(\d+)/);
        
        if (arkMatch && folioMatch) {
          const ark = arkMatch[1];
          const folio = folioMatch[1];
          return `/download?ark=${encodeURIComponent(ark)}&f=${folio}&size=full`;
        }
      }
      
      // Works for Gallica: …/iiif/ark:/12148/btv1b55010551d/f39
      const arkMatch = iiifBase.match(/ark:\/([^/]+\/[^/]+)/);
      const pageMatch = iiifBase.match(/\/f(\d+)/);
      if (arkMatch && pageMatch) {
        const ark = arkMatch[1];
        const page = pageMatch[1];
        return `/download?ark=${encodeURIComponent(ark)}&f=${page}&size=full`;
      }
      
      return null; // not a recognized IIIF URL → fall back to direct
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
    
    // Only show/hide the container if it exists, don't auto-check
    const gallicaContainer = document.getElementById("gallicaContainer");
    if (gallicaContainer) {
      if (isGallicaManifest) {
        gallicaContainer.style.display = "block";
        // Don't automatically check - let user decide
        // document.getElementById("gallicaCheckbox").checked = true;
      } else {
        gallicaContainer.style.display = "none";
        document.getElementById("gallicaCheckbox").checked = false;
      }
    }

    // Show chunking options if we have many images
    const chunkContainer = document.getElementById("chunkContainer");
    if (chunkContainer && canvases.length > 50) {
      chunkContainer.style.display = "block";
    } else if (chunkContainer) {
      chunkContainer.style.display = "none";
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

// Helper function to build all possible URLs to try
// Enhanced buildUrlsToTry function with better CNRS support
// Enhanced buildUrlsToTry function with Vatican Library support
// Enhanced buildUrlsToTry function with Montecassino/Vatican support
function buildUrlsToTry(img, index) {
  const urlsToTry = [];
  
  console.log(`Building URLs for image ${index}:`, img);
  
  // 1. Try proxy first if available
  if (img.proxy) {
    urlsToTry.push(img.proxy);
    console.log(`Added proxy URL: ${img.proxy}`);
  }
  
  // 2. Add the primary URL first
  if (img.url) {
    urlsToTry.push(img.url);
  }
  
  // 3. Montecassino/Vatican Digital Library specific handling
  if (img.url && (img.url.includes("omnes.dbseret.com") || img.url.includes("montecassino") || img.url.includes("vatlib") || img.url.includes("digi.vatlib") || img.url.includes("vatican"))) {
    console.log(`Detected Montecassino/Vatican URL: ${img.url}`);
    
    if (img.url.includes("/full/")) {
      const baseUrl = img.url.split("/full/")[0];
      
      // Montecassino/Vatican specific patterns
      urlsToTry.push(
        // Try the original URL first (already added above, but ensure it's there)
        img.url,
        
        // Standard IIIF patterns that Vatican/Montecassino typically supports
        `${baseUrl}/full/full/0/default.jpg`,
        `${baseUrl}/full/max/0/default.jpg`,
        `${baseUrl}/full/full/0/native.jpg`,
        `${baseUrl}/full/max/0/native.jpg`,
        
        // Try removing the current size parameters and using standard ones
        `${baseUrl}/full/1200,/0/default.jpg`,
        `${baseUrl}/full/800,/0/default.jpg`,
        `${baseUrl}/full/600,/0/default.jpg`,
        `${baseUrl}/full/400,/0/default.jpg`,
        
        // Try height-based sizing
        `${baseUrl}/full/,1200/0/default.jpg`,
        `${baseUrl}/full/,800/0/default.jpg`,
        `${baseUrl}/full/,600/0/default.jpg`,
        
        // Try exact dimensions that Vatican often uses
        `${baseUrl}/full/800,1067/0/default.jpg`,
        `${baseUrl}/full/600,800/0/default.jpg`,
        `${baseUrl}/full/1200,1600/0/default.jpg`,
        
        // Try without rotation parameter (remove /0/)
        `${baseUrl}/full/full/default.jpg`,
        `${baseUrl}/full/max/default.jpg`,
        `${baseUrl}/full/1200,/default.jpg`,
        `${baseUrl}/full/800,/default.jpg`,
        
        // Try different quality/format parameters
        `${baseUrl}/full/full/0/color.jpg`,
        `${baseUrl}/full/max/0/color.jpg`,
        `${baseUrl}/full/full/0/gray.jpg`,
        `${baseUrl}/full/full/0/bitonal.jpg`,
        
        // Try the base URL directly
        baseUrl,
        `${baseUrl}.jpg`,
        
        // Try legacy IIIF 1.0 patterns
        `${baseUrl}/full/0/native.jpg`,
        `${baseUrl}/full/0/default.jpg`,
        `${baseUrl}/full/native.jpg`,
        `${baseUrl}/full/default.jpg`,
        
        // Try different rotation values
        `${baseUrl}/full/full/90/default.jpg`,
        `${baseUrl}/full/full/180/default.jpg`,
        `${baseUrl}/full/full/270/default.jpg`,
        
        // Try removing URL encoding issues
        img.url.replace(/%5B/g, '[').replace(/%5D/g, ']'),
        `${baseUrl.replace(/%5B/g, '[').replace(/%5D/g, ']')}/full/full/0/default.jpg`,
        `${baseUrl.replace(/%5B/g, '[').replace(/%5D/g, ']')}/full/max/0/default.jpg`,
        
        // Try alternative path structures sometimes used by Vatican systems
        `${baseUrl.replace('/iiif/2/', '/iiif/')}/full/full/0/default.jpg`,
        `${baseUrl.replace('/iiif/2/', '/images/')}/full/full/0/default.jpg`,
        `${baseUrl.replace('/iiif/', '/images/')}/full/full/0/default.jpg`
      );
    } else {
      // If no /full/ in URL, try adding IIIF parameters
      urlsToTry.push(
        `${img.url}/full/full/0/default.jpg`,
        `${img.url}/full/max/0/default.jpg`,
        `${img.url}/full/1200,/0/default.jpg`,
        `${img.url}/full/800,/0/default.jpg`
      );
    }
  }
  // 4. For CNRS URLs
  else if (img.url && img.url.includes("iiif.irht.cnrs.fr")) {
    console.log(`Detected CNRS URL: ${img.url}`);
    
    const baseUrl = img.url.split("/full/")[0];
    
    urlsToTry.push(
      `${baseUrl}/full/full/0/default.jpg`,
      `${baseUrl}/full/max/0/default.jpg`,
      `${baseUrl}/full/1200,/0/default.jpg`,
      `${baseUrl}/full/800,/0/default.jpg`,
      `${baseUrl}/full/600,/0/default.jpg`,
      `${baseUrl}/full/400,/0/default.jpg`,
      `${baseUrl}/full/full/90/default.jpg`,
      `${baseUrl}/full/full/180/default.jpg`,
      `${baseUrl}/full/full/270/default.jpg`,
      `${baseUrl}/full/full/default.jpg`,
      `${baseUrl}/full/max/default.jpg`,
      baseUrl,
      `${baseUrl}.jpg`,
      `${baseUrl}/full/full/0/default.png`,
      `${baseUrl}/full/max/0/default.png`,
      `${baseUrl}/full/full/0/native.jpg`,
      `${baseUrl}/full/max/0/native.jpg`,
      `${baseUrl}/full/0/native.jpg`,
      `${baseUrl}/full/0/default.jpg`
    );
  }
  // 5. For Gallica URLs
  else if (img.url && img.url.includes("gallica.bnf.fr")) {
    console.log(`Detected Gallica URL: ${img.url}`);
    
    if (img.url.includes("/full/")) {
      const baseUrl = img.url.split("/full/")[0];
      
      const corsProxy = "https://api.allorigins.win/raw?url=";
      urlsToTry.push(
        corsProxy + encodeURIComponent(`${baseUrl}/full/full/0/native.jpg`),
        corsProxy + encodeURIComponent(`${baseUrl}/full/full/0/default.jpg`),
        corsProxy + encodeURIComponent(`${baseUrl}/full/max/0/native.jpg`),
        corsProxy + encodeURIComponent(`${baseUrl}/full/max/0/default.jpg`),
        corsProxy + encodeURIComponent(`${baseUrl}/full/2000,/0/native.jpg`),
        `${baseUrl}/full/full/0/native.jpg`,
        `${baseUrl}/full/full/0/default.jpg`,
        `${baseUrl}/full/max/0/native.jpg`,
        `${baseUrl}/full/max/0/default.jpg`
      );
    }
  }
  // 6. For other IIIF URLs
  else if (img.url && img.url.includes("/full/")) {
    console.log(`Detected other IIIF URL: ${img.url}`);
    
    const baseUrl = img.url.split("/full/")[0];
    
    urlsToTry.push(
      `${baseUrl}/full/max/0/default.jpg`,
      `${baseUrl}/full/full/0/default.jpg`,
      `${baseUrl}/full/2000,/0/default.jpg`,
      `${baseUrl}/full/1500,/0/default.jpg`,
      `${baseUrl}/full/1000,/0/default.jpg`,
      `${baseUrl}/full/800,/0/default.jpg`,
      baseUrl
    );
  }
  // 7. Direct URL fallback
  else if (img.url) {
    console.log(`Direct URL (non-IIIF): ${img.url}`);
    // Already added above, but make sure it's there
  }
  
  // Remove duplicates while preserving order
  const uniqueUrls = [...new Set(urlsToTry)];
  console.log(`Final URLs to try for image ${index} (${uniqueUrls.length} total):`, uniqueUrls);
  
  // Log the first few URLs for debugging
  uniqueUrls.slice(0, 5).forEach((url, i) => {
    console.log(`  ${i + 1}. ${url}`);
  });
  
  return uniqueUrls;
}
// --- Download Selected Images (main entry point) ---
async function downloadSelected() {
  console.log("Download function called");
  
  const selectedCheckboxes = Array.from(
    document.querySelectorAll('input[type="checkbox"]:checked')
  );
  
  console.log("Selected checkboxes:", selectedCheckboxes);
  console.log("Images array:", images);
  
  const selectedImages = selectedCheckboxes.map((checkbox) => {
    const index = parseInt(checkbox.value);
    const img = images[index];
    console.log(`Checkbox value: ${checkbox.value}, Index: ${index}, Image:`, img);
    return img;
  }).filter(img => img !== undefined);

  console.log("Selected images after filtering:", selectedImages);

  if (selectedImages.length === 0) {
    showMessage("No images selected. Please select at least one image to download.");
    return;
  }

  // Get chunking preferences with proper null checks
  const chunkCheckbox = document.getElementById("chunkCheckbox");
  const chunkSizeInput = document.getElementById("chunkSize");
  
  console.log("Chunk checkbox element:", chunkCheckbox);
  console.log("Chunk size input element:", chunkSizeInput);
  
  const shouldChunk = chunkCheckbox ? chunkCheckbox.checked : false;
  const chunkSize = chunkSizeInput ? parseInt(chunkSizeInput.value) || 50 : 50;

  // Check if Gallica rate limiting is enabled
  const gallicaCheckbox = document.getElementById("gallicaCheckbox");
  const isGallica = gallicaCheckbox ? gallicaCheckbox.checked : false;

  console.log("Chunking enabled:", shouldChunk);
  console.log("Chunk size:", chunkSize);
  console.log("Gallica rate limiting:", isGallica);
  console.log("Total images to download:", selectedImages.length);

  if (shouldChunk && selectedImages.length > chunkSize) {
    console.log("Using chunked download");
    await downloadSelectedChunked(selectedImages, chunkSize, isGallica);
  } else {
    console.log("Using regular download");
    if (isGallica) {
      await downloadSelectedSequential(selectedImages);
    } else {
      await downloadSelectedParallel(selectedImages);
    }
  }
}

// --- Chunked Download Function ---
async function downloadSelectedChunked(selectedImages, chunkSize, isGallica) {
  const totalImages = selectedImages.length;
  const chunks = [];
  
  // Split images into chunks
  for (let i = 0; i < totalImages; i += chunkSize) {
    chunks.push(selectedImages.slice(i, i + chunkSize));
  }

  console.log(`Splitting ${totalImages} images into ${chunks.length} chunks of ${chunkSize} images each`);
  
  showMessage(`Preparing to download ${totalImages} images in ${chunks.length} zip files...`);
  resetProgress();

  let overallProgress = 0;
  const totalChunks = chunks.length;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const chunkNumber = chunkIndex + 1;
    
    showMessage(`Processing chunk ${chunkNumber}/${totalChunks} (${chunk.length} images)...`);
    
    try {
      if (isGallica) {
        await downloadChunkSequential(chunk, chunkNumber, chunkIndex, totalChunks);
      } else {
        await downloadChunkParallel(chunk, chunkNumber, chunkIndex, totalChunks);
      }
      
      overallProgress = (chunkNumber / totalChunks) * 100;
      updateProgress(overallProgress);
      
      // Brief pause between chunks
      if (chunkIndex < chunks.length - 1) {
        showMessage(`Chunk ${chunkNumber} complete. Preparing next chunk...`);
        await sleep(2000);
      }
      
    } catch (error) {
      console.error(`Error processing chunk ${chunkNumber}:`, error);
      showMessage(`Error in chunk ${chunkNumber}: ${error.message}`);
    }
  }

  showMessage(`All ${totalChunks} zip files downloaded successfully!`);
  setTimeout(() => resetProgress(), 3000);
}

// --- Download Single Chunk (Sequential for Gallica) ---
async function downloadChunkSequential(chunk, chunkNumber, chunkIndex, totalChunks) {
  var zip = new JSZip();
  var count = 0;
  var errors = 0;
  const startTime = Date.now();

  console.log(`Starting sequential download of chunk ${chunkNumber} (${chunk.length} images)`);

  for (let i = 0; i < chunk.length; i++) {
    const img = chunk[i];
    
    if (!img || !img.url) {
      console.error(`Image at index ${i} in chunk ${chunkNumber} is invalid:`, img);
      errors++;
      count++;
      continue;
    }
    
    const filename = sanitizeFilename(img.label || `image_${i + 1}`) + ".jpg";
    const urlsToTry = buildUrlsToTry(img, i);
    
    let success = false;
    for (let urlIndex = 0; urlIndex < urlsToTry.length; urlIndex++) {
      const url = urlsToTry[urlIndex];
      try {
        console.log(`🔄 Chunk ${chunkNumber}: Attempt ${urlIndex + 1}/${urlsToTry.length} for ${filename}`);
        const data = await fetchBinary(url);
        let binaryData = processBinaryData(data);
        
        if (binaryData.length > 5000) {
          zip.file(filename, binaryData, { binary: true });
          console.log(`✅ Chunk ${chunkNumber}: Added ${filename} (${binaryData.length} bytes)`);
          success = true;
          break;
        }
      } catch (err) {
        console.warn(`❌ Chunk ${chunkNumber}: Failed ${filename} from ${url.substring(0, 40)}...`);
      }
    }

    if (!success) {
      console.error(`❌ Chunk ${chunkNumber}: Failed ${filename} from all URLs`);
      errors++;
    }

    count++;
    
    // Add delay for Gallica (except for last image in chunk)
    if (count < chunk.length) {
      showMessage(`Chunk ${chunkNumber}: Downloaded ${count}/${chunk.length} images. Waiting 15 seconds...`);
      await sleep(15000);
    }
  }

  await saveChunkZip(zip, chunkNumber, count, errors, chunk.length);
}

// --- Download Single Chunk (Parallel for non-Gallica) ---
async function downloadChunkParallel(chunk, chunkNumber, chunkIndex, totalChunks) {
  return new Promise((resolve, reject) => {
    var zip = new JSZip();
    var count = 0;
    var errors = 0;

    console.log(`Starting parallel download of chunk ${chunkNumber} (${chunk.length} images)`);

    chunk.forEach(function (img, index) {
      if (!img || !img.url) {
        console.error(`Image at index ${index} in chunk ${chunkNumber} is invalid:`, img);
        errors++;
        count++;
        
        if (count === chunk.length) {
          saveChunkZip(zip, chunkNumber, count, errors, chunk.length)
            .then(resolve)
            .catch(reject);
        }
        return;
      }

      var filename = sanitizeFilename(img.label || `image_${index + 1}`) + ".jpg";
      const urlsToTry = buildUrlsToTry(img, index);
      let attemptIndex = 0;

      function tryDownload() {
        if (attemptIndex >= urlsToTry.length) {
          errors++;
          console.error(`❌ Chunk ${chunkNumber}: All attempts failed for ${filename}`);
          count++;
          
          if (count === chunk.length) {
            saveChunkZip(zip, chunkNumber, count, errors, chunk.length)
              .then(resolve)
              .catch(reject);
          }
          return;
        }

        const currentUrl = urlsToTry[attemptIndex];

        JSZipUtils.getBinaryContent(currentUrl, function (err, data) {
          if (err) {
            console.log(`❌ Chunk ${chunkNumber}: Attempt ${attemptIndex + 1} failed for ${filename}`);
            attemptIndex++;
            setTimeout(tryDownload, 500);
            return;
          }

          let binaryData = processBinaryData(data);

          if (binaryData.length > 5000) {
            zip.file(filename, binaryData, { binary: true });
            console.log(`✅ Chunk ${chunkNumber}: Added ${filename} (${binaryData.length} bytes)`);
          } else {
            console.log(`⚠️ Chunk ${chunkNumber}: Data too small for ${filename}, trying next URL...`);
            attemptIndex++;
            setTimeout(tryDownload, 500);
            return;
          }

          count++;

          if (count === chunk.length) {
            saveChunkZip(zip, chunkNumber, count, errors, chunk.length)
              .then(resolve)
              .catch(reject);
          }
        });
      }

      tryDownload();
    });
  });
}

// --- Save Individual Chunk as Zip ---
async function saveChunkZip(zip, chunkNumber, count, errors, totalInChunk) {
  const successCount = count - errors;

  if (successCount === 0) {
    throw new Error(`No images were successfully downloaded in chunk ${chunkNumber}`);
  }

  try {
    const content = await zip.generateAsync({ type: "blob" });
    const filename = `images_chunk_${chunkNumber.toString().padStart(3, '0')}.zip`;
    saveAs(content, filename);
    
    console.log(`✅ Chunk ${chunkNumber} saved: ${successCount}/${totalInChunk} images`);
    return { success: true, downloaded: successCount, failed: errors };
  } catch (error) {
    console.error(`Error creating zip for chunk ${chunkNumber}:`, error);
    throw error;
  }
}

// --- Parallel Download with Enhanced Progress ---
function downloadSelectedParallel(selectedImages) {
  var zip = new JSZip();
  var count = 0;
  var errors = 0;
  const startTime = Date.now();

  showMessage("Preparing images for download...");
  resetProgress();
  showDetailedProgress(0, selectedImages.length, "Starting parallel download...", startTime, 0);

  console.log(`Starting parallel download of ${selectedImages.length} images...`);

  selectedImages.forEach(function (img, index) {
    if (!img || !img.url) {
      console.error(`Image at index ${index} is invalid:`, img);
      errors++;
      count++;
      updateProgress((count / selectedImages.length) * 100);
      updateDetailedProgress(count, selectedImages.length, `Skipped invalid image ${index}`, startTime, errors);
      
      if (count === selectedImages.length) {
        completeZipDownload(zip, count, errors, selectedImages.length);
      }
      return;
    }
    
    var filename = sanitizeFilename(img.label || `image_${index + 1}`) + ".jpg";
    console.log(`Processing ${filename} from ${img.url}`);

    const urlsToTry = buildUrlsToTry(img, index);
    let attemptIndex = 0;

    function tryDownload() {
      if (attemptIndex >= urlsToTry.length) {
        errors++;
        console.error(`❌ All ${urlsToTry.length} download attempts failed for ${filename}`);
        count++;
        updateProgress((count / selectedImages.length) * 100);
        updateDetailedProgress(count, selectedImages.length, `Failed: ${filename}`, startTime, errors);

        if (count === selectedImages.length) {
          completeZipDownload(zip, count, errors, selectedImages.length);
        }
        return;
      }

      const currentUrl = urlsToTry[attemptIndex];
      console.log(`🔄 Attempt ${attemptIndex + 1}/${urlsToTry.length} for ${filename}: ${currentUrl.substring(0, 60)}...`);
      
      updateDetailedProgress(count, selectedImages.length, `Downloading ${filename} (attempt ${attemptIndex + 1}/${urlsToTry.length})`, startTime, errors);

      JSZipUtils.getBinaryContent(currentUrl, function (err, data) {
        if (err) {
          console.log(`❌ Attempt ${attemptIndex + 1} failed for ${filename}:`, err.message || err);
          attemptIndex++;
          
          // Add a small delay between attempts
          setTimeout(tryDownload, 500);
          return;
        }

        console.log(`✅ Downloaded ${filename}:`, typeof data, data.length || data.byteLength, 'bytes');

        let binaryData = processBinaryData(data);

        // Check if we got actual image data
        if (binaryData.length > 5000) {
          zip.file(filename, binaryData, { binary: true });
          console.log(`📁 Added ${filename} to zip: ${binaryData.length} bytes`);
          
          count++;
          updateProgress((count / selectedImages.length) * 100);
          updateDetailedProgress(count, selectedImages.length, `Added ${filename}`, startTime, errors);

          if (count === selectedImages.length) {
            completeZipDownload(zip, count, errors, selectedImages.length);
          }
        } else {
          console.log(`⚠️ Data too small for ${filename} (${binaryData.length} bytes), trying next URL...`);
          attemptIndex++;
          setTimeout(tryDownload, 500);
          return;
        }
      });
    }

    tryDownload();
  });
}

// --- Sequential Download with Enhanced Progress ---
async function downloadSelectedSequential(selectedImages) {
  var zip = new JSZip();
  var count = 0;
  var errors = 0;
  const startTime = Date.now();

  showMessage("Preparing images for download (with rate limiting)...");
  resetProgress();
  showDetailedProgress(0, selectedImages.length, "Starting sequential download...", startTime, 0);

  console.log(`Starting sequential download of ${selectedImages.length} images...`);

  for (let i = 0; i < selectedImages.length; i++) {
    const img = selectedImages[i];
    
    if (!img || !img.url) {
      console.error(`Image at index ${i} is invalid:`, img);
      errors++;
      count++;
      updateDetailedProgress(count, selectedImages.length, `Skipped invalid image ${i}`, startTime, errors);
      continue;
    }
    
    const filename = sanitizeFilename(img.label || `image_${i + 1}`) + ".jpg";
    console.log(`Processing ${filename} from ${img.url}`);
    
    updateDetailedProgress(count, selectedImages.length, `Processing ${filename}...`, startTime, errors);
    
    const urlsToTry = buildUrlsToTry(img, i);
    
    let success = false;
    for (let urlIndex = 0; urlIndex < urlsToTry.length; urlIndex++) {
      const url = urlsToTry[urlIndex];
      try {
        console.log(`🔄 Attempt ${urlIndex + 1}/${urlsToTry.length} for ${filename}: ${url.substring(0, 60)}...`);
        updateDetailedProgress(count, selectedImages.length, `Downloading ${filename} (attempt ${urlIndex + 1}/${urlsToTry.length})`, startTime, errors);
        
        const data = await fetchBinary(url);
        let binaryData = processBinaryData(data);
        
        if (binaryData.length > 5000) {
          zip.file(filename, binaryData, { binary: true });
          console.log(`✅ Added ${filename} to zip: ${binaryData.length} bytes`);
          updateDetailedProgress(count, selectedImages.length, `Added ${filename}`, startTime, errors);
          success = true;
          break;
        } else {
          console.warn(`⚠️ Data too small (${binaryData.length} bytes) from ${url.substring(0, 40)}...`);
        }
      } catch (err) {
        console.warn(`❌ Failed to download from ${url.substring(0, 40)}...:`, err.message || err);
      }
    }

    if (!success) {
      console.error(`❌ Failed to download ${filename} from all ${urlsToTry.length} URLs`);
      errors++;
      updateDetailedProgress(count, selectedImages.length, `Failed: ${filename}`, startTime, errors);
    }

    count++;
    updateProgress((count / selectedImages.length) * 100);

    if (count < selectedImages.length) {
      const delay = img.url && img.url.includes("gallica.bnf.fr") ? 15000 : 2000;
      showMessage(`Downloaded ${count}/${selectedImages.length} images. Waiting ${delay/1000} seconds...`);
      updateDetailedProgress(count, selectedImages.length, `Waiting ${delay/1000}s before next download...`, startTime, errors);
      await sleep(delay);
    }
  }

  await completeZipDownload(zip, count, errors, selectedImages.length);
}

// --- Enhanced Progress Functions ---
function showDetailedProgress(completed, total, currentAction, startTime = null, failed = 0) {
  let detailedProgress = document.getElementById("detailed_progress");

  if (!detailedProgress) {
    detailedProgress = document.createElement("div");
    detailedProgress.id = "detailed_progress";
    detailedProgress.style.cssText = `
      margin: 15px 0;
      padding: 15px;
      background: var(--surface-color);
      border-radius: var(--radius-md);
      border-left: 4px solid var(--accent-color);
      font-family: monospace;
      font-size: 14px;
      line-height: 1.4;
      color: var(--text-primary);
    `;

    const progressSection = document.getElementById("progress_bar");
    progressSection.parentNode.insertBefore(detailedProgress, progressSection.nextSibling);
  }

  detailedProgress.style.display = "block";

  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  let timeInfo = "";

  if (startTime && completed > 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    const avgTime = elapsed / completed;
    const remaining = (total - completed) * avgTime;
    const eta = remaining > 0 ? `ETA: ${formatTime(remaining)}` : "Almost done!";
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

function updateDetailedProgress(completed, total, currentAction, startTime, failed = 0) {
  showDetailedProgress(completed, total, currentAction, startTime, failed);
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

// --- Helper function to process binary data ---
function processBinaryData(data) {
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
  return binaryData;
}

// --- Complete Single Zip Download ---
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
  "main.js loaded successfully with enhanced progress tracking and CNRS support"
);