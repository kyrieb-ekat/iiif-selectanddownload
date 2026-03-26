# -*- coding: utf-8 -*-
"""IIIF proxy server for Gallica, CNRS, Columbia, and other image sources."""
import collections
import logging
import os
import secrets
import threading
import time
from urllib.parse import quote, unquote, urlparse

import requests
from flask import Flask, request, Response, abort
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from werkzeug.utils import secure_filename

# ---- logging / config ----
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")

# ---- startup auth token ----
# Set API_TOKEN env var to use a fixed token, or leave unset to auto-generate.
API_TOKEN = os.environ.get("API_TOKEN") or secrets.token_hex(16)
logging.info("=" * 60)
logging.info("API TOKEN: %s", API_TOKEN)
logging.info("Include as ?token=<TOKEN> in all requests from the frontend.")
logging.info("=" * 60)

# ---- SSRF allowlist ----
# Only these hostnames may be fetched via /proxy, /download, or /columbia.
# To support a new institution, add its hostname here and redeploy.
ALLOWED_PROXY_HOSTS = frozenset({
    "gallica.bnf.fr",
    "iiif.irht.cnrs.fr",
    "bvmm.irht.cnrs.fr",
    "dlc.library.columbia.edu",
    "triclops.library.columbia.edu",
    "digi.vatlib.it",
    "vatlib.it",
    "omnes.dbseret.com",
    "fragmentarium.ms",
    "iiif.bodleian.ox.ac.uk",
    "digital.bodleian.ox.ac.uk",
    "iiif.harvardartmuseums.org",
    "iiif.archivelab.org",
    "ids.lib.harvard.edu",
    "nrs.harvard.edu",
    "iiif.europeana.eu",
    "www.e-codices.unifr.ch",
})

def _assert_allowed_url(url):
    """Abort with 400/403 if url scheme or host is not allowed."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        abort(400, f"Only http and https URLs are allowed (got: {parsed.scheme})")
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        abort(400, "URL has no hostname")
    if hostname not in ALLOWED_PROXY_HOSTS:
        logging.warning("Blocked proxy request to unlisted host: %s", hostname)
        abort(403, f"Host not in allowlist: {hostname}. Add it to ALLOWED_PROXY_HOSTS in app.py.")

# ---- CORS allowed origins ----
# The GitHub Pages frontend origin and localhost variants for local dev.
# file:// origins arrive as the string "null" in the Origin header.
ALLOWED_ORIGINS = frozenset({
    "https://kyrieb-ekat.github.io",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "null",  # file:// origin
})

# ---- simple thread-safe rate-limiter ----
MIN_SECONDS_BETWEEN_CALLS = int(os.environ.get("MIN_SECONDS_BETWEEN_CALLS", "12"))
_last_call = 0.0
_last_call_lock = threading.Lock()

def wait_if_needed():
    """Sleep to enforce a minimum time between upstream requests (thread-safe)."""
    global _last_call
    with _last_call_lock:
        elapsed = time.time() - _last_call
        if elapsed < MIN_SECONDS_BETWEEN_CALLS:
            sleep_time = MIN_SECONDS_BETWEEN_CALLS - elapsed
            logging.info("Rate limiter sleeping for %.2fs", sleep_time)
            time.sleep(sleep_time)
        _last_call = time.time()

# ---- traffic counters ----
# Tracks per-endpoint request counts and total response time for diagnostics.
# Use GET /stats to view. Resets on server restart.
_traffic_lock = threading.Lock()
_traffic = collections.defaultdict(lambda: {"requests": 0, "total_ms": 0.0, "errors": 0})

def _record_traffic(endpoint, elapsed_ms, is_error=False):
    with _traffic_lock:
        _traffic[endpoint]["requests"] += 1
        _traffic[endpoint]["total_ms"] += elapsed_ms
        if is_error:
            _traffic[endpoint]["errors"] += 1

# ---- Flask app ----
app = Flask(__name__)

# Use a session with retries and connection pooling for better performance
session = requests.Session()
retries = Retry(total=3, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504], respect_retry_after_header=True)
adapter = HTTPAdapter(max_retries=retries, pool_connections=10, pool_maxsize=10)
session.mount("http://", adapter)
session.mount("https://", adapter)


# ---- auth ----
@app.before_request
def check_token():
    """Require a valid API token on all routes except the index page."""
    if request.path == "/" or request.path == "/stats":
        return
    token = request.args.get("token") or request.headers.get("X-API-Token", "")
    if not secrets.compare_digest(token, API_TOKEN):
        abort(401, "Missing or invalid API token. Pass ?token=<TOKEN> in the request.")


def generate_streamed_response(resp, chunk_size=8192):
    """Generator function to stream response content in chunks."""
    try:
        for chunk in resp.iter_content(chunk_size=chunk_size):
            if chunk:
                yield chunk
    finally:
        try:
            resp.close()
        except Exception:
            pass


def fetch_from_server(url):
    """Generic fetch function for any IIIF server. Returns a streaming requests.Response.

    Note: callers are responsible for consuming/closing the response.
    """
    wait_if_needed()
    headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; iiif-proxy/1.0)',
        'Accept': 'image/*,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
    }

    try:
        r = session.get(url, timeout=30, headers=headers, allow_redirects=True, stream=True)
        if r.status_code == 429:
            retry_after = r.headers.get('Retry-After')
            msg = "Rate-limit hit"
            if retry_after:
                msg += f", retry after {retry_after}"
            logging.warning("%s for %s", msg, url)
            abort(503, msg)
        try:
            r.raise_for_status()
        except requests.HTTPError as e:
            logging.warning("Failed to fetch %s: %s", url, e)
            abort(r.status_code)
        return r
    except requests.exceptions.RequestException as e:
        logging.exception("Request failed for %s", url)
        abort(500, f"Request failed: {str(e)}")

@app.route("/")
def index():
    return """
    <h1>IIIF Proxy Server</h1>
    <p>Available endpoints (all require <code>?token=TOKEN</code>):</p>
    <ul>
        <li><code>/download?ark=...&f=...&size=...&token=TOKEN</code> - For Gallica/CNRS ARK-based URLs</li>
        <li><code>/proxy?url=...&token=TOKEN</code> - Generic proxy for allowed IIIF hosts</li>
        <li><code>/columbia?id=...&canvas=...&size=...&token=TOKEN</code> - For Columbia University</li>
        <li><code>/stats</code> - Traffic statistics</li>
    </ul>
    <p>Token is printed to the server console at startup.</p>
    """

@app.route("/stats")
def stats():
    """Show per-endpoint traffic stats. No token required (read-only, no proxying)."""
    with _traffic_lock:
        snapshot = {k: dict(v) for k, v in _traffic.items()}
    lines = ["<h1>Traffic Stats</h1><table border='1' cellpadding='6'>"]
    lines.append("<tr><th>Endpoint</th><th>Requests</th><th>Errors</th><th>Avg ms</th></tr>")
    for endpoint, data in sorted(snapshot.items()):
        avg = (data["total_ms"] / data["requests"]) if data["requests"] else 0
        lines.append(f"<tr><td>{endpoint}</td><td>{data['requests']}</td>"
                     f"<td>{data['errors']}</td><td>{avg:.0f}</td></tr>")
    lines.append("</table>")
    lines.append(f"<p>Rate limit: {MIN_SECONDS_BETWEEN_CALLS}s between upstream calls</p>")
    return "\n".join(lines)

@app.route("/download")
def download():
    """
    /download?ark=12148/btv1b55010551d&f=39&size=full&token=TOKEN
    Handles Gallica and CNRS URLs
    """
    t0 = time.time()
    ark = request.args.get("ark")
    fol = request.args.get("f")
    size = request.args.get("size", "full")

    if not ark or not fol:
        abort(400, "ark and f are required query parameters")

    def is_likely_image(resp):
        ct = (resp.headers.get('Content-Type') or '').lower()
        if not ct.startswith('image/'):
            return False
        cl = resp.headers.get('Content-Length')
        try:
            if cl and int(cl) < 5000:
                return False
        except ValueError:
            pass
        return True

    def stream_response(resp, filename, fallback_mimetype='image/jpeg'):
        mimetype = resp.headers.get('Content-Type') or fallback_mimetype
        safe_name = secure_filename(filename)
        return Response(generate_streamed_response(resp), mimetype=mimetype,
                        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'})

    is_error = False
    try:
        # Try multiple URL patterns for CNRS
        if ark.startswith("63955/"):  # CNRS pattern
            url_patterns = [
                f"https://iiif.irht.cnrs.fr/iiif/ark:/{quote(ark)}/f{fol}/{size}/full/0/default.jpg",
                f"https://iiif.irht.cnrs.fr/iiif/ark:/{quote(ark)}/f{fol}/{size}/max/0/default.jpg",
                f"https://iiif.irht.cnrs.fr/iiif/ark:/{quote(ark)}/f{fol}/full/full/0/default.jpg",
                f"https://iiif.irht.cnrs.fr/iiif/ark:/{quote(ark)}/f{fol}/full/max/0/default.jpg",
                f"https://iiif.irht.cnrs.fr/iiif/ark:/{quote(ark)}/f{fol}"  # Base URL
            ]
            for iiif_url in url_patterns:
                try:
                    resp = fetch_from_server(iiif_url)
                    if resp and is_likely_image(resp):
                        filename = f"{ark.split('/')[-1]}_f{fol}.jpg"
                        return stream_response(resp, filename)
                    if resp:
                        resp.close()
                except Exception:
                    continue
            is_error = True
            abort(404, "No working URL found for this CNRS image")
        else:  # Assume Gallica
            iiif_url = f"https://gallica.bnf.fr/iiif/ark:/{quote(ark)}/f{fol}/{size}/full/0/default.jpg"
            resp = fetch_from_server(iiif_url)
            if resp is None or not resp.headers.get('Content-Type', '').startswith('image/'):
                is_error = True
                abort(404, "No image returned from Gallica")
            filename = f"{ark.split('/')[-1]}_f{fol}.jpg"
            return stream_response(resp, filename)
    finally:
        _record_traffic("/download", (time.time() - t0) * 1000, is_error)

@app.route("/proxy")
def proxy():
    """
    Generic proxy endpoint: /proxy?url=https://example.com/image.jpg&token=TOKEN
    Only fetches URLs on the ALLOWED_PROXY_HOSTS allowlist.
    """
    t0 = time.time()
    url = request.args.get("url")
    if not url:
        abort(400, "url parameter is required")

    # Decode if URL-encoded
    url = unquote(url)

    # Enforce allowlist — raises 400/403 if not permitted
    _assert_allowed_url(url)

    logging.info("Proxying request to: %s", url)

    is_error = False
    try:
        resp = fetch_from_server(url)

        content_type = resp.headers.get('Content-Type') or 'application/octet-stream'

        filename = url.split('/')[-1]
        if '?' in filename:
            filename = filename.split('?')[0]
        if not filename or '.' not in filename:
            filename = 'image'
        filename = secure_filename(filename)

        return Response(
            generate_streamed_response(resp),
            mimetype=content_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )
    except Exception as e:
        is_error = True
        logging.exception("Proxy error for %s", url)
        abort(500, f"Proxy error: {str(e)}")
    finally:
        _record_traffic("/proxy", (time.time() - t0) * 1000, is_error)

@app.route("/columbia")
def columbia():
    """
    Columbia University specific endpoint
    /columbia?id=10.7916/D8892P87&canvas=1&size=full&token=TOKEN
    """
    t0 = time.time()
    doc_id = request.args.get("id")  # e.g., "10.7916/D8892P87"
    canvas = request.args.get("canvas", "1")
    size = request.args.get("size", "full")

    if not doc_id:
        abort(400, "id parameter is required")

    # Columbia IIIF URL patterns to try
    url_patterns = [
        f"https://dlc.library.columbia.edu/iiif/2/{doc_id}/canvas/{canvas}/{size}/full/0/default.jpg",
        f"https://dlc.library.columbia.edu/iiif/2/{doc_id}/{canvas}/{size}/full/0/default.jpg",
        f"https://dlc.library.columbia.edu/iiif/2/{doc_id}/canvas-{canvas}/{size}/full/0/default.jpg",
        f"https://dlc.library.columbia.edu/iiif/2/{doc_id}/page-{canvas}/{size}/full/0/default.jpg",
        f"https://dlc.library.columbia.edu/iiif/2/{doc_id}/p{canvas}/{size}/full/0/default.jpg",
        f"https://dlc.library.columbia.edu/iiif/2/{doc_id}/canvas/{canvas}/full/max/0/default.jpg",
        f"https://dlc.library.columbia.edu/iiif/2/{doc_id}/canvas/{canvas}/full/2000,/0/default.jpg",
        f"https://dlc.library.columbia.edu/iiif/2/{doc_id}/canvas/{canvas}/full/1500,/0/default.jpg",
    ]

    is_error = False
    try:
        for iiif_url in url_patterns:
            try:
                logging.info("Trying Columbia URL: %s", iiif_url)
                resp = fetch_from_server(iiif_url)
                ct = resp.headers.get('Content-Type', '')
                cl = resp.headers.get('Content-Length')
                if ct.startswith('image/') and not (cl and int(cl) < 5000):
                    filename = f"columbia_{doc_id.replace('/', '_')}_p{canvas}.jpg"
                    mimetype = resp.headers.get('Content-Type') or 'image/jpeg'
                    return Response(
                        generate_streamed_response(resp),
                        mimetype=mimetype,
                        headers={"Content-Disposition": f'attachment; filename="{secure_filename(filename)}"'}
                    )
            except Exception as e:
                logging.warning("Failed URL %s: %s", iiif_url, e)
                continue

        is_error = True
        abort(404, "No working URL found for this Columbia image")
    finally:
        _record_traffic("/columbia", (time.time() - t0) * 1000, is_error)

# CORS — only allow known origins
@app.after_request
def after_request(response):
    origin = request.headers.get("Origin", "")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
    else:
        # Don't reflect unknown origins
        response.headers["Access-Control-Allow-Origin"] = "https://kyrieb-ekat.github.io"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Token"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    return response

if __name__ == "__main__":
    port = int(os.environ.get('PORT', '5000'))
    debug = os.environ.get('DEBUG', 'false').lower() in ('1', 'true')
    # Bind to 127.0.0.1 only — never expose to external network interfaces.
    # Requests from the GitHub Pages frontend arrive via the user's local browser,
    # so localhost binding works correctly for that use case.
    app.run(debug=debug, port=port, host="127.0.0.1")
