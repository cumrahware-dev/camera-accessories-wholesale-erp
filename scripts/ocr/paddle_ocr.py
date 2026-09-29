#!/usr/bin/env python3
"""
PaddleOCR runner for the ARIB GLOBAL ERP.

Usage: paddle_ocr.py <file> [--max-pages N]
Prints ONE JSON object on stdout:
  { engine, pages: [{page, source: "text-layer"|"ocr", width, height,
                     lines: [{text, conf, x0, y0, x1, y1}]}] }
Digital PDFs use the embedded text layer (exact, no OCR error). Pages with no
usable text layer (scans) and images are run through PaddleOCR.
"""
import json, os, sys

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
os.environ.setdefault("FLAGS_use_mkldnn", "0")

_ocr = None


def get_ocr():
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR
        _ocr = PaddleOCR(
            lang=os.environ.get("PADDLEOCR_LANG", "en"),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=True,
            enable_mkldnn=False,
        )
    return _ocr


def ocr_image(path):
    res = get_ocr().predict(path)
    lines = []
    for r in res:
        d = r.json if hasattr(r, "json") else r
        d = d.get("res", d)
        texts, scores, boxes = d.get("rec_texts", []), d.get("rec_scores", []), d.get("rec_boxes", d.get("dt_polys", []))
        for t, s, b in zip(texts, scores, boxes):
            if not str(t).strip():
                continue
            b = [list(map(float, p)) for p in b] if len(b) and hasattr(b[0], "__len__") else None
            if b:
                xs, ys = [p[0] for p in b], [p[1] for p in b]
                x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
            else:
                bb = list(map(float, d["rec_boxes"][len(lines)]))
                x0, y0, x1, y1 = bb
            lines.append({"text": str(t), "conf": round(float(s), 4), "x0": x0, "y0": y0, "x1": x1, "y1": y1})
    return lines


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: paddle_ocr.py <file>"})); sys.exit(2)
    path = sys.argv[1]
    max_pages = 30
    if "--max-pages" in sys.argv:
        max_pages = int(sys.argv[sys.argv.index("--max-pages") + 1])
    try:
        import pymupdf as fitz
    except ImportError:
        import fitz
    out = {"engine": "paddleocr", "pages": []}
    tmpdir = os.path.dirname(os.path.abspath(path))
    try:
        doc = fitz.open(path)  # handles pdf and common images
    except Exception as e:
        print(json.dumps({"error": f"Unreadable file: {e}"})); sys.exit(3)
    out["pageCount"] = len(doc)
    for i, page in enumerate(doc):
        if i >= max_pages:
            out["truncated"] = True
            break
        w, h = page.rect.width, page.rect.height
        lines, source = [], "ocr"
        if doc.is_pdf:
            words = page.get_text("words")
            if len(words) >= 15:  # real text layer
                rows = {}
                for x0, y0, x1, y1, t, b, l, _ in words:
                    rows.setdefault((b, l), []).append((x0, y0, x1, y1, t))
                for ws in rows.values():
                    ws.sort()
                    lines.append({"text": " ".join(w_[4] for w_ in ws), "conf": 1.0,
                                  "x0": ws[0][0], "y0": min(w_[1] for w_ in ws),
                                  "x1": ws[-1][2], "y1": max(w_[3] for w_ in ws)})
                source = "text-layer"
        if not lines:
            png = os.path.join(tmpdir, f"_page_{i}.png")
            page.get_pixmap(dpi=220 if doc.is_pdf else 0 or 150).save(png)
            try:
                lines = ocr_image(png)
            finally:
                try: os.remove(png)
                except OSError: pass
        out["pages"].append({"page": i + 1, "source": source, "width": w, "height": h, "lines": lines})
    print(json.dumps(out))


if __name__ == "__main__":
    main()
