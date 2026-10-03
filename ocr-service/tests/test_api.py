"""API + extraction tests using a fake OCR engine that 'reads' a synthetic scanned invoice."""
import io
import time

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.engine import Line, PageOcr
from app.main import create_app

KEY = "test-key"


class FakeEngine:
    """Stands in for Tesseract: returns fixed lines, optionally slow or failing."""
    name = "fake"

    def __init__(self, lines=None, delay=0.0, fail=False):
        self.lines, self.delay, self.fail, self.calls = lines, delay, fail, 0

    def recognize(self, img, timeout):
        self.calls += 1
        if self.delay > timeout:  # a real engine subprocess is killed at its timeout
            time.sleep(timeout)
            raise TimeoutError("OCR timed out")
        time.sleep(self.delay)
        if self.fail:
            raise RuntimeError("boom")
        lines = self.lines if self.lines is not None else INVOICE_LINES
        words = sum(len(l.text.split()) for l in lines)
        conf = sum(l.conf for l in lines) / len(lines) * 100 if lines else 0.0
        return PageOcr(lines=lines, words=words, mean_conf=conf, good_words=words if conf >= 60 else 0)

    def orientation(self, img, timeout):
        return 0


def _rows(rows, conf=0.97):
    out, y = [], 40
    for row in rows:
        x = 40
        for cell in row:
            out.append(Line(cell, conf, x, y, x + 8 * len(cell), y + 12))
            x += 8 * len(cell) + 30
        y += 20
    return out


INVOICE_LINES = _rows([
    ["ARIB GLOBAL FZE"], ["TAX INVOICE", "Invoice No: INV-2026-00417"], ["Date: 14/03/2026"],
    ["Bill To:"], ["Lumina Cameras Pvt Ltd"], ["22 MG Road, Bengaluru"], ["TRN: 100889218200001"],
    ["Description", "SKU", "Qty", "Unit Price", "Discount", "Amount"],
    ["Sony FX3 Camera Body", "SNY-FX3", "2", "3,899.00", "0.00", "7,798.00"],
    ["Godox V1 Flash", "GDX-V1", "10", "249.50", "0.00", "2,495.00"],
    ["Subtotal: USD 10,293.00"], ["Discount: USD 293.00"], ["Freight: USD 150.00"], ["VAT (5%): USD 500.00"], ["Grand Total: USD 10,650.00"],
])


def pdf_with_text() -> bytes:
    d = pymupdf.open(); p = d.new_page()
    y = 50
    for t in ["ARIB GLOBAL FZE", "TAX INVOICE   Invoice No: INV-2026-00417", "Date: 14/03/2026", "Bill To:", "Lumina Cameras Pvt Ltd",
              "Description SKU Qty Unit Price Amount", "Sony FX3 Camera Body SNY-FX3 2 3,899.00 7,798.00",
              "Godox V1 Flash GDX-V1 10 249.50 2,495.00", "Subtotal: USD 10,293.00", "Freight: USD 150.00", "VAT (5%): USD 514.65", "Grand Total: USD 10,957.65"]:
        p.insert_text((40, y), t, fontsize=10); y += 16
    return d.tobytes()


def image_pdf(pages=1) -> bytes:
    d = pymupdf.open()
    for _ in range(pages):
        p = d.new_page(); p.draw_rect(pymupdf.Rect(50, 50, 200, 100), fill=(0.9, 0.9, 0.9))  # no text layer
    return d.tobytes()


def png() -> bytes:
    pm = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 40), False); pm.clear_with(255)
    return pm.tobytes("png")


def client(engine=None, **kw):
    cfg = Settings(api_key=KEY, **kw)
    return TestClient(create_app(cfg, engine or FakeEngine())), 


def post(c, data, name="f.pdf", key=KEY):
    return c.post("/ocr", files={"file": (name, io.BytesIO(data))}, headers={"X-API-Key": key} if key else {})


def test_refuses_to_serve_without_key():
    # Start-up is lazy (fast Render health checks), so the missing key is reported on the first real request.
    c = TestClient(create_app(Settings(api_key=""), FakeEngine()), raise_server_exceptions=False)
    assert c.post("/ocr", files={"file": ("f.pdf", io.BytesIO(pdf_with_text()))}, headers={"X-API-Key": "x"}).status_code >= 500


def test_auth_required():
    c, = client()
    assert post(c, pdf_with_text(), key=None).status_code == 401
    assert post(c, pdf_with_text(), key="wrong").status_code == 401


def test_digital_pdf_uses_text_layer_and_extracts_everything():
    eng = FakeEngine(); c, = client(eng)
    r = post(c, pdf_with_text()); assert r.status_code == 200, r.text
    j = r.json(); d = j["data"]
    assert j["success"] and j["document_type"] == "tax_invoice" and eng.calls == 0
    assert (d["invoice_number"], d["invoice_date"], d["customer_name"], d["currency"]) == ("INV-2026-00417", "2026-03-14", "Lumina Cameras Pvt Ltd", "USD")
    assert [i["sku"] for i in d["line_items"]] == ["SNY-FX3", "GDX-V1"]
    assert (d["subtotal"], d["freight"], d["tax"], d["total"]) == (10293.0, 150.0, 514.65, 10957.65)
    assert j["warnings"] == [] and j["pages"][0]["source"] == "text-layer"


@pytest.mark.parametrize("data,name", [(png(), "a.png"), (image_pdf(), "scan.pdf")])
def test_scan_and_image_use_ocr_and_trust_confident_reconciled_fields(data, name):
    eng = FakeEngine(); c, = client(eng)
    j = post(c, data, name).json(); d = j["data"]
    assert eng.calls == 1 and j["is_scanned"]
    assert "total" not in j["review_fields"] and "invoice_number" not in j["review_fields"]  # confident + reconciled
    assert d["vat_number"] == "100889218200001"
    it = d["line_items"][0]
    assert (it["sku"], it["quantity"], it["unit_price"], it["discount"], it["total"]) == ("SNY-FX3", 2, 3899.0, 0.0, 7798.0)
    assert d["discount"] == 293.0 and d["freight"] == 150.0 and d["tax"] == 500.0 and d["total"] == 10650.0


def test_multipage_pdf_processes_every_page():
    eng = FakeEngine(); c, = client(eng)
    j = post(c, image_pdf(3)).json()
    assert eng.calls == 3 and j["page_count"] == 3 and len(j["pages"]) == 3


def test_too_many_pages_is_rejected_not_truncated():
    c, = client(FakeEngine(), max_pages=2)
    r = post(c, image_pdf(3))
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_many_pages"


def test_poor_scan_flags_low_confidence_fields():
    low = _rows([["TAX INVOICE", "Invoice No: INV-9"], ["Sony FX3 Camera SNY-FX3 2 3899.00 7798.00"], ["Grand Total: USD 7798.00"]], conf=0.55)
    c, = client(FakeEngine(low))
    j = post(c, png(), "x.png").json()
    assert {"invoice_number", "total"} <= set(j["review_fields"])
    assert j["confidence"] == 0.55


def test_missing_fields_stay_empty_not_invented():
    c, = client(FakeEngine(_rows([["hello world this is a shopping list"]])))
    j = post(c, png(), "x.png").json(); d = j["data"]
    assert j["document_type"] == "other" and d["invoice_number"] == "" and d["customer_name"] == "" and d["total"] == 0 and d["line_items"] == []
    assert "line_items" in j["review_fields"]


def test_arithmetic_mismatch_is_reported_not_fixed():
    bad = _rows([["Invoice No: INV-1"], ["Description", "Qty", "Unit Price", "Amount"], ["Thing ABC-1 2 10.00 20.00"], ["Subtotal: 20.00"], ["Grand Total: 99.00"]])
    c, = client(FakeEngine(bad))
    j = post(c, png(), "x.png").json()
    assert j["data"]["total"] == 99.0 and any("document total reads 99.00" in w for w in j["warnings"])


def test_invalid_and_unsupported_files():
    c, = client()
    assert post(c, b"", "e.pdf").status_code == 400
    assert post(c, b"<html>hi</html>", "x.pdf").status_code == 415
    assert post(c, b"GIF89a....", "x.png").status_code == 415
    assert post(c, b"%PDF-1.4 garbage", "x.pdf").status_code == 422


def test_large_file_rejected():
    c, = client(FakeEngine(), max_upload_bytes=1024)
    r = post(c, b"%PDF-" + b"0" * 5000)
    assert r.status_code == 413 and r.json()["error"]["code"] == "file_too_large"


def test_timeout_maps_to_504():
    c, = client(FakeEngine(delay=1.5), timeout_seconds=1)
    r = post(c, png(), "x.png")
    assert r.status_code == 504 and r.json()["error"]["code"] == "timeout"


def test_engine_failure_maps_to_500_without_leaking_details():
    c, = client(FakeEngine(fail=True))
    r = post(c, png(), "x.png")
    assert r.status_code == 500 and "boom" not in r.text


def test_empty_result_is_an_error():
    c, = client(FakeEngine([]))
    r = post(c, png(), "x.png")
    assert r.status_code == 422 and r.json()["error"]["code"] == "empty_result"


def test_no_cors_by_default_and_health_is_open():
    c, = client()
    r = c.get("/health", headers={"Origin": "https://evil.example"})
    assert r.status_code == 200 and "access-control-allow-origin" not in r.headers


def test_column_aware_items_with_discount_and_vat_reconcile():
    rows = _rows([["PROFORMA", "Proforma No: PF-7781"], ["Description", "Qty", "Unit Price", "Discount", "VAT", "Amount"],
                  ["Wide Angle Lens LNS-14", "3", "500.00", "50.00", "72.50", "1,522.50"],
                  ["Subtotal: AED 1,500.00"], ["Discount: AED 50.00"], ["Freight: AED 40.00"], ["VAT (5%): AED 72.50"], ["Total: AED 1,562.50"]], conf=0.95)
    c, = client(FakeEngine(rows))
    j = post(c, png(), "x.png").json(); it = j["data"]["line_items"][0]
    assert j["document_type"] == "proforma_invoice" and j["warnings"] == []
    assert (it["description"], it["sku"], it["quantity"], it["discount"], it["tax"], it["total"]) == ("Wide Angle Lens", "LNS-14", 3, 50.0, 72.5, 1522.5)


@pytest.mark.parametrize("title,expected", [
    ("TAX INVOICE", "tax_invoice"), ("PROFORMA INVOICE", "proforma_invoice"), ("QUOTATION", "quotation"),
    ("CREDIT NOTE", "credit_note"), ("DEBIT NOTE", "debit_note"), ("DELIVERY NOTE", "delivery_note"),
    ("PURCHASE INVOICE", "purchase_invoice"), ("SUPPLIER BILL", "purchase_bill"), ("INVOICE", "invoice"),
])
def test_document_type_detection(title, expected):
    c, = client(FakeEngine(_rows([[title, "No: X-100"], ["Description", "Qty", "Unit Price", "Amount"], ["Thing ABC-1 2 10.00 20.00"], ["Total: 20.00"]])))
    j = post(c, png(), "x.png").json()
    assert j["document_type"] == expected and j["type_confidence"] >= 0.7, j["type_scores"]


def test_unknown_document_is_other_and_flagged():
    c, = client(FakeEngine(_rows([["Meeting minutes"], ["Discuss roadmap"]])))
    j = post(c, png(), "x.png").json()
    assert j["document_type"] == "other" and "document_type" in j["review_fields"]


def test_ambiguous_titles_have_low_confidence():
    c, = client(FakeEngine(_rows([["TAX INVOICE / CREDIT NOTE"], ["Total: 5.00"]])))
    j = post(c, png(), "x.png").json()
    assert j["type_confidence"] < 0.7 and "document_type" in j["review_fields"]


def test_cloudinary_health_requires_key_and_never_returns_secret(monkeypatch):
    c, = client()
    monkeypatch.delenv("CLOUDINARY_URL", raising=False)
    monkeypatch.setenv("CLOUDINARY_CLOUD_NAME", "demo")
    monkeypatch.setenv("CLOUDINARY_API_KEY", "123")
    monkeypatch.delenv("CLOUDINARY_API_SECRET", raising=False)
    assert c.get("/cloudinary/health").status_code == 401
    r = c.get("/cloudinary/health", headers={"X-API-Key": KEY})
    assert r.status_code == 503
    body = r.json()
    assert body == {"configured": False, "cloud_name": "demo", "api_key_present": True, "api_secret_present": False, "connection": "not_configured"}
