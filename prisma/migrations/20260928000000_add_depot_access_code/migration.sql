-- Depot users log in with a short access code instead of email/password.
-- accessCodeHash stores a salted PBKDF2 hash (same format as passwordHash);
-- accessCodeLookupHash stores an unsalted SHA-256 digest of the normalized
-- code so the login endpoint can look the user up in O(1) without a table
-- scan, before verifying the real (salted) hash.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessCodeHash" TEXT DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessCodeLookupHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_accessCodeLookupHash_key" ON "User"("accessCodeLookupHash");
