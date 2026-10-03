"""Accuracy guarantees on varied templates (real Tesseract for the scanned variants) + validation rules."""
import time

import pytest

from app.config import Settings
from app.engine import TesseractEngine
from app.extractor import extract_invoice, parse_amount, parse_date
from app.reader import read_document
from tests.bench import FIELDS, REVIEW_KEY, score
from tests.variants import Item, Spec, build, corpus


def run(data: bytes, kind: str = "pdf", name: str = "x.pdf") -> dict:
    return extract_invoice(read_document(data, kind, TesseractEngine(), Settings(api_key="t"), time.monotonic() + 120), name)


def test_benchmark_has_no_silent_errors_and_high_accuracy():
    total, silent, n = 0.0, [], 0
    for name, data, kind, truth in corpus():
        out = run(data, kind, name)
        sc = score(out, truth)
        for f in FIELDS:
            total += float(sc[f])
            if float(sc[f]) < 1.0 and REVIEW_KEY[f] not in out["review_fields"]:
                silent.append(f"{name}:{f}")
        n += 1
    assert not silent, silent  # a wrong value must always be flagged for review
    assert total / (n * len(FIELDS)) >= 0.97


@pytest.mark.parametrize("raw,val", [("1,250.00", 1250.0), ("1.250,00", 1250.0), ("1250", 1250.0), ("$1,250.00", 1250.0), ("AED 1,250.00", 1250.0), ("USD 1,250.00", 1250.0), ("12.5", 12.5)])
def test_number_formats(raw, val):
    assert parse_amount(raw) == val


@pytest.mark.parametrize("raw,iso", [("14/03/2026", "2026-03-14"), ("14-03-2026", "2026-03-14"), ("2026-03-14", "2026-03-14"), ("03/24/2026", "2026-03-24"),
                                     ("14 Mar 2026", "2026-03-14"), ("14-Mar-2026", "2026-03-14"), ("March 14, 2026", "2026-03-14")])
def test_date_formats(raw, iso):
    assert parse_date(raw)[0] == iso


def test_space_thousands_total_and_fields_have_positions():
    pdf, t = build(Spec("s", num_style="space"))
    out = run(pdf)
    assert abs(out["data"]["total"] - t["total"]) < 0.01
    for f in ("invoice_number", "invoice_date", "customer_name", "total"):
        b = out["fields"][f]["bbox"]
        assert b and 0 <= b["x0"] < b["x1"] <= 1 and 0 <= b["y0"] < b["y1"] <= 1 and b["page"] == 1
    assert all(i["bbox"] for i in out["data"]["line_items"])


def test_wrong_vat_and_total_are_flagged_not_corrected():
    import pymupdf
    d = pymupdf.open(); p = d.new_page(); y = 60
    for line in ["Nova Optics Trading LLC", "TAX INVOICE   Invoice No: INV-1", "Date: 14/03/2026", "Bill To:", "Lumina Cameras Pvt Ltd",
                 "Description            SKU        Qty     Unit Price     Amount", "Lens cap 77mm          LC-77      10      100.00         1,000.00",
                 "Subtotal: AED 1,000.00", "VAT (5%): AED 500.00", "Grand Total: AED 1,800.00"]:
        p.insert_text((40, y), line, fontsize=10); y += 16
    out = run(d.tobytes())
    assert out["data"]["tax"] == 500.0 and out["data"]["total"] == 1800.0  # what the document says, never "fixed"
    assert "tax" in out["review_fields"] and "total" in out["review_fields"]
    assert any(w.startswith("VAT looks wrong") for w in out["warnings"])
    assert any(w.startswith("Total mismatch — please review.") for w in out["warnings"])


def test_decimal_quantities_and_wrapped_descriptions():
    pdf, t = build(Spec("d", layout="simple", items=[Item("Gaffer tape 48mm black, per metre, cut to length on request", "GT", 12.5, 3.2), Item("Lens tissue", "LT", 6, 12.0)]))
    items = run(pdf)["data"]["line_items"]
    assert [i["quantity"] for i in items] == [12.5, 6]
    assert items[0]["description"].endswith("cut to length on request")
