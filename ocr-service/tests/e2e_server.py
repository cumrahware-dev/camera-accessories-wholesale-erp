"""Test-only OCR service whose fake engine behaviour depends on a marker in the image (see below).
Run: OCR_API_KEY=... python tests/e2e_server.py 8002"""
import sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import uvicorn
from app.config import Settings
from app.main import create_app
from tests.test_api import INVOICE_LINES, _rows, FakeEngine

MODE = {"v": "normal"}

class ModalEngine(FakeEngine):
    def recognize(self, path):
        # the page's background red value selects the scenario (test files are solid colours)
        from PIL import Image
        px = Image.open(path).convert('RGB').getpixel((Image.open(path).size[0] // 2, Image.open(path).size[1] // 2))[0]  # scenario marker = red channel of the page colour
        w = min({20: 100, 60: 101, 100: 102, 140: 103, 180: 104, 250: 0}.items(), key=lambda kv: abs(kv[0] - px))[1]
        if w == 100: raise RuntimeError("engine crash")
        if w == 101: time.sleep(6)
        if w == 102: return []
        if w == 103: return _rows([["INVOICE", "Invoice No: INV-9"], ["Sony FX3 Camera SNY-FX3 2 3899.00 7798.00"], ["Grand Total: USD 7798.00"]], conf=0.5)
        if w == 104:
            return _rows([["PROFORMA INVOICE", "Proforma No: PF-7781"], ["Date: 02-Jan-2026"], ["Bill To:"], ["Acme Studios LLC"],
                ["Description", "Qty", "Unit Price", "Discount", "VAT", "Amount"],
                ["Wide Angle Lens LNS-14", "3", "500.00", "50.00", "72.50", "1,522.50"],
                ["Subtotal: AED 1,500.00"], ["Discount: AED 50.00"], ["Freight: AED 40.00"], ["VAT (5%): AED 72.50"], ["Total: AED 1,562.50"]], conf=0.93)
        return INVOICE_LINES

if __name__ == "__main__":
    cfg = Settings(timeout_seconds=int(sys.argv[2]) if len(sys.argv) > 2 else 120)
    uvicorn.run(create_app(cfg, ModalEngine()), host="127.0.0.1", port=int(sys.argv[1]))
