/** Matches OCR-extracted companies and products against real ERP records. Never creates anything. */
import 'server-only';
import { prisma } from '@/lib/prisma';

export interface Candidate { id: string; label: string; sub: string; score: number; reason: string }
export interface MatchResult { strong: boolean; candidates: Candidate[] }

import { normalizeName, tokens, firstToken, similarity } from './matching-utils';
const digits = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();

function finish(cands: Candidate[]): MatchResult {
  const sorted = cands.filter((c) => c.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 5);
  const strong = sorted.length > 0 && sorted[0].score >= 0.95 && (sorted.length === 1 || sorted[1].score < sorted[0].score);
  return { strong, candidates: sorted };
}

export async function matchCustomer(p: { name: string; email?: string; vat?: string }): Promise<MatchResult> {
  const name = p.name.trim();
  if (!name && !p.email && !p.vat) return { strong: false, candidates: [] };
  const first = firstToken(name);
  const rows = await prisma.customer.findMany({
    where: {
      OR: [
        ...(first ? [{ companyName: { contains: first, mode: 'insensitive' as const } }] : []),
        ...(p.email ? [{ email: { equals: p.email.trim(), mode: 'insensitive' as const } }] : []),
        ...(p.vat ? [{ taxNumber: { equals: p.vat.trim(), mode: 'insensitive' as const } }] : []),
      ],
    },
    take: 50,
  });
  return finish(rows.map((r) => {
    const byEmail = p.email && r.email.toLowerCase() === p.email.trim().toLowerCase();
    const byVat = p.vat && r.taxNumber && digits(r.taxNumber) === digits(p.vat) && digits(p.vat).length >= 8;
    const nameScore = Math.max(similarity(name, r.companyName), similarity(name, r.contactPerson) * 0.9);
    const score = byEmail || byVat ? 1 : nameScore;
    return { id: r.id, label: r.companyName, sub: `${r.customerCode} • ${r.email}`, score, reason: byEmail ? 'email match' : byVat ? 'VAT number match' : nameScore === 1 ? 'exact name' : 'similar name' };
  }));
}

export async function matchSupplier(p: { name: string; email?: string; vat?: string }): Promise<MatchResult> {
  const name = p.name.trim();
  if (!name && !p.email && !p.vat) return { strong: false, candidates: [] };
  const first = firstToken(name);
  const rows = await prisma.supplier.findMany({
    where: {
      OR: [
        ...(first ? [{ name: { contains: first, mode: 'insensitive' as const } }] : []),
        ...(p.email ? [{ email: { equals: p.email.trim(), mode: 'insensitive' as const } }] : []),
        ...(p.vat ? [{ taxId: { equals: p.vat.trim(), mode: 'insensitive' as const } }] : []),
      ],
    },
    take: 50,
  });
  return finish(rows.map((r) => {
    const byEmail = p.email && r.email.toLowerCase() === p.email.trim().toLowerCase();
    const byVat = p.vat && r.taxId && digits(r.taxId) === digits(p.vat) && digits(p.vat).length >= 8;
    const nameScore = similarity(name, r.name);
    const score = byEmail || byVat ? 1 : nameScore;
    return { id: r.id, label: r.name, sub: `${r.contactPerson} • ${r.email}`, score, reason: byEmail ? 'email match' : byVat ? 'VAT number match' : nameScore === 1 ? 'exact name' : 'similar name' };
  }));
}

export async function matchProducts(lines: { sku: string; description: string }[]): Promise<MatchResult[]> {
  const skus = lines.map((l) => l.sku.trim()).filter(Boolean);
  const firsts = lines.map((l) => firstToken(l.description)).filter(Boolean) as string[];
  const rows = await prisma.product.findMany({
    where: { OR: [...(skus.length ? [{ sku: { in: skus, mode: 'insensitive' as const } }] : []), ...firsts.map((t) => ({ name: { contains: t, mode: 'insensitive' as const } }))] },
    take: 300,
  });
  return lines.map((l) => {
    const sku = l.sku.trim().toLowerCase();
    return finish(rows.map((r) => {
      const bySku = sku && r.sku.toLowerCase() === sku;
      const nameScore = l.description ? similarity(l.description, r.name) : 0;
      const score = bySku ? 1 : nameScore >= 1 ? 0.97 : nameScore * 0.9;
      return { id: r.id, label: `${r.name}`, sub: `${r.sku} • ${r.brand}`, score, reason: bySku ? 'SKU match' : nameScore >= 1 ? 'exact name' : 'similar name' };
    }));
  });
}
