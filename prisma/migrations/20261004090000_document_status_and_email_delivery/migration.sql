-- Tax invoice commercial status (Draft / Issued / Sent / Cancelled). Existing rows are issued invoices.
CREATE TYPE "InvoiceDocumentStatus" AS ENUM ('DRAFT', 'ISSUED', 'SENT', 'CANCELLED');
ALTER TABLE "TaxInvoice" ADD COLUMN "documentStatus" "InvoiceDocumentStatus" NOT NULL DEFAULT 'ISSUED';
ALTER TABLE "TaxInvoice" ADD COLUMN "issuedAt" TIMESTAMP(3);
ALTER TABLE "TaxInvoice" ADD COLUMN "lastEmailedAt" TIMESTAMP(3);
UPDATE "TaxInvoice" SET "issuedAt" = "issueDate" WHERE "issuedAt" IS NULL;
UPDATE "TaxInvoice" SET "documentStatus" = 'CANCELLED' WHERE "fulfilmentStatus" = 'CANCELLED';

ALTER TABLE "Proforma" ADD COLUMN "lastEmailedAt" TIMESTAMP(3);

-- Customer document email delivery log
ALTER TABLE "EmailLog" ADD COLUMN "documentType" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN "ccEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "EmailLog" ADD COLUMN "bccEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "EmailLog" ADD COLUMN "bodyText" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN "attachmentName" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN "sentById" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN "sentByName" TEXT;

CREATE TABLE "EmailTemplate" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("key")
);
