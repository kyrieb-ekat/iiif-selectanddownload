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

            if (!manifest.sequences || !manifest.sequences[0] || !manifest.sequences[0].canvases) {
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
                var info = img.service && img.service["@id"] ? img.service["@id"] : null;
                if (info && !info.endsWith("/info.json")) info += "/info.json";

                images.push({ url: img["@id"], info: info, label: he.decode(canvas.label || `Image ${index + 1}`) });

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
            showMessage(`Manifest loaded successfully. ${images.length} images found.`);
        })
        .fail(function (jqXHR, textStatus, errorThrown) {
            showMessage(`Error loading manifest: ${textStatus}, ${errorThrown}`);
            console.error("Error loading manifest:", textStatus, errorThrown);
        });
}

function selectAll() {
    var checkboxes = document.querySelectorAll('input[type="checkbox"]');
    var allChecked = Array.from(checkboxes).every(checkbox => checkbox.checked);
    checkboxes.forEach(checkbox => checkbox.checked = !allChecked);
}

function downloadSelected() {
    var selectedImages = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
        .map(checkbox => images[parseInt(checkbox.value)]);

    if (selectedImages.length === 0) {
        showMessage("No images selected. Please select at least one image to download.");
        return;
    }

    var zip = new JSZip();
    var count = 0;

    showMessage("Preparing images for download...");
    resetProgress();

    selectedImages.forEach(function (img, index) {
        var filename = img.label + ".jpg";

        JSZipUtils.getBinaryContent(img.url, function (err, data) {
            if (err) {
                showMessage("Error occurred while downloading images.");
                console.error(`Error downloading image ${filename}:`, err);
                return;
            }

            zip.file(filename, data, { binary: true });
            count++;
            updateProgress((count / selectedImages.length) * 100);

            if (count === selectedImages.length) {
                zip.generateAsync({ type: "blob" })
                    .then(function (content) {
                        saveAs(content, "selected_images.zip");
                        showMessage("Download complete!");
                        resetProgress();
                    })
                    .catch(function (error) {
                        showMessage("Error creating zip file.");
                        console.error("Error creating zip file:", error);
                    });
            }
        });
    });
}

function showMessage(text) {
    var resultContainer = document.getElementById("result");
    resultContainer.innerText = text;
}

function resetProgress() {
    var progressBar = document.getElementById("progress_bar");
    progressBar.querySelector(".progress-bar").style.width = "0%";
    progressBar.querySelector(".progress-bar").innerText = "0%";
}

function updateProgress(percent) {
    var progressBar = document.getElementById("progress_bar");
    progressBar.classList.remove("hide");
    progressBar.querySelector(".progress-bar").style.width = percent + "%";
    progressBar.querySelector(".progress-bar").innerText = Math.round(percent) + "%";
}

// Add event listeners after the DOM is fully loaded
document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("loadManifest").addEventListener("click", getManifest);
    document.getElementById("selectAll").addEventListener("click", selectAll);
    document.getElementById("downloadSelected").addEventListener("click", downloadSelected);
});

console.log("main.js loaded successfully");
