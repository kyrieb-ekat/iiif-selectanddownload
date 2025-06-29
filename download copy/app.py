# app.py
import os, time
import requests
from functools import lru_cache
from urllib.parse import quote

from flask import Flask, request, Response, abort

# ---- simple rate-limiter ----
MIN_SECONDS_BETWEEN_CALLS = 12   # ≈5 requests/min
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
def fetch_from_gallica(url: str) -> bytes:
    wait_if_needed()
    r = requests.get(url, timeout=20)
    if r.status_code == 429:
        # bubble up so the browser sees a retry-able error
        abort(503, "Gallica rate-limit hit, retry later")
    if r.status_code != 200:
        abort(r.status_code)
    return r.content

@app.route("/download")
def download():
    """
    /download?ark=12148/btv1b55010551d&f=39&size=full
    """
    ark  = request.args.get("ark")   # e.g. 12148/btv1b55010551d
    fol  = request.args.get("f")     # folio/page number, e.g. 39
    size = request.args.get("size", "full")  # or "800," etc. per IIIF

    if not ark or not fol:
        abort(400, "ark and f are required query parameters")

    iiif_url = (
        f"https://gallica.bnf.fr/iiif/ark:/{quote(ark)}/f{fol}/{size}/full/0/default.jpg"
    )

    data = fetch_from_gallica(iiif_url)
    filename = f"{ark.split('/')[-1]}_f{fol}.jpg"

    return Response(
        data,
        mimetype="image/jpeg",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

if __name__ == "__main__":
    app.run(debug=True)            # use a proper WSGI server in prod

@app.route("/download")
def download():
    """
    /download?ark=12148/btv1b55010551d&f=39&size=full
    """
    ark = request.args.get("ark")
    fol = request.args.get("f")
    size = request.args.get("size", "full")
    
    if not ark or not fol:
        abort(400, "ark and f are required query parameters")
    
    # Determine if this is CNRS or Gallica based on ARK
    if ark.startswith("63955/"):  # CNRS pattern
        iiif_url = f"https://iiif.irht.cnrs.fr/iiif/ark:/{quote(ark)}/f{fol}/{size}/full/0/default.jpg"
    else:  # Assume Gallica
        iiif_url = f"https://gallica.bnf.fr/iiif/ark:/{quote(ark)}/f{fol}/{size}/full/0/default.jpg"
    
    data = fetch_from_server(iiif_url)  # You'll need to rename/update this function
    filename = f"{ark.split('/')[-1]}_f{fol}.jpg"
    
    return Response(
        data,
        mimetype="image/jpeg",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
@app.route("/download")
def download():
    ark = request.args.get("ark")
    fol = request.args.get("f") 
    size = request.args.get("size", "full")
    
    if not ark or not fol:
        abort(400, "ark and f are required query parameters")
    
    # Try multiple URL patterns for CNRS
    if ark.startswith("63955/"):  # CNRS pattern
        # Try different CNRS URL patterns
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