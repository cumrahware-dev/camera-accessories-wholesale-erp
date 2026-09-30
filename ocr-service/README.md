# ARIB GLOBAL OCR service (Tesseract, CPU-only, low RAM)

A small FastAPI service that reads invoices, quotations, proformas, purchase bills, credit/debit/delivery notes and
returns structured JSON. It is free/open-source (Tesseract 5 + PyMuPDF + Pillow), needs no GPU, no paid API and no
resident AI model. It **never creates ERP records**: the ERP shows the result on a review screen and only converts
after a person confirms.

## How it keeps RAM and CPU low
| Step | What happens |
|---|---|
| Digital PDF | Text is read straight from the PDF (PyMuPDF). No rendering, no OCR: ~0.1 s, ~+5 MB. |
| Scanned PDF / image | One page at a time: render 1-byte grayscale at 200 DPI (capped to 3200 px on the long side) -> `tesseract` subprocess -> page released. |
| Preprocessing | Light first (grayscale, contrast only if washed out, cheap skew check on a thumbnail). Heavy (background flattening, denoise, deskew, orientation check) only when the first pass reads poorly. |
| Model memory | Nothing stays loaded. Tesseract is a short-lived process (`OMP_THREAD_LIMIT=1`); the OS reclaims it after each page. Only the requested language files are used (English by default, 4 MB). |
| Temp files | None: pages travel to Tesseract over stdin. |
| Concurrency | 1 job at a time by default; up to `OCR_MAX_QUEUE` wait; more get HTTP 429 (the ERP retries later). |
| Heap hygiene | After every job: `gc`, MuPDF cache shrink and `malloc_trim`, so RSS returns to baseline instead of ratcheting up. |

Measured on this build (single core, English):

| Load | Wall | Peak RSS | RSS afterwards |
|---|---|---|---|
| idle service | - | 79 MB | - |
| digital PDF | 0.1 s | 85 MB | 84 MB |
| scanned 1 page | 0.9 s | 110 MB | 91 MB |
| scanned 20 pages (limit) | 17 s | 139 MB | 97 MB |
| 35-megapixel image | 2.1 s | 264 MB | 102 MB |
| 8 parallel uploads (queue 4) | 5 s | 124 MB | 101 MB (3 x HTTP 429) |

Run `python tests/resource_check.py` to reproduce on your own server. It fits a 512 MB host with the ERP on another box;
on a 1 GB host both fit comfortably.

## Run
```bash
sudo apt-get install -y tesseract-ocr tesseract-ocr-eng     # English only; add tesseract-ocr-<lang> later
cd ocr-service && pip install -r requirements.txt
export OCR_API_KEY="$(openssl rand -hex 32)"                # required: the service refuses to start without it
uvicorn app.main:app_factory --factory --host 127.0.0.1 --port 8001 --workers 1
```
Docker: `docker build -t arib-ocr . && docker run -e OCR_API_KEY=... -p 8001:8001 arib-ocr`.
ERP (server env only): `OCR_API_URL=http://<host>:8001`, `OCR_API_KEY=<same key>`. Keep the service on a private network.

More languages later: install the language pack, set `OCR_LANGS=eng+ara`. No code change.

## API
`GET /health` -> engine, Tesseract version, running/waiting jobs, RSS. `503 degraded` if Tesseract is missing.

`POST /ocr` (header `X-API-Key`, multipart field `file`: PDF/PNG/JPG, <= 15 MB, <= 20 pages).

```jsonc
{ "success": true, "engine": "Tesseract",
  "document_type": "tax_invoice", "type_confidence": 0.85, "confidence": 0.93,
  "document": { "kind": "pdf", "pages": 2, "text_layer_pages": 0, "scanned_pages": 2 },
  "data": {
    "invoice_number": "", "invoice_date": "2026-03-14", "due_date": "", "currency": "USD", "payment_terms": "",
    "supplier_name": "", "issuer_address": "", "issuer_phone": "", "issuer_email": "", "issuer_vat": "",
    "issuer_corporate_tax": "", "issuer_trade_license": "", "issuer_duns": "",
    "customer_name": "", "billing_address": "", "customer_vat": "", "email": "", "phone": "", "shipping_address": "",
    "subtotal": 0, "discount": 0, "tax": 0, "freight": 0, "other_charges": 0, "total": 0, "paid": 0, "balance": 0,
    "line_items": [ { "description": "", "sku": "", "quantity": 0, "unit": "", "unit_price": 0, "discount": 0,
                      "tax_rate": 0, "tax": 0, "total": 0, "confidence": 0.95, "page": 1 } ] },
  "fields": { "invoice_number": { "value": "INV-1", "confidence": 0.96, "level": "high", "page": 1 } },
  "review_fields": ["total"], "warnings": [],
  "pages": [ { "page": 1, "source": "ocr", "ms": 820, "mean_conf": 0.93, "passes": ["light"],
               "text": "...", "lines": [ { "text": "...", "conf": 0.97, "bbox": [x0, y0, x1, y1] } ] } ],
  "metrics": { "processing_ms": 910, "rss_mb": 96, "peak_rss_mb": 112, "engine_peak_rss_mb": 48 } }
```
`document_type`: `tax_invoice`, `invoice`, `quotation`, `proforma_invoice`, `purchase_bill`, `purchase_invoice`,
`credit_note`, `debit_note`, `delivery_note`, `other` (weighted title keywords; `type_scores` shows the evidence).
Whether an invoice is a sale or a purchase is decided by the ERP (it knows its own company name).
Levels: `high` >= 85 %, `medium` >= 60 %, `low` below. Values that are not found stay empty/0 and appear in
`review_fields`; the service never guesses, and arithmetic that does not reconcile is reported in `warnings`.

Errors: `{ "success": false, "error": { "code", "message" } }`: 400 empty_file, 401 unauthorized, 413 file_too_large,
415 unsupported_type, 422 unreadable_file / encrypted / too_many_pages / image_too_large / empty_result,
429 busy (Retry-After), 500 ocr_failed, 503 engine_unavailable, 504 timeout.

## Extraction strategy (deterministic, no LLM)
1. Label-based (`Invoice No`, `Inv #`, `Bill No`, `Quote No`, `Date`, `Due`, `Bill To`, `TRN`, `Corporate Tax`, `Trade Licence`, `D-U-N-S`...).
2. Regex for amounts, dates (day-first, ambiguity flagged), currencies, e-mail, phone, tax numbers.
3. Keyword proximity: bill-to block vs letterhead decides customer vs company details.
4. Table detection from the header row: column *names* define column *order* (SKU before/after description, VAT % vs VAT amount, unit, discount...). Rows are checked arithmetically (qty x price - discount + tax = line total); descriptions that wrap onto a second line are joined.
5. Reconciliation: line items vs subtotal, subtotal - discount + tax + freight + other vs total. A mismatch flags the fields instead of "fixing" them.

## Tests
`pip install -r requirements-dev.txt && pytest` - 55 tests. Half use a fake engine; `tests/test_real_ocr.py` runs the real
Tesseract on generated business documents (digital, scanned, JPG/PNG, multi-page, quotation, proforma, purchase bill,
credit/debit/delivery notes, skewed, rotated 90/180, noisy, low-resolution, small text, missing fields, unknown) and asserts the
invariant *every field is either correct or flagged for review*.

## Config (env)
`OCR_API_KEY` (required), `OCR_MAX_UPLOAD_MB` (15), `OCR_TIMEOUT_SECONDS` (120), `OCR_MAX_PAGES` (20),
`OCR_MAX_CONCURRENCY` (1), `OCR_MAX_QUEUE` (4), `OCR_LANGS` (eng), `OCR_RENDER_DPI` (200), `OCR_MAX_IMAGE_SIDE` (3200),
`OCR_MAX_IMAGE_MPIXELS` (40), `OCR_PSM` (4), `OCR_GOOD_CONFIDENCE` (75), `TESSERACT_CMD`, `OCR_ALLOWED_ORIGINS` (empty = no CORS).

## Swapping the engine later
Implement `OcrEngine` (`recognize(img, timeout) -> PageOcr`, `orientation(...)`) in `app/engine.py` and select it in `build_engine`.
