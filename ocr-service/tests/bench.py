"""OCR accuracy benchmark: runs the real pipeline (reader + Tesseract + extractor) over tests/variants.py.

    python -m tests.bench            # summary table
    python -m tests.bench -v         # per-document details

Scores every field against ground truth and counts SILENT errors: a wrong value that was NOT flagged for review.
Silent errors are the dangerous ones — the goal is zero, even when OCR is imperfect.
"""
from __future__ import annotations

import re
import sys
import time

from app.config import Settings
from app.engine import TesseractEngine
from app.extractor import extract_invoice
from app.reader import read_document
from tests.variants import corpus

FIELDS = ["doc_type", "number", "date", "customer", "supplier", "issuer_vat", "currency", "items", "subtotal", "discount", "tax", "freight", "total"]
REVIEW_KEY = {"doc_type": "document_type", "number": "invoice_number", "date": "invoice_date", "customer": "customer_name", "supplier": "supplier_name",
              "issuer_vat": "issuer_vat", "currency": "currency", "items": "line_items", "subtotal": "subtotal", "discount": "discount", "tax": "tax",
              "freight": "freight", "total": "total"}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def item_score(got: list, want: list) -> float:
    if not want:
        return 1.0
    hits = 0
    for w in want:
        for g in got:
            if abs(float(g.get("quantity", 0)) - w["qty"]) < 1e-6 and abs(float(g.get("unit_price", 0)) - w["price"]) < 0.005 and (not w["sku"] or norm(g.get("sku")) == norm(w["sku"])) and abs(float(g.get("total", 0)) - w.get("total", g.get("total", 0))) < 0.011 and norm(g.get("description")) == norm(w["desc"]):
                hits += 1
                break
    penalty = max(0, len(got) - len(want))
    return max(0.0, (hits - penalty) / len(want))


def score(out: dict, t: dict) -> dict:
    d = out["data"]
    eq = lambda a, b: abs(float(a or 0) - float(b or 0)) < 0.011
    return {
        "doc_type": out["document_type"] == t["doc_type"],
        "number": norm(d["invoice_number"]) == norm(t["number"]),
        "date": d["invoice_date"] == t["date"],
        "customer": norm(d["customer_name"]) == norm(t["customer"]),
        "supplier": norm(d["supplier_name"]) == norm(t["supplier"]),
        "issuer_vat": norm(d.get("issuer_vat") or d.get("vat_number")) == norm(t["issuer_vat"]),
        "currency": d["currency"] == t["currency"],
        "items": item_score(d["line_items"], t["items"]),
        "subtotal": eq(d["subtotal"], t["subtotal"]),
        "discount": eq(d["discount"], t["discount"]),
        "tax": eq(d["tax"], t["tax"]),
        "freight": eq(d["freight"], t["freight"]),
        "total": eq(d["total"], t["total"]),
    }


def main(verbose: bool = False) -> int:
    cfg = Settings(api_key="bench")
    eng = TesseractEngine(cfg.tesseract_cmd, cfg.langs, cfg.psm)
    eng.check()
    totals = {f: 0.0 for f in FIELDS}
    silent = {f: 0 for f in FIELDS}
    docs = corpus()
    t_all = time.monotonic()
    print(f"{'document':34} " + " ".join(f[:5].rjust(5) for f in FIELDS) + "  silent  ms")
    for name, data, kind, truth in docs:
        t0 = time.monotonic()
        res = read_document(data, kind, eng, cfg, time.monotonic() + 120)
        out = extract_invoice(res, name)
        ms = int((time.monotonic() - t0) * 1000)
        sc = score(out, truth)
        review = set(out["review_fields"])
        sil = []
        for f in FIELDS:
            v = float(sc[f])
            totals[f] += v
            if v < 1.0 and REVIEW_KEY[f] not in review:
                silent[f] += 1
                sil.append(f)
        cells = " ".join(("  ok " if sc[f] is True or sc[f] == 1.0 else f" {sc[f]:.2f}" if isinstance(sc[f], float) else "  -- ").rjust(5) for f in FIELDS)
        print(f"{name[:34]:34} {cells}  {len(sil):>5}  {ms}")
        if verbose and (sil or not all(sc[f] in (True, 1.0) for f in FIELDS)):
            d = out["data"]
            print(f"     got: type={out['document_type']} no={d['invoice_number']!r} date={d['invoice_date']} cust={d['customer_name']!r} supp={d['supplier_name']!r} vat={d.get('issuer_vat')!r} cur={d['currency']}")
            print(f"          sub={d['subtotal']} disc={d['discount']} tax={d['tax']} frt={d['freight']} total={d['total']} items={[(i['sku'], i['quantity'], i['unit_price']) for i in d['line_items']]}")
            print(f"     want: type={truth['doc_type']} no={truth['number']!r} date={truth['date']} cust={truth['customer']!r} supp={truth['supplier']!r} sub={truth['subtotal']} disc={truth['discount']} tax={truth['tax']} frt={truth['freight']} total={truth['total']}")
            print(f"     review={sorted(review)}  silent={sil}")
            for w in out["warnings"]:
                print(f"     ! {w}")
    n = len(docs)
    print("-" * 110)
    print(f"{'ACCURACY':34} " + " ".join(f"{totals[f] / n * 100:5.0f}" for f in FIELDS))
    print(f"{'SILENT ERRORS':34} " + " ".join(f"{silent[f]:5d}" for f in FIELDS))
    overall = sum(totals.values()) / (n * len(FIELDS)) * 100
    print(f"overall field accuracy {overall:.1f}%  |  silent errors {sum(silent.values())}  |  {n} documents in {time.monotonic() - t_all:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main("-v" in sys.argv))
