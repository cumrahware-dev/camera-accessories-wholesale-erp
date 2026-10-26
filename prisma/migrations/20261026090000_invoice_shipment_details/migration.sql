-- Supplementary AWB / packing details for issued tax invoices (+ history), and an optional per-customer default delivery note.
-- Additive and idempotent: no existing table is rewritten, no existing row changes.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "defaultDeliveryTerms" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "InvoiceShipmentDetails" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "awbNumber" TEXT NOT NULL DEFAULT '',
  "awbReceivedDate" TIMESTAMP(3),
  "shipmentDate" TIMESTAMP(3),
  "packageCount" INTEGER,
  "packingDescription" TEXT NOT NULL DEFAULT '',
  "grossWeightKg" DECIMAL(12,3),
  "netWeightKg" DECIMAL(12,3),
  "lengthCm" DECIMAL(10,2),
  "widthCm" DECIMAL(10,2),
  "heightCm" DECIMAL(10,2),
  "remarks" TEXT NOT NULL DEFAULT '',
  "buyerResponsibleInsurance" BOOLEAN NOT NULL DEFAULT false,
  "updatedById" TEXT NOT NULL,
  "updatedByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceShipmentDetails_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceShipmentDetails_invoiceId_key" ON "InvoiceShipmentDetails"("invoiceId");
DO $$ BEGIN
  ALTER TABLE "InvoiceShipmentDetails" ADD CONSTRAINT "InvoiceShipmentDetails_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "TaxInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "InvoiceShipmentDetailsHistory" (
  "id" TEXT NOT NULL,
  "detailsId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "changes" JSONB NOT NULL,
  "changedById" TEXT NOT NULL,
  "changedByName" TEXT NOT NULL,
  "changedByRole" TEXT NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceShipmentDetailsHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InvoiceShipmentDetailsHistory_invoiceId_changedAt_idx" ON "InvoiceShipmentDetailsHistory"("invoiceId", "changedAt");
DO $$ BEGIN
  ALTER TABLE "InvoiceShipmentDetailsHistory" ADD CONSTRAINT "InvoiceShipmentDetailsHistory_detailsId_fkey" FOREIGN KEY ("detailsId") REFERENCES "InvoiceShipmentDetails"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The history is append-only, like the other audit trails.
DO $$ BEGIN
  CREATE TRIGGER "InvoiceShipmentDetailsHistory_append_only" BEFORE UPDATE OR DELETE ON "InvoiceShipmentDetailsHistory" FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION erp_append_only();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
