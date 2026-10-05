/**
 * Company profile used on every customer document, read from the database (Settings -> Company & Business Details).
 *
 * A document that has been ISSUED carries a snapshot of the company and bank details as they were at that moment
 * (companySnapshot), so editing Settings later never rewrites history. Drafts always use the live settings.
 */
import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCompanySettingsCached } from '@/lib/settings-cache';

type Db = Prisma.TransactionClient | typeof prisma;

export interface CompanyView {
  companyName: string; tradingName: string; logoUrl: string; companyAddress: string;
  phone: string; mobile: string; email: string; website: string;
  vatGstNumber: string; taxRegistrationNumber: string; corporateTaxNumber: string; tradeLicenceNumber: string; dunsNumber: string;
}
export interface BankView {
  id: string; label: string; bankName: string; branch: string; accountName: string; accountNumber: string; iban: string; swiftBic: string;
  routingCode: string; currency: string; bankAddress: string; paymentInstructions: string; otherInfo: string; isDefault: boolean;
}
export interface CompanyProfile { company: CompanyView; bankAccounts: BankView[]; capturedAt?: string; fromSnapshot: boolean }

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function companyView(s: any): CompanyView {
  return {
    companyName: str(s?.companyName), tradingName: str(s?.tradingName), logoUrl: str(s?.logoUrl), companyAddress: str(s?.companyAddress),
    phone: str(s?.phone), mobile: str(s?.mobile), email: str(s?.email), website: str(s?.website),
    vatGstNumber: str(s?.vatGstNumber), taxRegistrationNumber: str(s?.taxRegistrationNumber), corporateTaxNumber: str(s?.corporateTaxNumber),
    tradeLicenceNumber: str(s?.tradeLicenceNumber), dunsNumber: str(s?.dunsNumber),
  };
}
export const bankView = (b: any): BankView => ({
  id: b.id, label: str(b.label), bankName: str(b.bankName), branch: str(b.branch), accountName: str(b.accountName), accountNumber: str(b.accountNumber),
  iban: str(b.iban), swiftBic: str(b.swiftBic), routingCode: str(b.routingCode), currency: str(b.currency), bankAddress: str(b.bankAddress),
  paymentInstructions: str(b.paymentInstructions), otherInfo: str(b.otherInfo), isDefault: !!b.isDefault,
});

export async function activeBankAccounts(db: Db = prisma): Promise<BankView[]> {
  const rows = await db.bankAccount.findMany({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] }).catch(() => []);
  return rows.map(bankView);
}

/** Current company details and the ACTIVE bank accounts (display; settings may be up to a minute old on another instance). */
export async function liveProfile(): Promise<CompanyProfile> {
  const [s, banks] = await Promise.all([getCompanySettingsCached(), activeBankAccounts()]);
  return { company: companyView(s), bankAccounts: banks, fromSnapshot: false };
}

/** The profile a document must print: its frozen snapshot if it has been issued, otherwise the live settings. */
export function profileFor(doc: { companySnapshot?: unknown } | null | undefined, live: CompanyProfile): CompanyProfile {
  const snap = doc?.companySnapshot as any;
  if (snap && typeof snap === 'object' && snap.company) {
    return { company: { ...companyView({}), ...companyView(snap.company) }, bankAccounts: Array.isArray(snap.bankAccounts) ? snap.bankAccounts.map(bankView) : [], capturedAt: snap.capturedAt, fromSnapshot: true };
  }
  return live;
}

/** Which bank accounts a document of this currency prints: those in that currency, else the default account. Never inactive ones. */
export function banksForDocument(accounts: BankView[], currency?: string | null): BankView[] {
  if (!accounts.length) return [];
  const c = (currency || '').toUpperCase();
  const match = c ? accounts.filter((a) => a.currency.toUpperCase() === c) : [];
  if (match.length) return match;
  const def = accounts.find((a) => a.isDefault) || accounts[0];
  // accounts with no currency set are usable for any currency
  const generic = accounts.filter((a) => !a.currency);
  return generic.length ? generic : [def];
}

/** Snapshot taken from the database (authoritative, never the cache) at the moment a document is issued. */
export async function buildSnapshot(db: Db = prisma): Promise<Prisma.InputJsonValue> {
  const [s, banks] = await Promise.all([db.companySettings.findUnique({ where: { id: 'global-settings' } }), activeBankAccounts(db)]);
  return { capturedAt: new Date().toISOString(), company: companyView(s), bankAccounts: banks } as unknown as Prisma.InputJsonValue;
}

type SnapModel = 'proforma' | 'taxInvoice' | 'serviceInvoice';
/** Freezes company/bank details on a document the first time it is issued. Later calls leave the existing snapshot alone. */
export async function stampSnapshot(db: Db, model: SnapModel, id: string): Promise<void> {
  const delegate: any = (db as any)[model];
  const cur = await delegate.findUnique({ where: { id }, select: { companySnapshot: true } });
  if (!cur || cur.companySnapshot) return;
  await delegate.update({ where: { id }, data: { companySnapshot: await buildSnapshot(db) } });
}

export interface AddressParts { office?: string; building?: string; street?: string; area?: string; poBox?: string; city?: string; country?: string }
/** The printed address, one line per row, from its parts. */
export function composeAddress(p: AddressParts): string {
  const t = (v?: string) => (v || '').trim();
  const lines = [
    ...t(p.office).split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    t(p.building),
    [t(p.street), t(p.area)].filter(Boolean).join(' '),
    t(p.poBox) ? (/^p\.?\s*o\.?\s*box/i.test(t(p.poBox)) ? t(p.poBox) : `P. O. Box ${t(p.poBox)}`) : '',
    [t(p.city), t(p.country)].filter(Boolean).join(' - '),
  ];
  return lines.filter(Boolean).join('\n');
}

/** Number of ISSUED documents whose frozen details include this bank account. */
export async function bankAccountUsage(id: string): Promise<number> {
  const like = `%"id": "${id.replace(/[%_\\"]/g, '')}"%`;
  const [a, b, c] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "TaxInvoice" WHERE "companySnapshot"::text LIKE ${like}`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Proforma" WHERE "companySnapshot"::text LIKE ${like}`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "ServiceInvoice" WHERE "companySnapshot"::text LIKE ${like}`,
  ]);
  return Number(a[0]?.n ?? 0) + Number(b[0]?.n ?? 0) + Number(c[0]?.n ?? 0);
}

/** What a screen needs to print this document: its company block and the bank accounts that belong on it. */
export async function companyProfileFor(doc: any): Promise<{ company: CompanyView; bankAccounts: BankView[]; fromSnapshot: boolean; capturedAt?: string }> {
  const p = profileFor(doc, await liveProfile());
  return { company: p.company, bankAccounts: banksForDocument(p.bankAccounts, doc?.currency), fromSnapshot: p.fromSnapshot, capturedAt: p.capturedAt };
}

/** The document without its raw snapshot, plus the profile to print it with. */
export async function withCompanyProfile<T extends Record<string, any>>(doc: T): Promise<Omit<T, 'companySnapshot'> & { companyProfile: Awaited<ReturnType<typeof companyProfileFor>> }> {
  const { companySnapshot: _s, ...rest } = doc as any;
  return { ...rest, companyProfile: await companyProfileFor(doc) };
}
