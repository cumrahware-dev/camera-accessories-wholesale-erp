-- Document types that belong to a shipment. The upload screen has always offered packing lists and shipping documents,
-- but the database only knew seven categories, so choosing one of them failed the upload. Additive and idempotent:
-- existing documents keep their category, nothing is rewritten (same pattern as the earlier UserRole values).
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'PACKING_LIST';
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'DELIVERY_CHALLAN';
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'COMMERCIAL_INVOICE';
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'SHIPPING_DOCUMENT';
