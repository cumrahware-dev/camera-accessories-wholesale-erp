-- Reconciles schema drift: objects that exist in schema.prisma (and were created in existing databases

-- with 'prisma db push') but were never captured in a migration. Every statement is idempotent, so this

-- is a no-op on a database that already has them and fills the gaps on one that does not.

-- Additive only: no data is changed or removed.



DO $$ BEGIN
  CREATE TYPE "ServiceInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'SENT', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ServiceCategory" AS ENUM ('LOGISTICS', 'PACKAGING', 'TRANSPORTATION', 'HANDLING', 'INSTALLATION', 'DOCUMENTATION', 'SERVICE_FEE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "corporateTaxNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "dunsNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "smtpFromEmail" TEXT NOT NULL DEFAULT 'cumrahware@gmail.com',
ADD COLUMN IF NOT EXISTS "smtpFromName" TEXT NOT NULL DEFAULT 'ARIB GLOBAL ERP',
ADD COLUMN IF NOT EXISTS "smtpHost" TEXT NOT NULL DEFAULT 'smtp.gmail.com',
ADD COLUMN IF NOT EXISTS "smtpPassword" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "smtpPort" INTEGER NOT NULL DEFAULT 587,
ADD COLUMN IF NOT EXISTS "smtpUser" TEXT NOT NULL DEFAULT 'cumrahware@gmail.com',
ADD COLUMN IF NOT EXISTS "tradeLicenceNumber" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "companyName" SET DEFAULT 'ARIB GLOBAL',
ALTER COLUMN "tradingName" SET DEFAULT 'ARIB GLOBAL';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "ServiceInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerCompany" TEXT NOT NULL,
    "customerPhone" TEXT,
    "billingAddress" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paymentTerms" TEXT NOT NULL DEFAULT 'IMMEDIATE',
    "status" "ServiceInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherCharges" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "internalRemarks" TEXT,
    "pdfUrl" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
    "emailSentAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ServiceInvoiceItem" (
    "id" TEXT NOT NULL,
    "serviceInvoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ServiceCategory" NOT NULL DEFAULT 'OTHER',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceInvoiceItem_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "ServiceInvoice_invoiceNumber_key" ON "ServiceInvoice"("invoiceNumber");
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'Skipped unique index (duplicate rows exist): %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS "ServiceInvoice_customerId_idx" ON "ServiceInvoice"("customerId");

CREATE INDEX IF NOT EXISTS "ServiceInvoice_status_idx" ON "ServiceInvoice"("status");

CREATE INDEX IF NOT EXISTS "ServiceInvoice_invoiceNumber_idx" ON "ServiceInvoice"("invoiceNumber");

CREATE INDEX IF NOT EXISTS "ServiceInvoice_createdAt_idx" ON "ServiceInvoice"("createdAt");

CREATE INDEX IF NOT EXISTS "ServiceInvoice_issueDate_idx" ON "ServiceInvoice"("issueDate");

CREATE INDEX IF NOT EXISTS "ServiceInvoice_dueDate_idx" ON "ServiceInvoice"("dueDate");

CREATE INDEX IF NOT EXISTS "ServiceInvoiceItem_serviceInvoiceId_idx" ON "ServiceInvoiceItem"("serviceInvoiceId");

CREATE INDEX IF NOT EXISTS "ServiceInvoiceItem_category_idx" ON "ServiceInvoiceItem"("category");

CREATE INDEX IF NOT EXISTS "CloudDocument_title_idx" ON "CloudDocument"("title");

CREATE INDEX IF NOT EXISTS "CloudDocument_uploadedAt_idx" ON "CloudDocument"("uploadedAt");

CREATE INDEX IF NOT EXISTS "Customer_contactPerson_idx" ON "Customer"("contactPerson");

CREATE INDEX IF NOT EXISTS "Product_name_idx" ON "Product"("name");

CREATE INDEX IF NOT EXISTS "Product_status_idx" ON "Product"("status");

CREATE INDEX IF NOT EXISTS "Product_createdAt_idx" ON "Product"("createdAt");

CREATE INDEX IF NOT EXISTS "Proforma_managerId_idx" ON "Proforma"("managerId");

CREATE INDEX IF NOT EXISTS "Shipment_createdAt_idx" ON "Shipment"("createdAt");

CREATE INDEX IF NOT EXISTS "Shipment_depotId_idx" ON "Shipment"("depotId");

CREATE INDEX IF NOT EXISTS "Supplier_name_idx" ON "Supplier"("name");

CREATE INDEX IF NOT EXISTS "Supplier_email_idx" ON "Supplier"("email");

CREATE INDEX IF NOT EXISTS "Supplier_contactPerson_idx" ON "Supplier"("contactPerson");

CREATE INDEX IF NOT EXISTS "Supplier_createdAt_idx" ON "Supplier"("createdAt");

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "TaxInvoice_proformaId_key" ON "TaxInvoice"("proformaId");
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'Skipped unique index (duplicate rows exist): %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS "TaxInvoice_createdAt_idx" ON "TaxInvoice"("createdAt");

CREATE INDEX IF NOT EXISTS "TaxInvoice_fulfilmentStatus_createdAt_idx" ON "TaxInvoice"("fulfilmentStatus", "createdAt");

CREATE INDEX IF NOT EXISTS "TaxInvoice_paymentStatus_idx" ON "TaxInvoice"("paymentStatus");

CREATE INDEX IF NOT EXISTS "TaxInvoice_issueDate_idx" ON "TaxInvoice"("issueDate");

CREATE INDEX IF NOT EXISTS "TaxInvoice_dueDate_idx" ON "TaxInvoice"("dueDate");

DO $$ BEGIN
  ALTER TABLE "ServiceInvoice" ADD CONSTRAINT "ServiceInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ServiceInvoiceItem" ADD CONSTRAINT "ServiceInvoiceItem_serviceInvoiceId_fkey" FOREIGN KEY ("serviceInvoiceId") REFERENCES "ServiceInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
