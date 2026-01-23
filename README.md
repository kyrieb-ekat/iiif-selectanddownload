# IIIF Select & Download

This repository provides a small IIIF manifest viewer and downloader. It includes:

- A lightweight Flask proxy for fetching IIIF images with rate-limiting and optional host whitelist (`download copy/app.py`).
- A browser UI to load IIIF manifests, select canvases, and download images as ZIP files (`download copy/index.html`, `download copy/main.js`).
- A Web Worker-based downloader (`download copy/download-worker.js`) that fetches images using `fetch(...).arrayBuffer()` and zips them using JSZip in the worker thread (keeps the UI responsive).

Quick start (development)

1. Install Python deps:

```bash
python3 -m pip install -r requirements.txt
```

2. Start the Flask proxy (recommended to run in a virtualenv):

```bash
cd "download copy"
PORT=5000 DEBUG=0 LOG_LEVEL=INFO ALLOWED_HOSTS=gallica.bnf.fr python3 app.py
```

Environment variables (for `app.py`):
- `PORT` — port to run the Flask server (default 5000)
- `DEBUG` — enable Flask debug (use false in production)
- `LOG_LEVEL` — logging level (INFO/DEBUG)
- `MIN_SECONDS_BETWEEN_CALLS` — simple global rate limit between upstream requests
- `ALLOWED_HOSTS` — comma-separated host whitelist for `/proxy` (strongly recommended)

3. Serve the `download copy/` folder (static files) and open `index.html` in a browser. Example using Python's simple server:

```bash
cd "download copy"
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

Usage notes

- The UI will attempt to parse IIIF Presentation 2.x and 3.0 manifests. It extracts image service URLs when available and builds candidate download URLs.
- The downloader uses a Web Worker to fetch image bytes and create ZIP files without blocking the main thread. This uses JSZip via CDN inside the worker.
- For Gallica and other rate-limited providers, enable the Gallica checkbox to apply delays or configure the Flask proxy's `MIN_SECONDS_BETWEEN_CALLS`.
- CORS restrictions apply: many IIIF endpoints allow cross-origin requests, but some do not. Use the Flask `/proxy` or `/download` endpoints as a workaround — set `ALLOWED_HOSTS` to limit exposure.

Developer notes

- We replaced the old `jszip-utils` approach with `fetch().arrayBuffer()` and a web worker for better performance and fewer main-thread allocations.
- If you want to bundle or vendor JSZip and the worker, consider using a build step (Webpack/Rollup) and serving the worker script from the same origin.
- Tests: a simple GitHub Actions workflow is included to run a smoke test that ensures the UI index page serves.

Security & production

- Do not run the Flask server with `DEBUG=1` in production.
- Always set `ALLOWED_HOSTS` when exposing the `/proxy` endpoint publicly to prevent misuse as an open proxy.

If you'd like, I can also:
- Add a small dev container or npm scripts to run the static server and proxy together.
- Vendor JSZip and the worker for offline use.

---
Kyrie — quick cleanup and README added.
