"""
OCR engines. The rest of the service only depends on the tiny `OcrEngine` interface, so
PaddleOCR can be replaced by another engine by adding a class here and changing `build_engine`.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol


@dataclass
class Line:
    text: str
    conf: float
    x0: float
    y0: float
    x1: float
    y1: float


class OcrEngine(Protocol):
    name: str

    def recognize(self, image_path: str) -> list[Line]:
        """Read one page image and return text lines with confidence and bounding boxes."""
        ...


class PaddleEngine:
    name = "PaddleOCR"

    def __init__(self, lang: str = "en"):
        self._lang = lang
        self._ocr = None

    def _load(self):
        if self._ocr is None:
            os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
            from paddleocr import PaddleOCR  # imported lazily: heavy, and optional for tests

            self._ocr = PaddleOCR(
                lang=self._lang,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=True,
                enable_mkldnn=False,
            )
        return self._ocr

    def recognize(self, image_path: str) -> list[Line]:
        lines: list[Line] = []
        for res in self._load().predict(image_path):
            d = res.json if hasattr(res, "json") else res
            d = d.get("res", d)
            texts, scores = d.get("rec_texts", []), d.get("rec_scores", [])
            boxes = d.get("rec_boxes", d.get("dt_polys", []))
            for t, s, b in zip(texts, scores, boxes):
                if not str(t).strip():
                    continue
                flat = [float(v) for p in b for v in (p if hasattr(p, "__len__") else [p])]
                if len(flat) == 4:
                    x0, y0, x1, y1 = flat
                else:
                    xs, ys = flat[0::2], flat[1::2]
                    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
                lines.append(Line(str(t), round(float(s), 4), x0, y0, x1, y1))
        return lines


def build_engine(lang: str = "en") -> OcrEngine:
    name = os.environ.get("OCR_ENGINE", "paddle").lower()
    if name == "paddle":
        return PaddleEngine(lang)
    raise RuntimeError(f"Unknown OCR_ENGINE '{name}'")
