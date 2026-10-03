-- Supplier Price Support, Purchase Invoices and a minimal general ledger.
-- ADDITIVE ONLY: creates new types/tables/indexes/triggers and seeds accounting heads. No existing table or row is altered.

-- CreateEnum
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "PriceSupportStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "AccountingHead" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usage" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingHead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "narration" TEXT NOT NULL,
    "totalDebit" DOUBLE PRECISION NOT NULL,
    "totalCredit" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountingHeadId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "supplierId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "purchaseNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierInvoiceNumber" TEXT NOT NULL,
    "supplierInvoiceKey" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "depotId" TEXT NOT NULL,
    "depotName" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "postedById" TEXT,
    "postedByName" TEXT,
    "postedAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoiceItem" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productSku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPriceSupport" (
    "id" TEXT NOT NULL,
    "supportNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supportReference" TEXT NOT NULL,
    "supportReferenceKey" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "originalInvoiceNumber" TEXT NOT NULL,
    "purchaseNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "supportDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reason" TEXT NOT NULL,
    "accountingHeadId" TEXT NOT NULL,
    "settlementHeadId" TEXT NOT NULL,
    "attachmentName" TEXT,
    "attachmentType" TEXT,
    "attachmentProvider" TEXT,
    "attachmentKey" TEXT,
    "status" "PriceSupportStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedByName" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "postedById" TEXT,
    "postedByName" TEXT,
    "postedAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPriceSupport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPriceSupportEvent" (
    "id" TEXT NOT NULL,
    "supportId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPriceSupportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountingHead_code_key" ON "AccountingHead"("code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_entryNumber_key" ON "JournalEntry"("entryNumber");

-- CreateIndex
CREATE INDEX "JournalEntry_entryDate_idx" ON "JournalEntry"("entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_sourceType_sourceId_key" ON "JournalEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalLine_journalEntryId_idx" ON "JournalLine"("journalEntryId");

-- CreateIndex
CREATE INDEX "JournalLine_accountingHeadId_idx" ON "JournalLine"("accountingHeadId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_purchaseNumber_key" ON "PurchaseInvoice"("purchaseNumber");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_status_idx" ON "PurchaseInvoice"("status");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_invoiceDate_idx" ON "PurchaseInvoice"("invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_supplierId_supplierInvoiceKey_key" ON "PurchaseInvoice"("supplierId", "supplierInvoiceKey");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceItem_purchaseInvoiceId_idx" ON "PurchaseInvoiceItem"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceItem_productId_idx" ON "PurchaseInvoiceItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPriceSupport_supportNumber_key" ON "SupplierPriceSupport"("supportNumber");

-- CreateIndex
CREATE INDEX "SupplierPriceSupport_purchaseInvoiceId_idx" ON "SupplierPriceSupport"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "SupplierPriceSupport_status_idx" ON "SupplierPriceSupport"("status");

-- CreateIndex
CREATE INDEX "SupplierPriceSupport_supportDate_idx" ON "SupplierPriceSupport"("supportDate");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPriceSupport_supplierId_supportReferenceKey_key" ON "SupplierPriceSupport"("supplierId", "supportReferenceKey");

-- CreateIndex
CREATE INDEX "SupplierPriceSupportEvent_supportId_idx" ON "SupplierPriceSupportEvent"("supportId");

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountingHeadId_fkey" FOREIGN KEY ("accountingHeadId") REFERENCES "AccountingHead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceSupport" ADD CONSTRAINT "SupplierPriceSupport_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceSupport" ADD CONSTRAINT "SupplierPriceSupport_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceSupport" ADD CONSTRAINT "SupplierPriceSupport_accountingHeadId_fkey" FOREIGN KEY ("accountingHeadId") REFERENCES "AccountingHead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceSupport" ADD CONSTRAINT "SupplierPriceSupport_settlementHeadId_fkey" FOREIGN KEY ("settlementHeadId") REFERENCES "AccountingHead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceSupportEvent" ADD CONSTRAINT "SupplierPriceSupportEvent_supportId_fkey" FOREIGN KEY ("supportId") REFERENCES "SupplierPriceSupport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Immutability guards (defence in depth; the API enforces the same rules) ──────────────────────────
CREATE OR REPLACE FUNCTION erp_block_posted_purchase_invoice() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'Purchase invoice % is posted and immutable', OLD."purchaseNumber" USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "PurchaseInvoice_immutable_after_post"
  BEFORE UPDATE OR DELETE ON "PurchaseInvoice"
  FOR EACH ROW EXECUTE FUNCTION erp_block_posted_purchase_invoice();

CREATE OR REPLACE FUNCTION erp_block_posted_purchase_items() RETURNS trigger AS $$
DECLARE parent_status TEXT;
BEGIN
  SELECT "status"::text INTO parent_status FROM "PurchaseInvoice"
   WHERE "id" = COALESCE(NEW."purchaseInvoiceId", OLD."purchaseInvoiceId");
  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'Items of a posted purchase invoice are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "PurchaseInvoiceItem_immutable_after_post"
  BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseInvoiceItem"
  FOR EACH ROW EXECUTE FUNCTION erp_block_posted_purchase_items();

CREATE OR REPLACE FUNCTION erp_block_posted_price_support() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'Supplier price support % is posted and immutable', OLD."supportNumber" USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' AND OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only draft price support entries can be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplierPriceSupport_immutable_after_post"
  BEFORE UPDATE OR DELETE ON "SupplierPriceSupport"
  FOR EACH ROW EXECUTE FUNCTION erp_block_posted_price_support();

-- Ledger and status history are append-only.
CREATE OR REPLACE FUNCTION erp_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalEntry_append_only" BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION erp_append_only();
CREATE TRIGGER "JournalLine_append_only" BEFORE UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION erp_append_only();
CREATE TRIGGER "SupplierPriceSupportEvent_append_only" BEFORE UPDATE OR DELETE ON "SupplierPriceSupportEvent" FOR EACH ROW EXECUTE FUNCTION erp_append_only();

-- Amount sanity at the database level.
ALTER TABLE "SupplierPriceSupport" ADD CONSTRAINT "SupplierPriceSupport_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_qty_positive" CHECK ("quantity" > 0 AND "unitCost" >= 0);
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_one_side" CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" = 0 OR "credit" = 0));

-- ── Default chart of accounts used by purchasing and price support (editable later; never deleted) ──
INSERT INTO "AccountingHead" ("id","code","name","type","description","isSystem","isActive","usage") VALUES
  ('acc-1300','1300','Inventory','ASSET','Stock on hand at purchase cost',true,true,'INVENTORY'),
  ('acc-1410','1410','Input VAT Recoverable','ASSET','Tax paid on supplier invoices',true,true,'INPUT_TAX'),
  ('acc-1250','1250','Supplier Claims Receivable','ASSET','Amounts suppliers owe us (e.g. support on paid invoices)',true,true,'PRICE_SUPPORT_SETTLEMENT'),
  ('acc-2100','2100','Accounts Payable - Suppliers','LIABILITY','Amounts owed to suppliers',true,true,'ACCOUNTS_PAYABLE,PRICE_SUPPORT_SETTLEMENT'),
  ('acc-4510','4510','Supplier Price Support Received','INCOME','Post-purchase price support / rebates from suppliers',true,true,'PRICE_SUPPORT_CREDIT'),
  ('acc-5120','5120','Purchase Discounts & Rebates Received','EXPENSE','Contra purchase-cost account for supplier rebates',true,true,'PRICE_SUPPORT_CREDIT')
ON CONFLICT ("id") DO NOTHING;
