-- Purchase invoices: VAT-inclusive pricing flag and the non-recoverable share of VAT. Additive and idempotent:
-- existing invoices get false / 0, which is exactly how they were always treated (VAT-exclusive costs, VAT fully recoverable).
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "nonRecoverableVatPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
