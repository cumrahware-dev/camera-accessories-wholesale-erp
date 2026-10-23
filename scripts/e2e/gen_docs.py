"""Generates the OCR test documents (digital PDF, scanned PDF, photo JPG) into argv[1] using the OCR service's own test generators."""
import io, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'ocr-service'))
from tests.variants import Spec, Item, build, raster, scan_pdf, phone_photo, to_bytes

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
items = [Item('Sony Alpha A7 IV Mirrorless Camera Body', 'ILCE-7M4/B', 12, 2398.00), Item('Sigma 24-70mm F2.8 DG DN Art Lens', 'A019-24-70-DGDN', 8, 1045.50), Item('Atomos Ninja V+ Monitor Recorder', 'ATOMNJAV2-PLUS', 4, 1549.75)]
spec = Spec('digital', title='TAX INVOICE', doc_type='tax_invoice', issuer='Mitsumi Distribution FZCO', issuer_vat='100345678900003', customer='ARIB GLOBAL FZE', number='MD-E2E-0001',
            layout='code_first', currency='USD', cur_style='code', vat_pct=5.0, freight=250.0, items=items, wrap=True)
pdf, truth = build(spec)
open(f'{out}/digital.pdf', 'wb').write(pdf)
open(f'{out}/scanned.pdf', 'wb').write(scan_pdf(pdf))
open(f'{out}/photo.jpg', 'wb').write(to_bytes(phone_photo(raster(pdf, 170))))
json.dump(truth, open(f'{out}/truth.json', 'w'), default=str)
print('ok')
