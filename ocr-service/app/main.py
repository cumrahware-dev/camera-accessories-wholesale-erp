"""
ARIB GLOBAL OCR service (Tesseract, CPU only).

POST /ocr  (X-API-Key required)  multipart/form-data, field "file": PDF / PNG / JPG
Returns structured invoice JSON. It never creates ERP records - it only reads documents.

Memory model: the API process keeps no OCR model in memory. Each scanned page is read by a short-lived
`tesseract` subprocess; pages are processed one at a time and released immediately; nothing is written to disk.

Startup model (Render-friendly)
---------------------------------
  1. Server binds to $PORT immediately.
  2. GET /health returns HTTP 200 {"status": "ok"} at once — no models, no Tesseract, no key validation.
  3. First POST /ocr triggers lazy initialisation of Settings + engine (protected by asyncio.Lock).
"""
from __future__ import annotations

import asyncio
import ctypes
import gc
import hmac
import logging
import os
try:
    import resource
except ImportError:
    resource = None
import time
import uuid

from concurrent.futures import ThreadPoolExecutor

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Settings
from .engine import EngineUnavailable, OcrEngine, TesseractEngine, build_engine
from .extractor import extract_invoice
from .reader import DocumentError, read_document, sniff_type

log = logging.getLogger("ocr-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def _release_memory() -> None:
    """Give freed heap pages back to the OS (glibc otherwise keeps them, so RSS only ratchets upwards)."""
    gc.collect()
    try:
        import pymupdf
        pymupdf.TOOLS.store_shrink(100)  # empty MuPDF's decoded-image / glyph cache (defaults to hundreds of MB)
    except Exception:
        pass
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


def _rss_mb() -> float:
    try:
        with open("/proc/self/statm") as f:
            return int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE") / 1024 / 1024
    except Exception:
        return 0.0


def create_app(settings: Settings | None = None, engine: OcrEngine | None = None) -> FastAPI:
    """
    Build the FastAPI application.

    Lazy-init strategy
    ------------------
    * /health is registered first with NO shared state — it returns HTTP 200
      immediately so Render's port scanner finds a live server right after bind.
    * Settings and the OCR engine are initialised on the first real /ocr request,
      protected by an asyncio.Lock so parallel cold-start requests don't race.
    * Passing ``settings`` / ``engine`` directly (e.g. from tests) bypasses lazy-init.
    """

    # Lazy-init container — populated once on the first /ocr call.
    _init_lock: list = []   # holds the asyncio.Lock once created inside the event-loop
    _ctx: dict = {}         # keys: cfg, eng, gate, pool, state

    app = FastAPI(title="ARIB GLOBAL OCR", docs_url=None, redoc_url=None, openapi_url=None)

    def error(status: int, code: str, message: str, headers: dict | None = None) -> HTTPException:
        return HTTPException(status_code=status, detail={"success": False, "error": {"code": code, "message": message}}, headers=headers)

    @app.exception_handler(HTTPException)
    async def _http_error(_: Request, exc: HTTPException):
        body = exc.detail if isinstance(exc.detail, dict) else {"success": False, "error": {"code": "error", "message": str(exc.detail)}}
        return JSONResponse(body, status_code=exc.status_code, headers=exc.headers)

    # ── /health — MUST be first; uses no shared state ────────────────────────
    @app.get("/health")
    async def health(x_api_key: str | None = Header(default=None)):
        """
        Liveness probe used by Render & health verification used by ERP.

        - If no X-API-Key header is supplied, returns HTTP 200 {"status": "ok"} immediately (for Render port scanner).
        - If X-API-Key header IS supplied, validates API key and initializes engine to verify service readiness.
        """
        if x_api_key:
            try:
                ctx = await _get_ctx()
                cfg: Settings = ctx["cfg"]
                if not hmac.compare_digest(x_api_key.encode(), cfg.api_key.encode()):
                    return JSONResponse({"status": "unauthorized", "reason": "Invalid or rejected API key"}, status_code=401)
            except Exception as exc:
                return JSONResponse({"status": "error", "reason": str(exc)}, status_code=500)

        body: dict = {"status": "ok"}
        if _ctx:
            eng: OcrEngine = _ctx["eng"]
            state: dict = _ctx["state"]
            body["engine"] = eng.name
            body["running"] = state["running"]
            body["waiting"] = state["waiting"]
            body["rss_mb"] = round(_rss_mb(), 1)
            if hasattr(eng, "check"):
                try:
                    body["version"] = eng.check()
                except EngineUnavailable as exc:
                    return JSONResponse({"status": "degraded", **body, "reason": str(exc)}, status_code=503)
        return body

    # ── lazy initialiser ─────────────────────────────────────────────────────
    async def _get_ctx() -> dict:
        """Return (building once) the fully-initialised OCR context."""
        if _ctx:
            return _ctx
        # Lock must be created inside the running event-loop.
        if not _init_lock:
            _init_lock.append(asyncio.Lock())
        async with _init_lock[0]:
            if _ctx:  # double-checked locking
                return _ctx
            log.info("OCR service: cold-start — loading config and engine …")
            cfg = settings or Settings()
            if not cfg.api_key:
                raise RuntimeError("OCR_API_KEY must be set — the service refuses to start unauthenticated.")
            eng = engine or build_engine(cfg.langs, cfg.tesseract_cmd, cfg.psm)
            gate = asyncio.Semaphore(cfg.max_concurrency)
            # A fixed, tiny worker pool: no thread churn, so no per-thread malloc arenas accumulating memory.
            pool = ThreadPoolExecutor(max_workers=max(1, cfg.max_concurrency), thread_name_prefix="ocr")
            state: dict = {"waiting": 0, "running": 0}
            if cfg.allowed_origins:
                app.add_middleware(CORSMiddleware, allow_origins=list(cfg.allowed_origins), allow_methods=["POST", "GET"], allow_headers=["X-API-Key"])
            _ctx.update(cfg=cfg, eng=eng, gate=gate, pool=pool, state=state)
            log.info("OCR service: engine ready (%s)", eng.name)
            return _ctx

    async def require_key(x_api_key: str | None = Header(default=None)):
        ctx = await _get_ctx()
        cfg: Settings = ctx["cfg"]
        if not x_api_key or not hmac.compare_digest(x_api_key.encode(), cfg.api_key.encode()):
            raise error(401, "unauthorized", "Invalid or missing API key.")

    @app.get("/cloudinary/health", dependencies=[Depends(require_key)])
    async def cloudinary_health(upload: int = 0):
        """Diagnostic only (X-API-Key required). ?upload=1 also uploads, verifies and deletes a JPG, PNG and PDF."""
        from .cloudinary_check import health as cld_health
        body, status = await asyncio.get_running_loop().run_in_executor(None, cld_health, bool(upload))
        return JSONResponse(body, status_code=status)

    @app.post("/render", dependencies=[Depends(require_key)])
    async def render(file: UploadFile = File(...), page: int = 1, dpi: int = 110):
        """Page image (PNG) of an uploaded PDF, so the ERP can draw field highlights on PDFs. Cheap: no OCR."""
        import pymupdf
        from fastapi.responses import Response
        ctx = await _get_ctx()
        cfg: Settings = ctx["cfg"]
        data = await file.read(cfg.max_upload_bytes + 1)
        if len(data) > cfg.max_upload_bytes:
            raise error(413, "file_too_large", "File is too large.")
        if data[:5] != b"%PDF-":
            raise error(415, "unsupported_type", "Only PDF pages can be rendered.")
        try:
            doc = pymupdf.open(stream=data, filetype="pdf")
            if not 1 <= page <= len(doc):
                raise error(404, "no_such_page", "Page not found.")
            pix = doc[page - 1].get_pixmap(dpi=max(50, min(dpi, 200)), colorspace=pymupdf.csRGB, alpha=False)
            png = pix.tobytes("png")
            doc.close()
        except HTTPException:
            raise
        except Exception:
            raise error(422, "unreadable_file", "The PDF could not be rendered.")
        return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=600"})

    @app.post("/ocr", dependencies=[Depends(require_key)])
    async def ocr(file: UploadFile = File(...)):
        ctx = await _get_ctx()
        cfg: Settings = ctx["cfg"]
        eng: OcrEngine = ctx["eng"]
        gate: asyncio.Semaphore = ctx["gate"]
        pool: ThreadPoolExecutor = ctx["pool"]
        state: dict = ctx["state"]

        rid = uuid.uuid4().hex[:8]
        started = time.monotonic()

        # Read with a hard cap so an oversized upload never fills memory.
        data = bytearray()
        while chunk := await file.read(1024 * 1024):
            data.extend(chunk)
            if len(data) > cfg.max_upload_bytes:
                raise error(413, "file_too_large", f"File is too large (max {cfg.max_upload_bytes // (1024 * 1024)} MB).")
        if not data:
            raise error(400, "empty_file", "The uploaded file is empty.")
        kind = sniff_type(bytes(data[:12]))
        if not kind:
            raise error(415, "unsupported_type", "Unsupported file. Upload a PDF, PNG or JPG.")

        if state["waiting"] >= cfg.max_queue:
            raise error(429, "busy", "The OCR service is busy. Please try again in a moment.", {"Retry-After": "15"})
        state["waiting"] += 1
        loop = asyncio.get_running_loop()
        try:
            async with gate:
                state["waiting"] -= 1
                state["running"] += 1
                try:
                    deadline = time.monotonic() + cfg.timeout_seconds
                    payload = bytes(data)
                    del data  # the request copy is no longer needed while OCR runs
                    result = await asyncio.wait_for(
                        loop.run_in_executor(pool, lambda: read_document(payload, kind, eng, cfg, deadline)),
                        timeout=cfg.timeout_seconds + 5,
                    )
                finally:
                    state["running"] -= 1
                    _release_memory()
        except (asyncio.TimeoutError, TimeoutError):
            log.warning("[%s] timed out after %ss", rid, cfg.timeout_seconds)
            raise error(504, "timeout", "OCR took too long. Try a smaller or clearer file.")
        except DocumentError as exc:
            raise error(422, exc.code, str(exc))
        except EngineUnavailable as exc:
            log.error("[%s] engine unavailable: %s", rid, exc)
            raise error(503, "engine_unavailable", "The OCR engine is not available on the server.")
        except Exception:
            log.exception("[%s] OCR failure", rid)  # traceback only; never document content
            raise error(500, "ocr_failed", "The OCR engine failed to process this document.")
        finally:
            if state["waiting"] < 0:
                state["waiting"] = 0

        if not any(p.lines for p in result.pages):
            raise error(422, "empty_result", "No text could be read from this document.")

        out = extract_invoice(result, file.filename or "")
        if eng.name == "MockEngine":
            out["warnings"].insert(0, "DEMO ENGINE: Tesseract is not installed on the OCR server - these values are sample data, not read from your file.")
            out["review_fields"] = sorted(set(out["review_fields"]) | {"invoice_number", "customer_name", "line_items", "total"})
        elapsed = int((time.monotonic() - started) * 1000)
        out["success"] = True
        out["engine"] = eng.name
        out["document"] = {"kind": result.kind, "pages": result.page_count, "text_layer_pages": result.text_pages, "scanned_pages": result.scanned_pages}
        peak_rss = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1) if resource and hasattr(resource, 'getrusage') else 0.0
        engine_peak_rss = round(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024, 1) if resource and hasattr(resource, 'getrusage') else 0.0
        out["metrics"] = {
            "processing_ms": elapsed,
            "rss_mb": round(_rss_mb(), 1),
            "peak_rss_mb": peak_rss,
            "engine_peak_rss_mb": engine_peak_rss,
        }
        out["pages"] = [
            {
                "page": p.page, "source": p.source, "ms": p.ms, "mean_conf": round(p.mean_conf, 3), "passes": p.passes,
                "width": p.width, "height": p.height,
                "line_count": len(p.lines), "text": "\n".join(l.text for l in p.lines),
                "lines": [{"text": l.text, "conf": l.conf, "bbox": [round(l.x0), round(l.y0), round(l.x1), round(l.y1)]} for l in p.lines],
            }
            for p in result.pages
        ]
        log.info("[%s] ok kind=%s bytes=%d pages=%d ocr_pages=%d %dms", rid, kind, len(payload), result.page_count, result.scanned_pages, elapsed)
        return out

    return app


def app_factory() -> FastAPI:  # uvicorn --factory app.main:app_factory
    return create_app()
