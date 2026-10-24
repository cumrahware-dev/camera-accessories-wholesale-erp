-- CompanySettings.logoUrl defaulted to a stock Unsplash photo (copy-pasted from Product.imageUrl's default),
-- which silently overrode the real logo wherever code does `eff.logoUrl || '/pdflogo.png'`. Empty = use the
-- bundled logo. Also repairs any row still holding that stock placeholder.
ALTER TABLE "CompanySettings" ALTER COLUMN "logoUrl" SET DEFAULT '';
UPDATE "CompanySettings" SET "logoUrl" = '' WHERE "logoUrl" = 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=200';
