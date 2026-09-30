"""
ARIB GLOBAL OCR service.

POST /ocr  (X-API-Key required)  multipart/form-data, field "file": PDF / PNG / JPG
Returns structured invoice JSON. It never creates ERP records - it only reads documents.
"""
from __future__ import annotations

import asyncio
import hmac
import logging
import time
import uuid

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Settings
from .engine import OcrEngine, build_engine
from .extractor import extract_invoice
from .reader import read_document, sniff_type

log = logging.getLogger("ocr-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def create_app(settings: Settings | None = None, engine: OcrEngine | None = None) -> FastAPI:
    cfg = settings or Settings()
    if not cfg.api_key:
        raise RuntimeError("OCR_API_KEY must be set - the service refuses to start unauthenticated.")
    eng = engine or build_engine(cfg.lang)
    gate = asyncio.Semaphore(cfg.max_concurrency)

    app = FastAPI(title="ARIB GLOBAL OCR", docs_url=None, redoc_url=None, openapi_url=None)
    if cfg.allowed_origins:
        app.add_middleware(CORSMiddleware, allow_origins=list(cfg.allowed_origins), allow_methods=["POST", "GET"], allow_headers=["X-API-Key"])

    def error(status: int, code: str, message: str) -> HTTPException:
        return HTTPException(status_code=status, detail={"success": False, "error": {"code": code, "message": message}})

    @app.exception_handler(HTTPException)
    async def _http_error(_: Request, exc: HTTPException):
        body = exc.detail if isinstance(exc.detail, dict) else {"success": False, "error": {"code": "error", "message": str(exc.detail)}}
        return JSONResponse(body, status_code=exc.status_code)

    def require_key(x_api_key: str | None = Header(default=None)):
        if not x_api_key or not hmac.compare_digest(x_api_key.encode(), cfg.api_key.encode()):
            raise error(401, "unauthorized", "Invalid or missing API key.")

    @app.get("/health")
    async def health():
        return {"status": "ok", "engine": eng.name}

    @app.post("/ocr", dependencies=[Depends(require_key)])
    async def ocr(file: UploadFile = File(...)):
        rid = uuid.uuid4().hex[:8]
        started = time.time()

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

        loop = asyncio.get_running_loop()
        try:
            async with gate:
                result = await asyncio.wait_for(
                    loop.run_in_executor(None, lambda: read_document(bytes(data), kind, eng, max_pages=cfg.max_pages, dpi=cfg.render_dpi)),
                    timeout=cfg.timeout_seconds,
                )
        except asyncio.TimeoutError:
            log.warning("[%s] timed out after %ss", rid, cfg.timeout_seconds)
            raise error(504, "timeout", "OCR took too long. Try a smaller or clearer file.")
        except ValueError as exc:
            raise error(422, "unreadable_file", str(exc))
        except Exception:
            log.exception("[%s] OCR engine failure", rid)  # traceback only; no document content
            raise error(500, "ocr_failed", "The OCR engine failed to process this document.")

        if not any(p.lines for p in result.pages):
            raise error(422, "empty_result", "No text could be read from this document.")

        out = extract_invoice(result)
        out["success"] = True
        out["engine"] = eng.name
        out["pages"] = [{"page": p.page, "source": p.source, "line_count": len(p.lines), "text": "\n".join(l.text for l in p.lines)} for p in result.pages]
        log.info("[%s] ok type=%s bytes=%d pages=%d %.1fs", rid, kind, len(data), result.page_count, time.time() - started)
        return out

    return app


def app_factory() -> FastAPI:  # uvicorn --factory app.main:app_factory
    return create_app()
