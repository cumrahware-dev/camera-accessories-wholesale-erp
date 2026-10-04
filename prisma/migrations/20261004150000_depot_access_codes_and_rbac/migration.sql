-- Depot access codes, user status/roles and sign-in protection. Additive only: no data is changed or removed.

-- New roles / statuses (existing values and rows are untouched)
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DEPOT_MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DEPOT_STAFF';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DEPOT_SCANNER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'VIEWER';
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

CREATE TYPE "DepotStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- Depot: status, notes, who created it, and the (hashed) access code
ALTER TABLE "Depot" ADD COLUMN "status" "DepotStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Depot" ADD COLUMN "notes" TEXT;
ALTER TABLE "Depot" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Depot" ADD COLUMN "createdByName" TEXT;
ALTER TABLE "Depot" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "Depot" ADD COLUMN "accessCodeHash" TEXT;
ALTER TABLE "Depot" ADD COLUMN "accessCodeVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Depot" ADD COLUMN "accessCodeRotatedAt" TIMESTAMP(3);
ALTER TABLE "Depot" ADD COLUMN "accessCodeRevokedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Depot_accessCodeHash_key" ON "Depot"("accessCodeHash");

-- User
ALTER TABLE "User" ADD COLUMN "createdById" TEXT;
ALTER TABLE "User" ADD COLUMN "createdByName" TEXT;
ALTER TABLE "User" ADD COLUMN "isStation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "permissionRevokes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Audit log: depot, metadata, and failed sign-ins (no user) can be recorded
ALTER TABLE "AuditLog" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "AuditLog" ADD COLUMN "depotId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "depotName" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "metadata" JSONB;
CREATE INDEX "AuditLog_depotId_idx" ON "AuditLog"("depotId");

-- Brute-force protection
CREATE TABLE "AuthAttempt" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuthAttempt_scope_key_createdAt_idx" ON "AuthAttempt"("scope", "key", "createdAt");
CREATE INDEX "AuthAttempt_createdAt_idx" ON "AuthAttempt"("createdAt");
