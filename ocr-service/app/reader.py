"""Turns an uploaded file into page-wise OCR lines using an OcrEngine."""
from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field

import pymupdf

from .engine import Line, OcrEngine


@dataclass
class Page:
    page: int
    source: str  # "text-layer" (digital PDF, exact) or "ocr"
    lines: list[Line] = field(default_factory=list)


@dataclass
class ReadResult:
    pages: list[Page]
    page_count: int
    truncated: bool = False


def sniff_type(head: bytes) -> str | None:
    if head[:5] == b"%PDF-":
        return "pdf"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if head[:3] == b"\xff\xd8\xff":
        return "jpg"
    return None


def read_document(data: bytes, kind: str, engine: OcrEngine, *, max_pages: int, dpi: int) -> ReadResult:
    try:
        doc = pymupdf.open(stream=data, filetype=kind)
    except Exception as exc:  # corrupt / encrypted / unreadable
        raise ValueError(f"The file could not be opened: {exc}") from exc
    if doc.needs_pass:
        raise ValueError("The PDF is password protected.")

    pages: list[Page] = []
    truncated = False
    with tempfile.TemporaryDirectory(prefix="ocr-") as tmp:  # always cleaned up
        for i, page in enumerate(doc):
            if i >= max_pages:
                truncated = True
                break
            lines: list[Line] = []
            source = "ocr"
            if kind == "pdf":
                words = page.get_text("words")
                if len(words) >= 15:  # a real text layer: use it verbatim, no OCR error possible
                    rows: dict = {}
                    for x0, y0, x1, y1, t, b, ln, _ in words:
                        rows.setdefault((b, ln), []).append((x0, y0, x1, y1, t))
                    for ws in rows.values():
                        ws.sort()
                        lines.append(Line(" ".join(w[4] for w in ws), 1.0, ws[0][0], min(w[1] for w in ws), ws[-1][2], max(w[3] for w in ws)))
                    source = "text-layer"
            if not lines:
                png = os.path.join(tmp, f"p{i}.png")
                page.get_pixmap(dpi=dpi if kind == "pdf" else 150).save(png)
                lines = engine.recognize(png)
                os.remove(png)
            pages.append(Page(i + 1, source, lines))
    return ReadResult(pages, len(doc), truncated)
