import { prisma } from '@/lib/prisma';

/**
 * Next SINV- number. It used to be count()+1, which repeats a number after a deletion and collides when two invoices are
 * created at the same moment (unique violation -> 500). A database sequence row makes every number unique; it is
 * seeded above the highest number already issued so numbering continues where it was.
 */
export async function nextServiceInvoiceNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<{ nextValue: number }[]>`
    WITH m AS (SELECT COALESCE(MAX(CAST(substring("invoiceNumber" from 6) AS INTEGER)), 0) AS v FROM "ServiceInvoice" WHERE "invoiceNumber" ~ '^SINV-[0-9]+$')
    INSERT INTO "DocumentSequence" ("key", "nextValue") SELECT 'SERVICE_INVOICE', m.v + 2 FROM m
    ON CONFLICT ("key") DO UPDATE SET "nextValue" = GREATEST("DocumentSequence"."nextValue", (SELECT v FROM m) + 1) + 1
    RETURNING "nextValue"`;
  return `SINV-${String(Number(rows[0].nextValue) - 1).padStart(6, '0')}`;
}
