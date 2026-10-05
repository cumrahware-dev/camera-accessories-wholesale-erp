-- Proforma -> Tax Invoice now creates an editable DRAFT; issued invoices are corrected by Cancel & Reissue.
-- ADDITIVE ONLY: new nullable / defaulted columns. No existing invoice, proforma, customer, stock or depot row is
-- deleted or re-created, and no stored total is changed.

-- Invoice-level discount % (until now only the amount was stored) and per-line discount %.
ALTER TABLE "TaxInvoice" ADD COLUMN IF NOT EXISTS "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- A reissued draft points at the cancelled invoice it replaces.
ALTER TABLE "TaxInvoice" ADD COLUMN IF NOT EXISTS "amendsInvoiceId" TEXT;
ALTER TABLE "TaxInvoice" ADD COLUMN IF NOT EXISTS "amendsInvoiceNumber" TEXT;
CREATE INDEX IF NOT EXISTS "TaxInvoice_amendsInvoiceId_idx" ON "TaxInvoice"("amendsInvoiceId");

-- Backfill the invoice-level % from what was stored, so a draft edited later keeps the same discount.
UPDATE "TaxInvoice"
   SET "discountPercent" = ROUND(("discountAmount" / "subtotal" * 100)::numeric, 4)::double precision
 WHERE "subtotal" > 0 AND "discountAmount" > 0 AND "discountPercent" = 0;

-- Carry the line discount % over from the source proforma line where the match is unambiguous
-- (same proforma, same product, the product appears once on it).
UPDATE "InvoiceItem" ii
   SET "discountPercent" = pi."discountPercent"
  FROM "TaxInvoice" t, "ProformaItem" pi
 WHERE ii."invoiceId" = t.id
   AND t."proformaId" IS NOT NULL
   AND pi."proformaId" = t."proformaId"
   AND pi."productId" = ii."productId"
   AND pi."discountPercent" > 0
   AND ii."discountPercent" = 0
   AND (SELECT COUNT(*) FROM "ProformaItem" p2 WHERE p2."proformaId" = t."proformaId" AND p2."productId" = ii."productId") = 1;
