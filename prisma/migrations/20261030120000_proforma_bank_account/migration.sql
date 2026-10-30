-- Proforma: manually selected company bank account (must match the proforma's own currency). Nullable and
-- additive: existing proformas keep working with no account selected, matching their prior "show all accounts
-- matching currency" behaviour until someone picks one for a new draft.
ALTER TABLE "Proforma" ADD COLUMN IF NOT EXISTS "bankAccountId" TEXT;
CREATE INDEX IF NOT EXISTS "Proforma_bankAccountId_idx" ON "Proforma"("bankAccountId");

DO $$ BEGIN
  ALTER TABLE "Proforma" ADD CONSTRAINT "Proforma_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
