"""Test-only OCR service whose fake engine behaviour depends on a marker in the image (see below).
Run: OCR_API_KEY=... python tests/e2e_server.py 8002"""
import sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import uvicorn
from app.config import Settings
from app.main import create_app
from tests.test_api import INVOICE_LINES, _rows, FakeEngine

MODE = {"v": "normal"}

SALES = _rows([
    ["ARIB GLOBAL FZE"], ["TAX INVOICE", "Invoice No: INV-2026-00417"], ["Date: 14/03/2026"],
    ["Bill To:"], ["Lumina Cameras Pvt Ltd"], ["22 MG Road, Bengaluru"], ["TRN: 100889218200001"],
    ["Description", "SKU", "Qty", "Unit Price", "Amount"],
    ["Sony FX3 Camera Body", "SNY-FX3", "2", "3,899.00", "7,798.00"],
    ["Godox V1 Flash", "GDX-V1", "10", "249.50", "2,495.00"],
    ["Subtotal: USD 10,293.00"], ["Freight: USD 150.00"], ["VAT (5%): USD 514.65"], ["Grand Total: USD 10,957.65"],
], conf=0.95)


def doc(title, number, frm, to, rows_extra=None, conf=0.95, items=True):
    rows = [[frm], [title, f"No: {number}"], ["Date: 05/09/2026"], ["Bill To:"], [to], ["TRN: 100123456700003"]]
    if items:
        rows += [["Description", "SKU", "Qty", "Unit Price", "Amount"], ["Godox V1 Flash", "GDX-V1", "4", "250.00", "1,000.00"],
                 ["Subtotal: USD 1,000.00"], ["VAT (5%): USD 50.00"], ["Grand Total: USD 1,050.00"]]
    return _rows(rows, conf=conf)


SCENARIOS = {
    45: doc("TAX INVOICE", "SUP-8841", "ABC Trading LLC", "ARIB GLOBAL"),
    80: doc("QUOTATION", "QT-1201", "ARIB GLOBAL FZE", "Lumina Cameras Pvt Ltd"),
    120: doc("CREDIT NOTE", "CN-77", "ARIB GLOBAL FZE", "Lumina Cameras Pvt Ltd"),
    160: doc("DEBIT NOTE", "DN-31", "ARIB GLOBAL FZE", "Lumina Cameras Pvt Ltd"),
    200: doc("DELIVERY NOTE", "DLV-9", "ARIB GLOBAL FZE", "Lumina Cameras Pvt Ltd", items=False),
    220: _rows([["Meeting minutes"], ["Discuss roadmap"]]),
    240: doc("SUPPLIER BILL", "B-552", "ABC Trading LLC", "ARIB GLOBAL"),
    140: _rows([["TAX INVOICE", "Invoice No: INV-9"], ["Sony FX3 Camera SNY-FX3 2 3899.00 7798.00"], ["Grand Total: USD 7798.00"]], conf=0.5),
    180: _rows([["ARIB GLOBAL FZE"], ["PROFORMA INVOICE", "Proforma No: PF-7781"], ["Date: 02-Jan-2026"], ["Bill To:"], ["Acme Studios LLC"],
                ["Description", "Qty", "Unit Price", "Discount", "VAT", "Amount"],
                ["Wide Angle Lens LNS-14", "3", "500.00", "50.00", "72.50", "1,522.50"],
                ["Subtotal: USD 1,500.00"], ["Discount: USD 50.00"], ["Freight: USD 40.00"], ["VAT (5%): USD 72.50"], ["Total: USD 1,562.50"]], conf=0.93),
}


class ModalEngine(FakeEngine):
    def recognize(self, path):
        from PIL import Image
        im = Image.open(path).convert('RGB')
        px = im.getpixel((im.size[0] // 2, im.size[1] // 2))[0]  # scenario marker = red channel of the page colour
        key = min([20, 60, 100, 250, *SCENARIOS], key=lambda k: abs(k - px))
        if key == 20: raise RuntimeError("engine crash")
        if key == 60: time.sleep(6)
        if key == 100: return []
        return SCENARIOS.get(key, SALES)


if __name__ == "__main__":
    cfg = Settings(timeout_seconds=int(sys.argv[2]) if len(sys.argv) > 2 else 120)
    uvicorn.run(create_app(cfg, ModalEngine()), host="127.0.0.1", port=int(sys.argv[1]))
