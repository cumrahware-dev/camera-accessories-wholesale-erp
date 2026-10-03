/** Matches OCR-extracted companies and products against real ERP records. Never creates anything. */
import 'server-only';
import { prisma } from '@/lib/prisma';

export interface Candidate { id: string; label: string; sub: string; score: number; reason: string }
export interface MatchResult { strong: boolean; candidates: Candidate[] }

import { normalizeName, tokens, firstToken, similarity } from './matching-utils';
const digits = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
const phoneKey = (s?: string | null) => (s || '').replace(/\D/g, '').slice(-9);

/** Key under which a reviewer's choice for a piece of OCR text is remembered (see OcrCorrection). */
export const feedbackKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
export const productFeedbackKey = (sku: string, description: string) => feedbackKey(`${sku.trim()}|${description}`);

// A remembered choice is only ever a suggestion: below the 0.95 needed to be applied automatically.
const REMEMBERED = 0.9;

function finish(cands: Candidate[]): MatchResult {
  // one entry per record, keeping the best score and every reason it matched
  const byId = new Map<string, Candidate>();
  for (const c of cands) {
    const prev = byId.get(c.id);
    if (!prev) byId.set(c.id, { ...c });
    else {
      if (prev.reason.includes(c.reason)) { if (c.score > prev.score) prev.score = c.score; continue; }
      // strongest reason first
      if (c.score > prev.score) Object.assign(prev, { score: c.score, reason: `${c.reason}, ${prev.reason}` });
      else prev.reason = `${prev.reason}, ${c.reason}`;
    }
  }
  const sorted = Array.from(byId.values()).filter((c) => c.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 5);
  const strong = sorted.length > 0 && sorted[0].score >= 0.95 && (sorted.length === 1 || sorted[1].score < sorted[0].score);
  return { strong, candidates: sorted };
}

/** Records a reviewer previously chose for exactly this OCR text. */
async function remembered(kind: 'CUSTOMER' | 'SUPPLIER' | 'PRODUCT', keys: string[]): Promise<Map<string, string[]>> {
  const ks = Array.from(new Set(keys.filter(Boolean)));
  const out = new Map<string, string[]>();
  if (!ks.length) return out;
  const rows = await prisma.ocrCorrection.findMany({
    where: { kind, ocrValue: { in: ks }, entityId: { not: null } },
    orderBy: { updatedAt: 'desc' }, take: 200, select: { ocrValue: true, entityId: true },
  }).catch(() => []);
  for (const r of rows) {
    const list = out.get(r.ocrValue) ?? [];
    if (r.entityId && !list.includes(r.entityId)) list.push(r.entityId);
    out.set(r.ocrValue, list);
  }
  return out;
}

async function idsByPhone(table: 'Customer' | 'Supplier', phone?: string): Promise<string[]> {
  const k = phoneKey(phone);
  if (k.length < 7) return [];
  const rows = table === 'Customer'
    ? await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Customer" WHERE right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = ${k} LIMIT 20`
    : await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Supplier" WHERE right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = ${k} LIMIT 20`;
  return rows.map((r) => r.id);
}

export async function matchCustomer(p: { name: string; email?: string; vat?: string; phone?: string; address?: string }): Promise<MatchResult> {
  const name = p.name.trim();
  if (!name && !p.email && !p.vat && !p.phone) return { strong: false, candidates: [] };
  const first = firstToken(name);
  const [phoneIds, prev] = await Promise.all([idsByPhone('Customer', p.phone), remembered('CUSTOMER', [feedbackKey(name)])]);
  const prevIds = prev.get(feedbackKey(name)) ?? [];
  const rows = await prisma.customer.findMany({
    where: {
      OR: [
        ...(first ? [{ companyName: { contains: first, mode: 'insensitive' as const } }] : []),
        ...(p.email ? [{ email: { equals: p.email.trim(), mode: 'insensitive' as const } }] : []),
        ...(p.vat ? [{ taxNumber: { equals: p.vat.trim(), mode: 'insensitive' as const } }] : []),
        ...(phoneIds.length || prevIds.length ? [{ id: { in: [...phoneIds, ...prevIds] } }] : []),
      ],
    },
    take: 50,
  });
  const cands: Candidate[] = [];
  for (const r of rows) {
    const byEmail = !!p.email && r.email.toLowerCase() === p.email.trim().toLowerCase();
    const byVat = !!p.vat && !!r.taxNumber && digits(r.taxNumber) === digits(p.vat) && digits(p.vat).length >= 8;
    const byPhone = phoneIds.includes(r.id);
    const nameScore = Math.max(similarity(name, r.companyName), similarity(name, r.contactPerson) * 0.9);
    const addrScore = p.address && r.billingAddress ? similarity(p.address, r.billingAddress) : 0;
    const sub = `${r.customerCode} • ${r.email}`;
    const add = (score: number, reason: string) => cands.push({ id: r.id, label: r.companyName, sub, score, reason });
    if (byEmail) add(1, 'email match');
    if (byVat) add(1, 'VAT number match');
    // Phone or address alone can be shared (group companies, a building): they support a name, never replace it.
    if (byPhone) add(nameScore >= 0.6 ? 0.97 : 0.85, 'phone match');
    if (addrScore >= 0.6 && nameScore >= 0.6) add(Math.min(0.97, nameScore + 0.15), 'address match');
    if (prevIds.includes(r.id)) add(REMEMBERED, 'previously confirmed');
    if (nameScore >= 0.5) add(nameScore, nameScore === 1 ? 'exact name' : 'similar name');
  }
  return finish(cands);
}

export async function matchSupplier(p: { name: string; email?: string; vat?: string; phone?: string; address?: string }): Promise<MatchResult> {
  const name = p.name.trim();
  if (!name && !p.email && !p.vat && !p.phone) return { strong: false, candidates: [] };
  const first = firstToken(name);
  const [phoneIds, prev] = await Promise.all([idsByPhone('Supplier', p.phone), remembered('SUPPLIER', [feedbackKey(name)])]);
  const prevIds = prev.get(feedbackKey(name)) ?? [];
  const rows = await prisma.supplier.findMany({
    where: {
      OR: [
        ...(first ? [{ name: { contains: first, mode: 'insensitive' as const } }] : []),
        ...(p.email ? [{ email: { equals: p.email.trim(), mode: 'insensitive' as const } }] : []),
        ...(p.vat ? [{ taxId: { equals: p.vat.trim(), mode: 'insensitive' as const } }] : []),
        ...(phoneIds.length || prevIds.length ? [{ id: { in: [...phoneIds, ...prevIds] } }] : []),
      ],
    },
    take: 50,
  });
  const cands: Candidate[] = [];
  for (const r of rows) {
    const byEmail = !!p.email && r.email.toLowerCase() === p.email.trim().toLowerCase();
    const byVat = !!p.vat && !!r.taxId && digits(r.taxId) === digits(p.vat) && digits(p.vat).length >= 8;
    const byPhone = phoneIds.includes(r.id);
    const nameScore = similarity(name, r.name);
    const addrScore = p.address && r.address ? similarity(p.address, r.address) : 0;
    const sub = `${r.contactPerson} • ${r.email}`;
    const add = (score: number, reason: string) => cands.push({ id: r.id, label: r.name, sub, score, reason });
    if (byEmail) add(1, 'email match');
    if (byVat) add(1, 'VAT number match');
    if (byPhone) add(nameScore >= 0.6 ? 0.97 : 0.85, 'phone match');
    if (addrScore >= 0.6 && nameScore >= 0.6) add(Math.min(0.97, nameScore + 0.15), 'address match');
    if (prevIds.includes(r.id)) add(REMEMBERED, 'previously confirmed');
    if (nameScore >= 0.5) add(nameScore, nameScore === 1 ? 'exact name' : 'similar name');
  }
  return finish(cands);
}

export async function matchProducts(lines: { sku: string; description: string }[]): Promise<MatchResult[]> {
  const skus = lines.map((l) => l.sku.trim()).filter(Boolean);
  const firsts = lines.map((l) => firstToken(l.description)).filter(Boolean) as string[];
  const keys = lines.map((l) => productFeedbackKey(l.sku, l.description));
  const prev = await remembered('PRODUCT', keys);
  const prevIds = Array.from(new Set(Array.from(prev.values()).flat()));
  const rows = await prisma.product.findMany({
    where: {
      OR: [
        ...(skus.length ? [{ sku: { in: skus, mode: 'insensitive' as const } }] : []),
        ...firsts.map((t) => ({ name: { contains: t, mode: 'insensitive' as const } })),
        ...(prevIds.length ? [{ id: { in: prevIds } }] : []),
      ],
    },
    take: 300,
  });
  return lines.map((l, i) => {
    const sku = l.sku.trim().toLowerCase();
    const mine = prev.get(keys[i]) ?? [];
    const cands: Candidate[] = [];
    for (const r of rows) {
      const bySku = !!sku && r.sku.toLowerCase() === sku;
      const nameScore = l.description ? similarity(l.description, r.name) : 0;
      const sub = `${r.sku} • ${r.brand}`;
      if (mine.includes(r.id)) cands.push({ id: r.id, label: r.name, sub, score: REMEMBERED, reason: 'previously confirmed' });
      cands.push({ id: r.id, label: r.name, sub, score: bySku ? 1 : nameScore >= 1 ? 0.97 : nameScore * 0.9, reason: bySku ? 'SKU match' : nameScore >= 1 ? 'exact name' : 'similar name' });
    }
    return finish(cands);
  });
}
