-- Product currency: cost/sell/wholesale prices were always displayed in a single assumed base currency.
-- Additive and idempotent: existing products get 'USD' (their current, correct display), nothing is converted.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD';

-- Carrier master data (Settings -> Master Data -> Carrier Management).
DO $$ BEGIN
  CREATE TYPE "CarrierType" AS ENUM ('AIR_CARGO', 'COURIER', 'SEA_FREIGHT', 'ROAD_TRANSPORT', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Carrier" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "CarrierType" NOT NULL DEFAULT 'COURIER',
  "code" TEXT,
  "contactPerson" TEXT,
  "contactNumber" TEXT,
  "email" TEXT,
  "website" TEXT,
  "trackingUrlTemplate" TEXT,
  "address" TEXT,
  "remarks" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdByName" TEXT,
  "updatedById" TEXT,
  "updatedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Carrier_name_key" ON "Carrier"("name");
CREATE INDEX IF NOT EXISTS "Carrier_isActive_idx" ON "Carrier"("isActive");

-- Shipment: optional carrier reference (+ a name snapshot so a later rename never rewrites history) and remarks.
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "carrierId" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "carrierName" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "remarks" TEXT;
CREATE INDEX IF NOT EXISTS "Shipment_carrierId_idx" ON "Shipment"("carrierId");

DO $$ BEGIN
  ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
