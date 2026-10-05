-- Performance indexes chosen from query plans (additive; no data is touched).

-- Depot activity feed: "this depot's events, newest first". Replaces the single-column depot index (same prefix).
DROP INDEX IF EXISTS "AuditLog_depotId_idx";
CREATE INDEX IF NOT EXISTS "AuditLog_depotId_timestamp_idx" ON "AuditLog"("depotId", "timestamp");

-- Depot order queues and dashboard tiles: counts / lists by depot AND fulfilment status.
CREATE INDEX IF NOT EXISTS "TaxInvoice_depotId_fulfilmentStatus_idx" ON "TaxInvoice"("depotId", "fulfilmentStatus");
