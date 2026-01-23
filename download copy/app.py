# -*- coding: utf-8 -*-
import os, time
import requests
from functools import lru_cache
from urllib.parse import quote, unquote
import re

from flask import Flask, request, Response, abort

# ---- simple rate-limiter ----
MIN_SECONDS_BETWEEN_CALLS = 12   # ~5 requests/min
_last_call = 0.0

def wait_if_needed():
    global _last_call
    elapsed = time.time() - _last_call
    if elapsed < MIN_SECONDS_BETWEEN_CALLS:
        time.sleep(MIN_SECONDS_BETWEEN_CALLS - elapsed)
    _last_call = time.time()

# ---- Flask app ----
app = Flask(__name__)

@lru_cache(maxsize=1024)          # basic in-memory cache
def fetch_from_server(url):
    """Generic fetch function for any IIIF server"""
    wait_if_needed()
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'image/jpeg,image/png,image/*,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }
    
    try:
        r = requests.get(url, timeout=30, headers=headers, allow_redirects=True)
        if r.status_code == 429:
            abort(503, "Rate-limit hit, retry later")
        if r.status_code != 200:
            print(f"Failed to fetch {url}: {r.status_code}")
            abort(r.status_code)
        return r.content
    except requests.exceptions.RequestException as e:
        print(f"Request failed for {url}: {e}")
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
                data = fetch_from_server(iiif_url)
                if len(data) > 5000:  # Got actual image data
                    break
            except:
                continue
        else:
            abort(404, "No working URL found for this CNRS image")
    else:  # Assume Gallica
        iiif_url = f"https://gallica.bnf.fr/iiif/ark:/{quote(ark)}/f{fol}/{size}/full/0/default.jpg"
        data = fetch_from_server(iiif_url)
    
    filename = f"{ark.split('/')[-1]}_f{fol}.jpg"
    return Response(data, mimetype="image/jpeg", 
                   headers={"Content-Disposition": f'attachment; filename="{filename}"'})

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
    
    print(f"Proxying request to: {url}")
    
    try:
        data = fetch_from_server(url)
        
        # Determine content type based on URL or content
        content_type = "image/jpeg"  # default
        if url.lower().endswith('.png'):
            content_type = "image/png"
        elif url.lower().endswith('.gif'):
            content_type = "image/gif"
        elif url.lower().endswith('.webp'):
            content_type = "image/webp"
        
        # Extract filename from URL
        filename = url.split('/')[-1]
        if '?' in filename:
            filename = filename.split('?')[0]
        if not filename or '.' not in filename:
            filename = "image.jpg"
        
        return Response(
            data,
            mimetype=content_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )
    except Exception as e:
        print(f"Proxy error: {e}")
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
            print(f"Trying Columbia URL: {iiif_url}")
            data = fetch_from_server(iiif_url)
            if len(data) > 5000:  # Got actual image data
                filename = f"columbia_{doc_id.replace('/', '_')}_p{canvas}.jpg"
                return Response(
                    data,
                    mimetype="image/jpeg",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'}
                )
        except Exception as e:
            print(f"Failed URL {iiif_url}: {e}")
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
    app.run(debug=True, port=5000)