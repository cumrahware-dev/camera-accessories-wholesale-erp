-- OCR document intake module
-- CreateEnum
CREATE TYPE "OcrDocumentType" AS ENUM ('SALES_INVOICE', 'TAX_INVOICE', 'QUOTATION', 'PROFORMA_INVOICE', 'PURCHASE_BILL', 'PURCHASE_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'DELIVERY_NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "OcrProcessingStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'PROCESSED', 'NEEDS_REVIEW', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "OcrConversionStatus" AS ENUM ('NOT_CONVERTED', 'CONVERTING', 'CONVERTED', 'FAILED');

-- CreateTable
CREATE TABLE "OcrDocument" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 1,
    "detectedDocumentType" "OcrDocumentType" NOT NULL DEFAULT 'OTHER',
    "documentType" "OcrDocumentType" NOT NULL DEFAULT 'OTHER',
    "typeConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "processingStatus" "OcrProcessingStatus" NOT NULL DEFAULT 'UPLOADED',
    "conversionStatus" "OcrConversionStatus" NOT NULL DEFAULT 'NOT_CONVERTED',
    "failureReason" TEXT,
    "documentNumber" TEXT NOT NULL DEFAULT '',
    "documentDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "supplierName" TEXT NOT NULL DEFAULT '',
    "customerName" TEXT NOT NULL DEFAULT '',
    "vatNumber" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT '',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freightAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherCharges" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentTerms" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "billingAddress" TEXT NOT NULL DEFAULT '',
    "shippingAddress" TEXT NOT NULL DEFAULT '',
    "reviewFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fieldConfidence" JSONB,
    "matchedCustomerId" TEXT,
    "matchedSupplierId" TEXT,
    "convertedDocumentType" TEXT,
    "convertedDocumentId" TEXT,
    "convertedDocumentNumber" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrLineItem" (
    "id" TEXT NOT NULL,
    "ocrDocumentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT '',
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lowConfidence" BOOLEAN NOT NULL DEFAULT false,
    "matchedProductId" TEXT,

    CONSTRAINT "OcrLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrRawResult" (
    "id" TEXT NOT NULL,
    "ocrDocumentId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrRawResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrDocumentEvent" (
    "id" TEXT NOT NULL,
    "ocrDocumentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrDocumentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OcrDocument_fileHash_idx" ON "OcrDocument"("fileHash");

-- CreateIndex
CREATE INDEX "OcrDocument_documentNumber_idx" ON "OcrDocument"("documentNumber");

-- CreateIndex
CREATE INDEX "OcrDocument_processingStatus_idx" ON "OcrDocument"("processingStatus");

-- CreateIndex
CREATE INDEX "OcrDocument_conversionStatus_idx" ON "OcrDocument"("conversionStatus");

-- CreateIndex
CREATE INDEX "OcrDocument_documentType_idx" ON "OcrDocument"("documentType");

-- CreateIndex
CREATE INDEX "OcrDocument_createdAt_idx" ON "OcrDocument"("createdAt");

-- CreateIndex
CREATE INDEX "OcrDocument_supplierName_idx" ON "OcrDocument"("supplierName");

-- CreateIndex
CREATE INDEX "OcrDocument_customerName_idx" ON "OcrDocument"("customerName");

-- CreateIndex
CREATE INDEX "OcrLineItem_ocrDocumentId_idx" ON "OcrLineItem"("ocrDocumentId");

-- CreateIndex
CREATE INDEX "OcrLineItem_matchedProductId_idx" ON "OcrLineItem"("matchedProductId");

-- CreateIndex
CREATE INDEX "OcrRawResult_ocrDocumentId_idx" ON "OcrRawResult"("ocrDocumentId");

-- CreateIndex
CREATE INDEX "OcrDocumentEvent_ocrDocumentId_createdAt_idx" ON "OcrDocumentEvent"("ocrDocumentId", "createdAt");

-- AddForeignKey
ALTER TABLE "OcrDocument" ADD CONSTRAINT "OcrDocument_matchedCustomerId_fkey" FOREIGN KEY ("matchedCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrDocument" ADD CONSTRAINT "OcrDocument_matchedSupplierId_fkey" FOREIGN KEY ("matchedSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrLineItem" ADD CONSTRAINT "OcrLineItem_ocrDocumentId_fkey" FOREIGN KEY ("ocrDocumentId") REFERENCES "OcrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrLineItem" ADD CONSTRAINT "OcrLineItem_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrRawResult" ADD CONSTRAINT "OcrRawResult_ocrDocumentId_fkey" FOREIGN KEY ("ocrDocumentId") REFERENCES "OcrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrDocumentEvent" ADD CONSTRAINT "OcrDocumentEvent_ocrDocumentId_fkey" FOREIGN KEY ("ocrDocumentId") REFERENCES "OcrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
