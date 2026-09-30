# ARIB GLOBAL OCR service

Independent FastAPI service that reads invoices / proformas with PaddleOCR and returns structured JSON.
It **never creates ERP records** - the ERP calls it, shows the result on a Review screen, and only saves
after the user clicks *Confirm & Save*.

## Run

```bash
cd ocr-service
pip install -r requirements.txt
export OCR_API_KEY="$(openssl rand -hex 32)"      # required; the service refuses to start without it
uvicorn app.main:app_factory --factory --host 127.0.0.1 --port 8001
# or: docker build -t arib-ocr . && docker run -e OCR_API_KEY=... -p 8001:8001 -v paddlex:/root/.paddlex arib-ocr
```

ERP side (server env only): `OCR_API_URL=http://<host>:8001`, `OCR_API_KEY=<same key>`.
Put the service on a private network / behind TLS; only the ERP server should reach it.

## API

`GET /health` -> `{status, engine}` (no secrets).

`POST /ocr` (header `X-API-Key`, multipart field `file`: PDF / PNG / JPG, default max 15 MB, 30 pages)

```json
{ "success": true, "document_type": "tax_invoice", "type_confidence": 0.94, "confidence": 0.94, "engine": "PaddleOCR",
  "data": { "invoice_number": "", "invoice_date": "", "customer_name": "", "supplier_name": "", "vat_number": "",
            "currency": "", "subtotal": 0, "discount": 0, "tax": 0, "freight": 0, "other_charges": 0, "total": 0,
            "line_items": [{ "description": "", "sku": "", "quantity": 0, "unit_price": 0, "discount": 0, "tax": 0, "total": 0 }] },
  "review_fields": ["total"], "field_confidence": {"total": 0.91}, "warnings": [], "page_count": 1,
  "pages": [{ "page": 1, "source": "ocr", "line_count": 40, "text": "..." }] }
```

`document_type` is one of `tax_invoice`, `invoice`, `quotation`, `proforma_invoice`, `purchase_bill`, `purchase_invoice`, `credit_note`, `debit_note`, `delivery_note`, `other`
(chosen by weighted title keywords; `type_scores` shows the evidence). The service cannot know whether an invoice is a sale or a
purchase - the ERP decides that by comparing the issuer/addressee with its own company name.

Errors: `{ "success": false, "error": { "code", "message" } }` with 400/401/413/415/422/500/504.
Values not found stay empty/0 and are listed in `review_fields`; the service never guesses.

## Swapping the OCR engine
Implement `OcrEngine.recognize(image_path) -> list[Line]` in `app/engine.py` and select it in `build_engine`
(`OCR_ENGINE`). Nothing else changes. Digital PDFs use their embedded text and skip OCR.

## Tests
`pip install -r requirements-dev.txt && pytest` (uses a fake engine; no model download needed).

## Config (env)
`OCR_API_KEY` (required), `OCR_MAX_UPLOAD_MB`, `OCR_TIMEOUT_SECONDS`, `OCR_MAX_PAGES`, `OCR_MAX_CONCURRENCY`,
`PADDLEOCR_LANG`, `OCR_ALLOWED_ORIGINS` (empty = no CORS).
