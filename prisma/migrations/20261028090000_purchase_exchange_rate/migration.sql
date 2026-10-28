-- Purchase invoices: exchange rate to the company base currency (stock cost and journal are booked in the base currency).
-- Additive and idempotent. Existing rows stay NULL (unknown): nothing already posted is revalued; a foreign-currency DRAFT
-- must be given its rate before it can be posted.
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(18,6);
