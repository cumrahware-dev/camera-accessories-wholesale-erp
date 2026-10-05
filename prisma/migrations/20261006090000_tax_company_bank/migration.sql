-- Configurable tax (default 0%), structured company address, multiple bank accounts, and document snapshots.
-- ADDITIVE ONLY: new tables/columns with safe defaults. Existing customers, products (other than the tax figure
-- described below), invoices, proformas, stock, depots and users are not deleted or re-created.

-- ── Tax rates ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TaxRate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TaxRate_isDefault_isActive_idx" ON "TaxRate"("isDefault", "isActive");

-- The ARIB GLOBAL requirement: VAT 0%. Only created when no tax rate exists yet.
INSERT INTO "TaxRate" ("id", "name", "rate", "description", "isActive", "isDefault", "effectiveFrom", "updatedAt")
SELECT 'tax-vat-default', 'VAT', 0, 'Default tax for the product catalogue and new documents', true, true, TIMESTAMP '2000-01-01 00:00:00', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "TaxRate");

-- ── Products ────────────────────────────────────────────────────────────────
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "useDefaultTax" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ALTER COLUMN "taxRate" SET DEFAULT 0;
ALTER TABLE "ProformaItem" ALTER COLUMN "taxRate" SET DEFAULT 0;
ALTER TABLE "InvoiceItem" ALTER COLUMN "taxRate" SET DEFAULT 0;

-- Products that carry the old automatic 5% (or 0%) now follow the default tax (0%).
-- Products with any OTHER rate were set on purpose: they keep it as a custom rate.
-- Only the product's own tax figure changes. Documents already issued keep the tax stored on each of their lines.
UPDATE "Product" SET "useDefaultTax" = false WHERE "taxRate" NOT IN (0, 5);
UPDATE "Product" p SET "taxRate" = t."rate"
  FROM (SELECT "rate" FROM "TaxRate" WHERE "isDefault" AND "isActive" ORDER BY "effectiveFrom" DESC LIMIT 1) t
  WHERE p."useDefaultTax" = true;

-- ── Company: structured address and mobile ──────────────────────────────────
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "addressOffice" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "addressBuilding" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "addressStreet" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "addressArea" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "addressCity" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "addressCountry" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "poBox" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "mobile" TEXT NOT NULL DEFAULT '';

-- Split the current printed address into its parts, but ONLY while it is still exactly the supplied ARIB GLOBAL address
-- (so an address someone has since edited is never overwritten). Otherwise the whole printed address becomes the office address.
UPDATE "CompanySettings" SET
  "addressOffice" = E'Office G-03\nGround Floor', "addressBuilding" = 'Red Avenue Building', "addressStreet" = '57th St.',
  "addressArea" = 'Al Garhoud', "poBox" = '87433', "addressCity" = 'Dubai', "addressCountry" = 'U.A.E.'
WHERE "id" = 'global-settings' AND "addressOffice" = ''
  AND "companyAddress" = E'Office G-03\nGround Floor\nRed Avenue Building\n57th St. Al Garhoud\nP. O. Box 87433\nDubai - U.A.E.';
UPDATE "CompanySettings" SET "addressOffice" = "companyAddress" WHERE "addressOffice" = '' AND "companyAddress" <> '';

-- ── Bank accounts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BankAccount" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "bankName" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT '',
    "accountName" TEXT NOT NULL DEFAULT '',
    "accountNumber" TEXT NOT NULL DEFAULT '',
    "iban" TEXT NOT NULL DEFAULT '',
    "swiftBic" TEXT NOT NULL DEFAULT '',
    "routingCode" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT '',
    "bankAddress" TEXT NOT NULL DEFAULT '',
    "paymentInstructions" TEXT NOT NULL DEFAULT '',
    "otherInfo" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BankAccount_isActive_isDefault_idx" ON "BankAccount"("isActive", "isDefault");

-- The bank details already on the company record become the first (default) bank account.
INSERT INTO "BankAccount" ("id", "label", "bankName", "accountName", "accountNumber", "iban", "swiftBic", "routingCode", "currency", "isActive", "isDefault", "updatedAt")
SELECT 'bank-primary', 'Primary account', cs."bankName", cs."accountName", cs."accountNumber", cs."iban", cs."swiftBic", cs."routingCode", cs."currency", true, true, NOW()
FROM "CompanySettings" cs
WHERE cs."id" = 'global-settings' AND cs."bankName" <> '' AND NOT EXISTS (SELECT 1 FROM "BankAccount");

-- ── Document snapshots ──────────────────────────────────────────────────────
ALTER TABLE "Proforma" ADD COLUMN IF NOT EXISTS "companySnapshot" JSONB;
ALTER TABLE "TaxInvoice" ADD COLUMN IF NOT EXISTS "companySnapshot" JSONB;
ALTER TABLE "ServiceInvoice" ADD COLUMN IF NOT EXISTS "companySnapshot" JSONB;

-- Documents that are ALREADY issued are frozen with today's company/bank details so later edits in Settings cannot change them.
-- Drafts stay live until they are issued. Only the new column is written.
WITH snap AS (
  SELECT jsonb_build_object(
    'capturedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'company', jsonb_build_object(
      'companyName', cs."companyName", 'tradingName', cs."tradingName", 'logoUrl', cs."logoUrl", 'companyAddress', cs."companyAddress",
      'phone', cs."phone", 'mobile', cs."mobile", 'email', cs."email", 'website', cs."website",
      'vatGstNumber', cs."vatGstNumber", 'taxRegistrationNumber', cs."taxRegistrationNumber",
      'corporateTaxNumber', cs."corporateTaxNumber", 'tradeLicenceNumber', cs."tradeLicenceNumber", 'dunsNumber', cs."dunsNumber"),
    'bankAccounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', b."id", 'label', b."label", 'bankName', b."bankName", 'branch', b."branch", 'accountName', b."accountName",
        'accountNumber', b."accountNumber", 'iban', b."iban", 'swiftBic', b."swiftBic", 'routingCode', b."routingCode",
        'currency', b."currency", 'bankAddress', b."bankAddress", 'paymentInstructions', b."paymentInstructions",
        'otherInfo', b."otherInfo", 'isDefault', b."isDefault") ORDER BY b."isDefault" DESC, b."sortOrder", b."createdAt")
      FROM "BankAccount" b WHERE b."isActive"), '[]'::jsonb)
  ) AS j FROM "CompanySettings" cs WHERE cs."id" = 'global-settings'
)
UPDATE "TaxInvoice" SET "companySnapshot" = (SELECT j FROM snap) WHERE "documentStatus" <> 'DRAFT' AND "companySnapshot" IS NULL AND EXISTS (SELECT 1 FROM snap);

WITH snap AS (
  SELECT jsonb_build_object(
    'capturedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'company', jsonb_build_object(
      'companyName', cs."companyName", 'tradingName', cs."tradingName", 'logoUrl', cs."logoUrl", 'companyAddress', cs."companyAddress",
      'phone', cs."phone", 'mobile', cs."mobile", 'email', cs."email", 'website', cs."website",
      'vatGstNumber', cs."vatGstNumber", 'taxRegistrationNumber', cs."taxRegistrationNumber",
      'corporateTaxNumber', cs."corporateTaxNumber", 'tradeLicenceNumber', cs."tradeLicenceNumber", 'dunsNumber', cs."dunsNumber"),
    'bankAccounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', b."id", 'label', b."label", 'bankName', b."bankName", 'branch', b."branch", 'accountName', b."accountName",
        'accountNumber', b."accountNumber", 'iban', b."iban", 'swiftBic', b."swiftBic", 'routingCode', b."routingCode",
        'currency', b."currency", 'bankAddress', b."bankAddress", 'paymentInstructions', b."paymentInstructions",
        'otherInfo', b."otherInfo", 'isDefault', b."isDefault") ORDER BY b."isDefault" DESC, b."sortOrder", b."createdAt")
      FROM "BankAccount" b WHERE b."isActive"), '[]'::jsonb)
  ) AS j FROM "CompanySettings" cs WHERE cs."id" = 'global-settings'
)
UPDATE "Proforma" SET "companySnapshot" = (SELECT j FROM snap) WHERE "status" <> 'DRAFT' AND "companySnapshot" IS NULL AND EXISTS (SELECT 1 FROM snap);

WITH snap AS (
  SELECT jsonb_build_object(
    'capturedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'company', jsonb_build_object(
      'companyName', cs."companyName", 'tradingName', cs."tradingName", 'logoUrl', cs."logoUrl", 'companyAddress', cs."companyAddress",
      'phone', cs."phone", 'mobile', cs."mobile", 'email', cs."email", 'website', cs."website",
      'vatGstNumber', cs."vatGstNumber", 'taxRegistrationNumber', cs."taxRegistrationNumber",
      'corporateTaxNumber', cs."corporateTaxNumber", 'tradeLicenceNumber', cs."tradeLicenceNumber", 'dunsNumber', cs."dunsNumber"),
    'bankAccounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', b."id", 'label', b."label", 'bankName', b."bankName", 'branch', b."branch", 'accountName', b."accountName",
        'accountNumber', b."accountNumber", 'iban', b."iban", 'swiftBic', b."swiftBic", 'routingCode', b."routingCode",
        'currency', b."currency", 'bankAddress', b."bankAddress", 'paymentInstructions', b."paymentInstructions",
        'otherInfo', b."otherInfo", 'isDefault', b."isDefault") ORDER BY b."isDefault" DESC, b."sortOrder", b."createdAt")
      FROM "BankAccount" b WHERE b."isActive"), '[]'::jsonb)
  ) AS j FROM "CompanySettings" cs WHERE cs."id" = 'global-settings'
)
UPDATE "ServiceInvoice" SET "companySnapshot" = (SELECT j FROM snap) WHERE "status" <> 'DRAFT' AND "companySnapshot" IS NULL AND EXISTS (SELECT 1 FROM snap);
