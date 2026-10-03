"""Independent Cloudinary credential check for the OCR service (diagnostic only).

The OCR workflow does NOT depend on this: the ERP (Next.js) stores the original file in Cloudinary and sends the
bytes to this service. This module lets you verify, from the Render host itself, that a given set of Cloudinary
credentials works, and shows Cloudinary's exact reason when it does not. It never returns the API secret.

Env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (or CLOUDINARY_URL=cloudinary://KEY:SECRET@CLOUD)
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request

log = logging.getLogger("ocr.cloudinary")


def _clean(v: str | None) -> str:
    s = (v or "").strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        s = s[1:-1].strip()
    return s


def resolve() -> dict:
    url = _clean(os.environ.get("CLOUDINARY_URL"))
    m = re.match(r"^cloudinary://([^:@\s]+):([^@\s]+)@([^/?#\s]+)", url or "")
    from_url = {"key": m.group(1), "secret": m.group(2), "cloud": m.group(3)} if m else {}
    cloud = _clean(os.environ.get("CLOUDINARY_CLOUD_NAME")) or from_url.get("cloud", "")
    key = _clean(os.environ.get("CLOUDINARY_API_KEY")) or from_url.get("key", "")
    secret = _clean(os.environ.get("CLOUDINARY_API_SECRET")) or from_url.get("secret", "")
    return {"cloud": cloud, "key": key, "secret": secret}


def _scrub(text: str, secret: str) -> str:
    text = str(text or "")
    if secret:
        text = text.replace(secret, "***")
    return re.sub(r"cloudinary://\S+", "cloudinary://***", text)[:500]


def _api_prefix() -> str:
    # CLOUDINARY_UPLOAD_PREFIX is only for private API endpoints / tests; normally api.cloudinary.com
    return (_clean(os.environ.get("CLOUDINARY_UPLOAD_PREFIX")) or "https://api.cloudinary.com").rstrip("/")


def _raw_ping(c: dict) -> dict:
    """Admin API ping without the SDK so the HTTP status, body and X-Cld-Error header are all visible."""
    req = urllib.request.Request(f"{_api_prefix()}/v1_1/{c['cloud']}/ping")
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{c['key']}:{c['secret']}".encode()).decode())
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return {"ok": True, "status": r.status}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            msg = json.loads(body).get("error", {}).get("message", "")
        except ValueError:
            msg = re.sub(r"<[^>]+>", " ", body).strip()[:300]
        return {"ok": False, "status": e.code, "message": _scrub(msg or e.reason, c["secret"]), "x_cld_error": _scrub(e.headers.get("X-Cld-Error", ""), c["secret"])}
    except Exception as e:  # network / DNS
        return {"ok": False, "status": 0, "message": _scrub(str(e), c["secret"]), "x_cld_error": ""}


def _samples() -> list[tuple[str, str, bytes, str]]:
    from PIL import Image
    import pymupdf

    img = Image.new("RGB", (64, 32), (255, 255, 255))
    jpg, png = io.BytesIO(), io.BytesIO()
    img.save(jpg, "JPEG")
    img.save(png, "PNG")
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "ARIB GLOBAL Cloudinary test")
    return [("jpg", "image/jpeg", jpg.getvalue(), "image"), ("png", "image/png", png.getvalue(), "image"), ("pdf", "application/pdf", doc.tobytes(), "raw")]


def health(upload: bool = False) -> tuple[dict, int]:
    c = resolve()
    out: dict = {
        "configured": bool(c["cloud"] and c["key"] and c["secret"]),
        "cloud_name": c["cloud"] or None,
        "api_key_present": bool(c["key"]),
        "api_secret_present": bool(c["secret"]),
        "connection": "not_configured",
    }
    if not out["configured"]:
        return out, 503

    ping = _raw_ping(c)
    if not ping["ok"]:
        out["connection"] = "failed"
        out["error"] = {k: v for k, v in ping.items() if k != "ok"}
        log.error("Cloudinary connection FAILED | HTTP status=%s | X-Cld-Error=%s | message=%s | cloud=%s | key=…%s",
                  ping.get("status"), ping.get("x_cld_error") or "n/a", ping.get("message"), c["cloud"], c["key"][-4:])
        return out, 502
    out["connection"] = "ok"
    log.info("Cloudinary connection successful (cloud=%s)", c["cloud"])
    if not upload:
        return out, 200

    try:
        import cloudinary
        import cloudinary.api
        import cloudinary.uploader
    except ImportError:
        out["test_upload"] = {"error": "The 'cloudinary' Python package is not installed (pip install cloudinary)."}
        return out, 500
    cloudinary.config(cloud_name=c["cloud"], api_key=c["key"], api_secret=c["secret"], secure=True, upload_prefix=_api_prefix())

    results, ok = {}, True
    for ext, mime, data, rtype in _samples():
        public_id = f"arib-global/ocr-test/health-{int(time.time())}-{ext}" + (".pdf" if rtype == "raw" else "")
        entry: dict = {"resource_type_requested": rtype}
        try:
            res = cloudinary.uploader.upload(io.BytesIO(data), public_id=public_id, resource_type=rtype, overwrite=True)
            entry.update(public_id=res.get("public_id"), secure_url=res.get("secure_url"), resource_type=res.get("resource_type"))
            entry["response_complete"] = bool(res.get("public_id") and res.get("secure_url") and res.get("resource_type"))
            # confirm the asset exists in the Media Library
            cloudinary.api.resource(res["public_id"], resource_type=rtype)
            entry["in_media_library"] = True
            entry["deleted"] = cloudinary.uploader.destroy(res["public_id"], resource_type=rtype, invalidate=True).get("result")
            entry["ok"] = entry["response_complete"] and entry["deleted"] == "ok"
            log.info("Cloudinary test upload %s ok | public_id=%s | resource_type=%s", ext, entry["public_id"], entry["resource_type"])
        except Exception as e:
            entry.update(ok=False, error=_scrub(getattr(e, "message", None) or str(e), c["secret"]), error_type=type(e).__name__)
            again = _raw_ping(c)
            if not again["ok"]:
                entry["x_cld_error"] = again.get("x_cld_error")
            log.error("Cloudinary test upload %s FAILED | %s: %s | X-Cld-Error=%s", ext, type(e).__name__, entry["error"], entry.get("x_cld_error") or "n/a")
        ok = ok and entry.get("ok", False)
        results[ext] = entry
    out["test_upload"] = results
    return out, 200 if ok else 502
