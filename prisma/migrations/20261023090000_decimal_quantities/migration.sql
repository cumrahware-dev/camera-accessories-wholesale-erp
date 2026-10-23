-- Decimal quantities (e.g. 54.620 Mt). SAFE FOR EXISTING DATA: every column keeps its rows; whole numbers convert exactly
-- (12 -> 12.000). No table is dropped or rewritten from scratch, no row is deleted, no quantity changes value.
-- Money columns are NOT touched. Idempotent: re-running changes nothing once the columns are NUMERIC(18,3).
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'DepotInventory' AND column_name = 'quantity') <> 'numeric' THEN
    ALTER TABLE "DepotInventory" ALTER COLUMN "quantity" TYPE NUMERIC(18,3) USING "quantity"::numeric(18,3);
  END IF;
END $$;
ALTER TABLE "DepotInventory" ALTER COLUMN "quantity" SET DEFAULT 0;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'DepotInventory' AND column_name = 'allocatedQuantity') <> 'numeric' THEN
    ALTER TABLE "DepotInventory" ALTER COLUMN "allocatedQuantity" TYPE NUMERIC(18,3) USING "allocatedQuantity"::numeric(18,3);
  END IF;
END $$;
ALTER TABLE "DepotInventory" ALTER COLUMN "allocatedQuantity" SET DEFAULT 0;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'DepotInventory' AND column_name = 'availableQuantity') <> 'numeric' THEN
    ALTER TABLE "DepotInventory" ALTER COLUMN "availableQuantity" TYPE NUMERIC(18,3) USING "availableQuantity"::numeric(18,3);
  END IF;
END $$;
ALTER TABLE "DepotInventory" ALTER COLUMN "availableQuantity" SET DEFAULT 0;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'Product' AND column_name = 'totalStock') <> 'numeric' THEN
    ALTER TABLE "Product" ALTER COLUMN "totalStock" TYPE NUMERIC(18,3) USING "totalStock"::numeric(18,3);
  END IF;
END $$;
ALTER TABLE "Product" ALTER COLUMN "totalStock" SET DEFAULT 0;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'Depot' AND column_name = 'totalStockUnits') <> 'numeric' THEN
    ALTER TABLE "Depot" ALTER COLUMN "totalStockUnits" TYPE NUMERIC(18,3) USING "totalStockUnits"::numeric(18,3);
  END IF;
END $$;
ALTER TABLE "Depot" ALTER COLUMN "totalStockUnits" SET DEFAULT 0;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'StockTransaction' AND column_name = 'quantity') <> 'numeric' THEN
    ALTER TABLE "StockTransaction" ALTER COLUMN "quantity" TYPE NUMERIC(18,3) USING "quantity"::numeric(18,3);
  END IF;
END $$;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'StockTransferItem' AND column_name = 'quantity') <> 'numeric' THEN
    ALTER TABLE "StockTransferItem" ALTER COLUMN "quantity" TYPE NUMERIC(18,3) USING "quantity"::numeric(18,3);
  END IF;
END $$;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'StockAdjustment' AND column_name = 'deltaQty') <> 'numeric' THEN
    ALTER TABLE "StockAdjustment" ALTER COLUMN "deltaQty" TYPE NUMERIC(18,3) USING "deltaQty"::numeric(18,3);
  END IF;
END $$;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'StockAdjustment' AND column_name = 'previousQty') <> 'numeric' THEN
    ALTER TABLE "StockAdjustment" ALTER COLUMN "previousQty" TYPE NUMERIC(18,3) USING "previousQty"::numeric(18,3);
  END IF;
END $$;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'StockAdjustment' AND column_name = 'newQty') <> 'numeric' THEN
    ALTER TABLE "StockAdjustment" ALTER COLUMN "newQty" TYPE NUMERIC(18,3) USING "newQty"::numeric(18,3);
  END IF;
END $$;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'ProformaItem' AND column_name = 'quantity') <> 'numeric' THEN
    ALTER TABLE "ProformaItem" ALTER COLUMN "quantity" TYPE NUMERIC(18,3) USING "quantity"::numeric(18,3);
  END IF;
END $$;
ALTER TABLE "ProformaItem" ALTER COLUMN "quantity" SET DEFAULT 1;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'InvoiceItem' AND column_name = 'quantity') <> 'numeric' THEN
    ALTER TABLE "InvoiceItem" ALTER COLUMN "quantity" TYPE NUMERIC(18,3) USING "quantity"::numeric(18,3);
  END IF;
END $$;
ALTER TABLE "InvoiceItem" ALTER COLUMN "quantity" SET DEFAULT 1;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'PurchaseInvoiceItem' AND column_name = 'quantity') <> 'numeric' THEN
    ALTER TABLE "PurchaseInvoiceItem" ALTER COLUMN "quantity" TYPE NUMERIC(18,3) USING "quantity"::numeric(18,3);
  END IF;
END $$;

-- Units of measure
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'Pcs';
ALTER TABLE "ProformaItem" ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'Pcs';
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'Pcs';
ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'Pcs';

CREATE TABLE IF NOT EXISTS "UnitOfMeasure" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "decimals" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UnitOfMeasure_code_key" ON "UnitOfMeasure"("code");

INSERT INTO "UnitOfMeasure" ("id","code","name","decimals","sortOrder","updatedAt") VALUES
  ('uom-pcs','Pcs','Pieces',0,10,CURRENT_TIMESTAMP),
  ('uom-mt','Mt','Metric tonnes',3,20,CURRENT_TIMESTAMP),
  ('uom-tonnes','Tonnes','Tonnes',3,30,CURRENT_TIMESTAMP),
  ('uom-kg','Kg','Kilograms',3,40,CURRENT_TIMESTAMP),
  ('uom-m','Meters','Meters',2,50,CURRENT_TIMESTAMP),
  ('uom-sqm','Sq.m','Square meters',2,60,CURRENT_TIMESTAMP),
  ('uom-cbm','Cu.m','Cubic meters',3,70,CURRENT_TIMESTAMP),
  ('uom-ltr','Litres','Litres',2,80,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
