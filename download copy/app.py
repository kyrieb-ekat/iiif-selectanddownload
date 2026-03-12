# -*- coding: utf-8 -*-
import os
import time
import logging
import threading
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from urllib.parse import quote, unquote, urlparse

from flask import Flask, request, Response, abort
from werkzeug.utils import secure_filename

# ---- logging / config ----
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")

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

# ---- Flask app ----
app = Flask(__name__)

# Use a session with retries and connection pooling for better performance
session = requests.Session()
retries = Retry(total=3, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504], respect_retry_after_header=True)
adapter = HTTPAdapter(max_retries=retries, pool_connections=10, pool_maxsize=10)
session.mount("http://", adapter)
session.mount("https://", adapter)


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
            logging.warning(msg + " for %s", url)
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
    <p>Available endpoints:</p>
    <ul>
        <li><code>/download?ark=...&f=...&size=...</code> - For Gallica/CNRS ARK-based URLs</li>
        <li><code>/proxy?url=...</code> - Generic proxy for any IIIF URL</li>
        <li><code>/columbia?id=...&canvas=...&size=...</code> - For Columbia University</li>
    </ul>
    """

@app.route("/download")
def download():
    """
    /download?ark=12148/btv1b55010551d&f=39&size=full
    Handles Gallica and CNRS URLs
    """
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
                if is_likely_image(resp):
                    filename = f"{ark.split('/')[-1]}_f{fol}.jpg"
                    return stream_response(resp, filename)
                else:
                    resp.close()
            except Exception:
                continue
        else:
            abort(404, "No working URL found for this CNRS image")
    else:  # Assume Gallica
        iiif_url = f"https://gallica.bnf.fr/iiif/ark:/{quote(ark)}/f{fol}/{size}/full/0/default.jpg"
        resp = fetch_from_server(iiif_url)
        if not (resp and resp.headers.get('Content-Type', '').startswith('image/')):
            abort(404, "No image returned from Gallica")
        filename = f"{ark.split('/')[-1]}_f{fol}.jpg"
        return stream_response(resp, filename)

@app.route("/proxy")
def proxy():
    """
    Generic proxy endpoint: /proxy?url=https://example.com/image.jpg
    """
    url = request.args.get("url")
    if not url:
        abort(400, "url parameter is required")
    
    # Decode if URL-encoded
    url = unquote(url)

    logging.info("Proxying request to: %s", url)

    # Optional host whitelist (comma-separated) to avoid acting as an open proxy
    allowed = os.environ.get('ALLOWED_HOSTS')
    if allowed:
        hostname = urlparse(url).hostname or ''
        allowed_hosts = [h.strip() for h in allowed.split(',') if h.strip()]
        if not any(hostname.endswith(a) for a in allowed_hosts):
            logging.warning("Blocked proxy request to disallowed host: %s", hostname)
            abort(403, "Host not allowed")

    try:
        resp = fetch_from_server(url)

        # Determine content type from response header first
        content_type = resp.headers.get('Content-Type') or 'application/octet-stream'

        # Extract filename from URL and sanitize it
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
        logging.exception("Proxy error for %s", url)
        abort(500, f"Proxy error: {str(e)}")

@app.route("/columbia")
def columbia():
    """
    Columbia University specific endpoint
    /columbia?id=10.7916/D8892P87&canvas=1&size=full
    """
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
        # Try different size parameters
        f"https://dlc.library.columbia.edu/iiif/2/{doc_id}/canvas/{canvas}/full/max/0/default.jpg",
        f"https://dlc.library.columbia.edu/iiif/2/{doc_id}/canvas/{canvas}/full/2000,/0/default.jpg",
        f"https://dlc.library.columbia.edu/iiif/2/{doc_id}/canvas/{canvas}/full/1500,/0/default.jpg",
    ]
    
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

    abort(404, "No working URL found for this Columbia image")

# CORS support for all routes
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

if __name__ == "__main__":
    port = int(os.environ.get('PORT', '5000'))
    debug = os.environ.get('DEBUG', 'false').lower() in ('1', 'true')
    app.run(debug=debug, port=port)
