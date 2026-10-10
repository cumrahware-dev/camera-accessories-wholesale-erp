# OCR accuracy & reliability — how the pipeline decides, and what was measured

Scope: Upload → PDF/image extraction → OCR → field detection → product matching → validation → review/edit → ERP conversion.
Nothing here replaces the existing OCR service or ERP modules; it tightens them. No paid OCR API or large model is used.

## Product (SKU) matching — `src/lib/ocr/matching.ts`, `sku.ts`
Order of evidence for each printed line (first hit that is unambiguous wins; anything else is offered as a candidate):

1. exact SKU (score 1.00)
2. same SKU ignoring case, spaces and `- _ . / –` (0.97). Digits, leading zeros and other punctuation (`+ # (`) are never changed.
3. a supplier's own code that a person confirmed earlier for that supplier (0.98) — table `SupplierProductCode`, written only when a reviewer picks a product on the review screen
4. barcode (0.97) / manufacturer part number = `Product.model` (0.95 when unique, 0.85 when shared by several products)
5. look-alike characters O/0, I/1/L, S/5 (≤2 changes) — **suggestion only, never applied automatically** (0.88)
6. product name (fallback; exact name 0.97, otherwise similarity × 0.9)

Applied automatically only if the best score is ≥ 0.95 **and** no other candidate ties it. Inactive products are capped below that. Several candidates → the reviewer picks. No product is ever created automatically. Lookups use indexed expression queries (additive migration `20261010090000_ocr_sku_matching`). Each line logs `extracted / normalized / method / candidate count / auto` (never invoice contents).

## Descriptions and table rows — `ocr-service/app/tables.py`
Fixed from measurement: a row number printed left of the table (`1`, `2.`) was glued into the description; a long SKU that touches the next column (`A019-24-70-DGDN` + `Sigma`) was merged into one word; a number inside a description (`HDMI cable 2.1`) was pulled into the quantity column; a table whose "Description" header was unreadable lost its text. The supplier's description is stored as printed; the matched ERP product (name/SKU) is a separate field.

## Numbers — `ocr-service/app/numbers.py`, `src/lib/money.ts`
`1,366,824.38`, `1.366.824,38`, `1 366 824,38`, `1'366'824.38`, `13,66,824.38`, `(1,234.50)`, `1,234.50-`. A value that can be read two ways (`1.366`, `1,366`) is parsed literally **and flagged** as ambiguous. The document's style is learned from its unambiguous numbers; a reviewer can state it when reprocessing and optionally remember it for that supplier. Totals are summed with decimal arithmetic (never float `+`).

## Validation — `src/lib/ocr/validation.ts`, `purchase-plan.ts`
* per line: qty × price − discount (+ line tax) vs the printed line total
* document: Σ lines − discount + tax + freight + other vs the printed grand total (tolerance scales with the number of lines)
* purchases: the invoice's own tax treatment is read from its printed tax (tax before/after the invoice discount); a line discount equal to the printed document discount is counted once; a missing line tax % is **proposed**, never applied silently; cent-level supplier rounding is carried on the largest line and disclosed.
* nothing is rounded to whole numbers (a fractional purchase quantity blocks conversion with a clear message) and the printed total is never overwritten.

## Purchase invoice conversion — `src/lib/ocr/conversion.ts`, `purchase-invoices.ts`
Creates a **DRAFT** purchase invoice through the existing Purchases module (columns for invoice discount, freight, other charges, line discount and `ocrDocumentId` added by migration `20261010100000_purchase_charges_ocr_link`; all default to 0 so existing invoices post exactly as before). No stock, cost or journal movement happens at upload, OCR or draft creation; posting uses the unchanged workflow (stock-in rows, moving-average cost at landed cost, balanced journal). One draft per scanned invoice (unique `ocrDocumentId`; a retry after a partial failure reuses the existing draft). The scanned original stays attached and cannot be deleted while the draft exists. A draft purchase invoice can again be deleted (the old array-form transaction failed after deleting).

## Review screen
A checklist with separate indicators (document type, supplier, number, date, SKU/product match, description, quantity, unit price, line totals, tax, grand total). Yellow = look at it, red = conversion blocked. They come from matching and arithmetic, not only OCR confidence. A flagged field can be confirmed; clicking a field still highlights its source on the original.

## Measured results (generated documents — see limits below)
| Suite | Result |
|---|---|
| `ocr-service/tests/bench.py` — 29 generated documents (PDF text layer, scans, photos, rotation, multi-page, 5 number/currency styles, large amounts) | 99.1 % field accuracy, **0 silent errors**; line items (qty + price + SKU + line total + description all correct): 60 % in the first strict run → **95 %** after the fixes above |
| same 8 documents through the full stack (upload → Tesseract service → DB) | header numbers/totals 8/8, line items 26/26 correct, 0 extra lines |
| `scripts/ocr-tests/sku-match.ts` (real DB, temporary `ZZT-` products) | 15/15 cases, 0 wrong automatic matches |
| `scripts/ocr-tests/purchase-plan.ts` (pure) | 18/18 |
| `scripts/ocr-tests/purchase-flow.ts` (throw-away DB copy via `run-temp-db.sh`) | 24/24: draft only, no stock at draft, double conversion refused, posting moves stock once and balances the journal |
| HTTP run, Mitsumi-style invoice (exact / hyphen→space / S↔5 SKUs, line + invoice discount, freight, 5 % VAT after discount) | 40/40 checks, both for a first invoice and for a second one that reuses the reviewer-confirmed supplier code |
| Quotation, Proforma, Tax Invoice conversions | all three still convert (PF-2026-00091/92, tax-invoice draft) |

**Limits.** The client's real documents (including the actual Mitsumi Distribution FZCO invoice) were not available in this environment, so the figures above are for generated documents that imitate those layouts, not for the client's files. Run `ocr-service/tests/bench.py` and `scripts/ocr-tests/*` against real invoices before quoting accuracy for them.
