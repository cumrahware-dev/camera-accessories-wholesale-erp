-- Additive only. Speeds up (and enables) normalised SKU / barcode / model-number lookups used by OCR product matching,
-- and adds the supplier's-own-code -> product mapping that people confirm on the OCR review screen.

CREATE INDEX IF NOT EXISTS "Product_sku_key_idx"     ON "Product" (upper(regexp_replace("sku",     '[[:space:]_./‐‑–—―-]', '', 'g')));
CREATE INDEX IF NOT EXISTS "Product_barcode_key_idx" ON "Product" (upper(regexp_replace("barcode", '[[:space:]_./‐‑–—―-]', '', 'g')));
CREATE INDEX IF NOT EXISTS "Product_model_key_idx"   ON "Product" (upper(regexp_replace("model",   '[[:space:]_./‐‑–—―-]', '', 'g'))) WHERE "model" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "SupplierProductCode" (
  "id"           TEXT NOT NULL,
  "supplierId"   TEXT NOT NULL,
  "productId"    TEXT NOT NULL,
  "supplierCode" TEXT NOT NULL,
  "codeKey"      TEXT NOT NULL,
  "confirmedBy"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierProductCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierProductCode_supplierId_codeKey_key" ON "SupplierProductCode"("supplierId", "codeKey");
CREATE INDEX IF NOT EXISTS "SupplierProductCode_productId_idx" ON "SupplierProductCode"("productId");
DO $$ BEGIN
  ALTER TABLE "SupplierProductCode" ADD CONSTRAINT "SupplierProductCode_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SupplierProductCode" ADD CONSTRAINT "SupplierProductCode_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
