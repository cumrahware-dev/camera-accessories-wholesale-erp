"""
Turns an uploaded file into page-wise text lines.

Order of preference, cheapest first:
  1. Digital PDF page with a real text layer  -> read the text directly (exact, ~no CPU, no OCR).
  2. Scanned page / image                     -> light preprocessing + Tesseract.
  3. Poor result                              -> heavy preprocessing (+ orientation check) + Tesseract again.
Pages are handled strictly one at a time and released immediately.
"""
from __future__ import annotations

import gc
import io
import time
from dataclasses import dataclass, field

import pymupdf
from PIL import Image, ImageOps

from . import preprocess
from .config import Settings
from .engine import Line, OcrEngine, PageOcr


class DocumentError(ValueError):
    """A problem with the file itself (corrupt, encrypted, too many pages...). Maps to HTTP 422."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class Page:
    page: int
    source: str                      # "text-layer" or "ocr"
    lines: list[Line] = field(default_factory=list)
    ms: int = 0
    mean_conf: float = 1.0           # 0..1
    passes: list[str] = field(default_factory=list)   # e.g. ["light"], ["light", "heavy", "rotate90"]
    width: int = 0
    height: int = 0


@dataclass
class ReadResult:
    pages: list[Page]
    page_count: int
    kind: str
    text_pages: int = 0
    scanned_pages: int = 0


def sniff_type(head: bytes) -> str | None:
    if head[:5] == b"%PDF-":
        return "pdf"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if head[:3] == b"\xff\xd8\xff":
        return "jpg"
    return None


def _left(deadline: float) -> float:
    r = deadline - time.monotonic()
    if r <= 0:
        raise TimeoutError("OCR timed out")
    return r


def _text_layer_lines(page: "pymupdf.Page") -> list[Line]:
    words = page.get_text("words")
    if sum(1 for w in words if any(c.isalpha() for c in w[4])) < 10:
        return []  # no usable text layer (blank, or a scan with a few stray glyphs)
    rows: dict = {}
    for x0, y0, x1, y1, t, b, ln, _ in words:
        rows.setdefault((b, ln), []).append((x0, y0, x1, y1, t))
    lines: list[Line] = []
    for ws in rows.values():
        ws.sort()
        # split into cells on wide gaps, like the OCR path does
        h = max(w[3] - w[1] for w in ws)
        seg = [ws[0]]
        for prev, cur in zip(ws, ws[1:]):
            if cur[0] - prev[2] > 1.6 * h:
                lines.append(_cell(seg))
                seg = []
            seg.append(cur)
        lines.append(_cell(seg))
    return lines


def _cell(ws: list) -> Line:
    return Line(" ".join(w[4] for w in ws), 1.0, ws[0][0], min(w[1] for w in ws), ws[-1][2], max(w[3] for w in ws), [(w[4], w[0], w[2], 1.0) for w in ws])


def ocr_image(img: Image.Image, engine: OcrEngine, cfg: Settings, deadline: float) -> tuple[PageOcr, list[str], Image.Image]:
    """Light pass first; escalate only when needed. Returns (best result, passes tried, image that produced it)."""
    passes = ["light"]
    base = preprocess.upscale_if_small(preprocess.light(preprocess.limit_size(img, cfg.max_image_side)))
    # Skew estimation runs on a tiny thumbnail (cheap); the page itself is only rotated when it is clearly tilted.
    angle = preprocess.estimate_skew(base)
    if abs(angle) >= 0.8:
        base = base.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=255)
        passes.append("deskew")
    best = engine.recognize(base, _left(deadline))
    best_img = base
    if best.mean_conf >= cfg.good_confidence and best.words >= 15:
        return best, passes, best_img

    passes.append("heavy")
    h = preprocess.heavy(base)
    second = engine.recognize(h, _left(deadline))
    if second.good_words > best.good_words:
        best, best_img = second, h
    else:
        del h

    if best.mean_conf < 55:  # still poor: maybe the page is simply rotated
        deg = engine.orientation(best_img, _left(deadline))
        if deg:
            passes.append(f"rotate{deg}")
            rotated = preprocess.rotate_upright(base, deg)
            rotated = preprocess.heavy(rotated)
            third = engine.recognize(rotated, _left(deadline))
            if third.good_words > best.good_words:
                best, best_img = third, rotated
    return best, passes, best_img


def read_document(data: bytes, kind: str, engine: OcrEngine, cfg: Settings, deadline: float) -> ReadResult:
    Image.MAX_IMAGE_PIXELS = cfg.max_image_pixels  # decompression-bomb guard
    if kind == "pdf":
        return _read_pdf(data, engine, cfg, deadline)
    return _read_image(data, kind, engine, cfg, deadline)


def _read_image(data: bytes, kind: str, engine: OcrEngine, cfg: Settings, deadline: float) -> ReadResult:
    t0 = time.monotonic()
    try:
        img = Image.open(io.BytesIO(data))
        orientation = img.getexif().get(0x0112, 1)
        img.draft("L", (cfg.max_image_side, cfg.max_image_side))  # JPEG: decode at reduced size, saves RAM
        img.load()
        if img.mode != "L":
            img = img.convert("L")  # 1 byte/pixel from here on; colour is irrelevant for OCR
        if orientation in (2, 3, 4, 5, 6, 7, 8):
            img = ImageOps.exif_transpose(img) or img
    except Image.DecompressionBombError as exc:
        raise DocumentError("image_too_large", "The image has too many pixels to process.") from exc
    except Exception as exc:
        raise DocumentError("unreadable_file", "The image could not be opened. It may be corrupt.") from exc
    res, passes, used = ocr_image(img, engine, cfg, deadline)
    w, h = used.size  # boxes are in the coordinates of the image that was read (it may be scaled/deskewed)
    del img, used
    gc.collect()
    page = Page(1, "ocr", res.lines, int((time.monotonic() - t0) * 1000), res.mean_conf / 100.0, passes, w, h)
    return ReadResult([page], 1, kind, 0, 1)


def _read_pdf(data: bytes, engine: OcrEngine, cfg: Settings, deadline: float) -> ReadResult:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise DocumentError("unreadable_file", "The PDF could not be opened. It may be corrupt.") from exc
    try:
        if doc.needs_pass:
            raise DocumentError("encrypted", "The PDF is password protected.")
        n = len(doc)
        if n == 0:
            raise DocumentError("empty_document", "The PDF has no pages.")
        if n > cfg.max_pages:
            raise DocumentError("too_many_pages", f"The document has {n} pages; the limit is {cfg.max_pages}.")
        pages: list[Page] = []
        text_pages = scanned = 0
        for i in range(n):
            _left(deadline)
            t0 = time.monotonic()
            page = doc[i]
            lines = _text_layer_lines(page)
            if lines:
                text_pages += 1
                pages.append(Page(i + 1, "text-layer", lines, int((time.monotonic() - t0) * 1000), 1.0, [], int(page.rect.width), int(page.rect.height)))
                continue
            scanned += 1
            long_pts = max(page.rect.width, page.rect.height)
            dpi = min(cfg.render_dpi, int(cfg.max_image_side / long_pts * 72))
            pix = page.get_pixmap(dpi=max(72, dpi), colorspace=pymupdf.csGRAY, alpha=False)  # 1 byte/pixel
            img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
            del pix
            res, passes, used = ocr_image(img, engine, cfg, deadline)
            w, h = used.size
            del img, used
            gc.collect()  # release the page image before the next page is rendered
            pages.append(Page(i + 1, "ocr", res.lines, int((time.monotonic() - t0) * 1000), res.mean_conf / 100.0, passes, w, h))
        return ReadResult(pages, n, "pdf", text_pages, scanned)
    finally:
        doc.close()
