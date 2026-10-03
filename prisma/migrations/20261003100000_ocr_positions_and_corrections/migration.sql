-- OCR review: line positions and reviewer corrections.
-- ADDITIVE ONLY: two nullable columns and one new table. No existing row is changed.

-- AlterTable
ALTER TABLE "OcrLineItem" ADD COLUMN IF NOT EXISTS "bbox" JSONB;
ALTER TABLE "OcrLineItem" ADD COLUMN IF NOT EXISTS "ocrIndex" INTEGER;

-- CreateTable
CREATE TABLE IF NOT EXISTS "OcrCorrection" (
    "id" TEXT NOT NULL,
    "ocrDocumentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "ocrValue" TEXT NOT NULL DEFAULT '',
    "correctedValue" TEXT NOT NULL DEFAULT '',
    "entityId" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "documentType" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OcrCorrection_ocrDocumentId_field_key" ON "OcrCorrection"("ocrDocumentId", "field");
CREATE INDEX IF NOT EXISTS "OcrCorrection_kind_ocrValue_idx" ON "OcrCorrection"("kind", "ocrValue");
CREATE INDEX IF NOT EXISTS "OcrCorrection_createdAt_idx" ON "OcrCorrection"("createdAt");
