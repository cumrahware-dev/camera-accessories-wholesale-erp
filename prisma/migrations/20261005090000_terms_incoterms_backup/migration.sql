-- Payment terms vs payment method, Incoterms (never defaulted), backup history, ARIB GLOBAL company details.
-- ADDITIVE ONLY: new enum values, new columns with empty defaults, one new table, and a one-time update of the
-- company-details row to the values the business supplied (editable afterwards in Settings -> Company).
-- No customer, product, invoice, proforma, inventory, depot or user row is changed except as noted below.

-- AlterEnum (new customer payment terms)
ALTER TYPE "PaymentTerms" ADD VALUE IF NOT EXISTS 'NET_7';
ALTER TYPE "PaymentTerms" ADD VALUE IF NOT EXISTS 'NET_45';
ALTER TYPE "PaymentTerms" ADD VALUE IF NOT EXISTS 'CUSTOM';

-- Customer
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "customPaymentTerms" TEXT NOT NULL DEFAULT '';

-- Proforma: no more invented terms / CIF for NEW documents (existing rows keep what they have)
ALTER TABLE "Proforma" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Proforma" ADD COLUMN IF NOT EXISTS "incoterm" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Proforma" ADD COLUMN IF NOT EXISTS "incotermPlace" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Proforma" ALTER COLUMN "paymentTerms" SET DEFAULT '';
ALTER TABLE "Proforma" ALTER COLUMN "deliveryTerms" SET DEFAULT '';

-- TaxInvoice
ALTER TABLE "TaxInvoice" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TaxInvoice" ADD COLUMN IF NOT EXISTS "incoterm" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TaxInvoice" ADD COLUMN IF NOT EXISTS "incotermPlace" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TaxInvoice" ADD COLUMN IF NOT EXISTS "deliveryTerms" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TaxInvoice" ALTER COLUMN "paymentTerms" SET DEFAULT '';

-- BackupRun
CREATE TABLE IF NOT EXISTS "BackupRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "fileName" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "rowCounts" JSONB,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BackupRun_createdAt_idx" ON "BackupRun"("createdAt");

-- Customers already set to "Immediate / Wire Transfer" (the old combined option): record the method separately.
-- Only fills the NEW empty column; the customer's terms are untouched.
UPDATE "Customer" SET "paymentMethod" = 'Wire Transfer' WHERE "paymentTerms" = 'IMMEDIATE' AND "paymentMethod" = '';

-- Company details (database-driven; editable in Settings -> Company). One-time update to the supplied values.
ALTER TABLE "CompanySettings" ALTER COLUMN "companyName" SET DEFAULT 'Arib Global General Trading LLC';
ALTER TABLE "CompanySettings" ALTER COLUMN "taxRegistrationNumber" SET DEFAULT '100375415500003';
ALTER TABLE "CompanySettings" ALTER COLUMN "vatGstNumber" SET DEFAULT '100375415500003';
ALTER TABLE "CompanySettings" ALTER COLUMN "companyAddress" SET DEFAULT E'Office G-03\nGround Floor\nRed Avenue Building\n57th St. Al Garhoud\nP. O. Box 87433\nDubai - U.A.E.';

INSERT INTO "CompanySettings" ("id", "updatedAt") VALUES ('global-settings', NOW()) ON CONFLICT ("id") DO NOTHING;

UPDATE "CompanySettings" SET
  "companyName" = 'Arib Global General Trading LLC',
  "companyAddress" = E'Office G-03\nGround Floor\nRed Avenue Building\n57th St. Al Garhoud\nP. O. Box 87433\nDubai - U.A.E.',
  "vatGstNumber" = '100375415500003',
  "taxRegistrationNumber" = '100375415500003',
  "updatedAt" = NOW()
WHERE "id" = 'global-settings';
