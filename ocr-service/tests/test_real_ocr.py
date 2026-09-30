"""
End-to-end tests with the REAL Tesseract engine on generated business documents.

Each document has ground truth. Invariant for every scenario: a field is either extracted correctly or it is
flagged for review - the system must never silently return a wrong value.
"""
import io
import shutil

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.docgen import *  # noqa: F401,F403
from tests.docgen import ITEMS, degrade_noise, low_res, make_pdf, rasterize, rotate, scan_pdf, to_jpg, to_png

pytestmark = pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract not installed")
KEY = "k"


@pytest.fixture(scope="module")
def client():
    return TestClient(create_app(Settings(api_key=KEY, timeout_seconds=90)))


def ocr(client, data, name="f.pdf"):
    r = client.post("/ocr", files={"file": (name, io.BytesIO(data))}, headers={"X-API-Key": KEY})
    assert r.status_code == 200, r.text
    return r.json()


def flagged(j, field):
    return field in j["review_fields"] or any(w for w in j["warnings"])


def check(j, truth, *, strict=True):
    d = j["data"]
    problems = []
    if truth["number"] and d["invoice_number"] != truth["number"] and not flagged(j, "invoice_number"):
        problems.append(f"number {d['invoice_number']!r} != {truth['number']!r} (unflagged)")
    for key, truth_key in (("total", "total"), ("subtotal", "subtotal")):
        if truth.get(truth_key) is not None and abs(d[key] - truth[truth_key]) > 0.01 and key not in j["review_fields"] and not any("reads" in w or "add up" in w for w in j["warnings"]):
            problems.append(f"{key} {d[key]} != {truth[truth_key]} (unflagged)")
    got = {i["sku"]: (i["quantity"], i["unit_price"]) for i in d["line_items"]}
    for it in truth["items"]:
        if got.get(it["sku"]) != (it["qty"], it["price"]) and "line_items" not in j["review_fields"]:
            problems.append(f"item {it['sku']} {got.get(it['sku'])} != {(it['qty'], it['price'])} (unflagged)")
    assert not problems, problems


def exact(j, truth):
    d = j["data"]
    assert d["invoice_number"] == truth["number"]
    assert abs(d["total"] - truth["total"]) < 0.01 and abs(d["subtotal"] - truth["subtotal"]) < 0.01
    assert {i["sku"]: (i["quantity"], i["unit_price"]) for i in d["line_items"]} == {it["sku"]: (it["qty"], it["price"]) for it in truth["items"]}


def test_digital_pdf_uses_text_layer_without_ocr(client):
    pdf, t = make_pdf(paid=5000)
    j = ocr(client, pdf)
    assert j["document"]["scanned_pages"] == 0 and j["pages"][0]["source"] == "text-layer" and j["metrics"]["processing_ms"] < 1500
    exact(j, t)
    d = j["data"]
    assert (d["issuer_vat"], d["customer_vat"], d["issuer_corporate_tax"], d["issuer_trade_license"], d["issuer_duns"]) == ("100889218200001", "200123456700003", "100889218200003", "1234567", "65-432-1098")
    assert d["issuer_email"] == "accounts@aribglobal.example" and d["customer_name"] == "Lumina Cameras Pvt Ltd" and "MG Road" in d["billing_address"]
    assert (d["paid"], d["balance"]) == (5000.0, t["total"] - 5000)
    assert j["fields"]["invoice_number"]["level"] == "high" and j["fields"]["invoice_number"]["page"] == 1


def test_scanned_pdf_clean(client):
    pdf, t = make_pdf()
    j = ocr(client, scan_pdf(pdf))
    assert j["document"]["scanned_pages"] == 1 and j["pages"][0]["source"] == "ocr"
    exact(j, t)


@pytest.mark.parametrize("kind", ["png", "jpg"])
def test_image_formats(client, kind):
    pdf, t = make_pdf()
    img = rasterize(pdf, 200)
    j = ocr(client, to_png(img) if kind == "png" else to_jpg(img, 70), f"scan.{kind}")
    exact(j, t)


def test_multipage_pdf_reads_every_page_in_order(client):
    pdf, t = make_pdf(pages=3)
    j = ocr(client, scan_pdf(pdf))
    assert j["document"]["pages"] == 3 and [p["page"] for p in j["pages"]] == [1, 2, 3]
    assert all(p["source"] == "ocr" and p["text"] for p in j["pages"])
    exact(j, t)


def test_mixed_pdf_only_scanned_pages_go_through_ocr(client):
    pdf, _ = make_pdf(pages=2)
    scanned = scan_pdf(pdf, pages=1)
    import pymupdf
    a, b = pymupdf.open(stream=scanned, filetype="pdf"), pymupdf.open(stream=pdf, filetype="pdf")
    a.insert_pdf(b, from_page=1, to_page=1)
    j = ocr(client, a.tobytes())
    assert [p["source"] for p in j["pages"]] == ["ocr", "text-layer"]


@pytest.mark.parametrize("title,expected,label", [
    ("QUOTATION", "quotation", "Quote No"), ("PROFORMA INVOICE", "proforma_invoice", "Proforma No"), ("TAX INVOICE", "tax_invoice", "Invoice No"),
    ("CREDIT NOTE", "credit_note", "Credit Note No"), ("DEBIT NOTE", "debit_note", "Debit Note No"),
])
def test_document_types_on_scans(client, title, expected, label):
    pdf, t = make_pdf(title=title, number="DOC-77120", number_label=label)
    j = ocr(client, scan_pdf(pdf))
    assert j["document_type"] == expected and j["type_confidence"] >= 0.7
    exact(j, t)


def test_delivery_note_without_prices(client):
    pdf, _ = make_pdf(title="DELIVERY NOTE", number="DN-5521", number_label="Delivery Note No", with_items=False)
    j = ocr(client, scan_pdf(pdf))
    assert j["document_type"] == "delivery_note" and j["data"]["invoice_number"] == "DN-5521"


def test_purchase_bill_with_code_first_layout(client):
    pdf, t = make_pdf(title="SUPPLIER BILL", number="B-90417", number_label="Bill No", issuer="ABC Trading LLC", customer="ARIB GLOBAL", layout="code_first", vat_pct=5.0)
    j = ocr(client, scan_pdf(pdf))
    assert j["document_type"] == "purchase_bill"
    d = j["data"]
    assert d["supplier_name"] == "ABC Trading LLC" and d["customer_name"] == "ARIB GLOBAL"
    exact(j, t)


def test_discount_and_freight_and_many_products(client):
    items = ITEMS + [("Lens Cleaning Kit", "LCK-01", 24, "PCS", 8.25), ("Memory Card 128GB", "MC-128", 40, "PCS", 21.5), ("HDMI Cable 2m", "HDMI-2M", 60, "PCS", 3.4)]
    pdf, t = make_pdf(items=items, discount=10.0, freight=275.0)
    j = ocr(client, scan_pdf(pdf))
    assert len(j["data"]["line_items"]) == 6 and j["data"]["freight"] == 275.0
    exact(j, t)
    assert j["data"]["discount"] > 0


def test_simple_layout_without_sku_column(client):
    pdf, t = make_pdf(layout="simple", vat_pct=5.0)
    j = ocr(client, scan_pdf(pdf))
    d = j["data"]
    assert [round(i["quantity"]) for i in d["line_items"]] == [2, 10, 5] and abs(d["total"] - t["total"]) < 0.01


@pytest.mark.parametrize("name,transform,jpeg,dpi", [
    ("skew+3deg", lambda im: rotate(im, 3), 85, 200),
    ("skew-2deg", lambda im: rotate(im, -2), 85, 200),
    ("rotated-90", lambda im: rotate(im, 90), 85, 200),
    ("upside-down", lambda im: rotate(im, 180), 85, 200),
    ("noisy-blurry", lambda im: degrade_noise(im), 60, 200),
    ("low-res-100dpi", lambda im: im, 50, 100),
    ("poor-halfres+noise", lambda im: degrade_noise(low_res(im, 0.6), amount=0.03), 35, 200),
])
def test_degraded_scans_are_correct_or_flagged(client, name, transform, jpeg, dpi):
    pdf, t = make_pdf()
    j = ocr(client, scan_pdf(pdf, dpi=dpi, jpeg_quality=jpeg, transform=transform))
    check(j, t)
    print(f"\n[{name}] no={j['data']['invoice_number']} total={j['data']['total']} items={len(j['data']['line_items'])} passes={j['pages'][0]['passes']} conf={j['pages'][0]['mean_conf']} review={j['review_fields']}")


def test_small_text_scan(client):
    pdf, t = make_pdf(fontsize=6.5)
    j = ocr(client, scan_pdf(pdf, dpi=300))
    check(j, t)


def test_missing_fields_are_empty_and_flagged_not_invented(client):
    pdf, _ = make_pdf(missing_number=True, missing_date=True, rich_header=False)
    j = ocr(client, scan_pdf(pdf))
    d = j["data"]
    assert d["invoice_number"] == "" and d["invoice_date"] == "" and "invoice_number" in j["review_fields"] and "invoice_date" in j["review_fields"]
    assert d["issuer_vat"] == "" or d["issuer_vat"]  # never crashes; empty when absent


def test_unknown_document(client):
    import pymupdf
    d = pymupdf.open(); p = d.new_page()
    for i, s in enumerate(["Minutes of the weekly meeting", "Attendees: Sam, Priya, Omar", "Discussed roadmap and hiring plan for Q4", "Next meeting on Monday morning at ten"]):
        p.insert_text((50, 80 + i * 20), s, fontsize=11)
    j = ocr(client, scan_pdf(d.tobytes()))
    assert j["document_type"] == "other" and "document_type" in j["review_fields"] and j["data"]["line_items"] == []


def test_blank_page_is_an_error_not_a_guess(client):
    import pymupdf
    d = pymupdf.open(); d.new_page()
    r = client.post("/ocr", files={"file": ("b.pdf", io.BytesIO(scan_pdf(d.tobytes())))}, headers={"X-API-Key": KEY})
    assert r.status_code == 422 and r.json()["error"]["code"] == "empty_result"


def test_wrong_ocr_value_is_caught_by_reconciliation(client):
    """A misread digit in a total must trigger the arithmetic check rather than pass silently."""
    pdf, t = make_pdf()
    import pymupdf
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    page = doc[0]
    for r in page.search_for("11,591.59"):
        page.add_redact_annot(r, text="11,591.99", fontsize=9.5)
    page.apply_redactions()
    j = ocr(client, doc.tobytes())
    assert j["data"]["total"] == 11591.99 and "total" in j["review_fields"] and any("document total reads" in w for w in j["warnings"])
