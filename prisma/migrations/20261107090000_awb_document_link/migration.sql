-- Links a dispatched shipment to the stored AWB document record, so the ERP can serve the file itself
-- (authorised, correct content type, original file name) instead of depending on a provider URL.
-- Additive and idempotent: existing shipments keep their awbDocumentUrl and get a NULL id.
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "awbDocumentId" TEXT;
CREATE INDEX IF NOT EXISTS "Shipment_awbDocumentId_idx" ON "Shipment"("awbDocumentId");

-- The AWB / packing details of an invoice record which dispatch they were filled from, so the
-- "Shipment & Packing Details" section and the Tax Invoice always read one source of truth.
ALTER TABLE "InvoiceShipmentDetails" ADD COLUMN IF NOT EXISTS "dispatchSyncedAt" TIMESTAMP(3);

-- Remembers whether an email was asked to carry the airway bill, so a retry sends exactly the same attachments.
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "attachAwb" BOOLEAN NOT NULL DEFAULT false;
