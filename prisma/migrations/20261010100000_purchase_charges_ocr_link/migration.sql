-- Additive only: existing purchase invoices keep zero for every new column and post exactly as before.
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "freightAmount"  DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "otherCharges"   DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "ocrDocumentId"  TEXT;
ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseInvoice_ocrDocumentId_key" ON "PurchaseInvoice"("ocrDocumentId");
