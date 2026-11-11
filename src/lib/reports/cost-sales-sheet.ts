import 'server-only';
import { prisma } from '@/lib/prisma';
import { companyCurrency } from '@/lib/purchasing/common';

export class CostSheetError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface CostSheetRow {
  slNo: number; sku: string; description: string; qty: number;
  unitCost: number | null; costCurrency: string | null;
  supplier: string | null; depot: string | null;
  unitSell: number; discountPercent: number;
  totalCost: number | null; totalSales: number; grossProfit: number | null;
  /** OK, or what source information is missing for this row */
  issues: string[];
}
export interface CostSheet {
  invoiceId: string; invoiceNumber: string; customerName: string; invoiceDate: string | null;
  sellCurrency: string; costCurrencies: string[]; baseCurrency: string;
  rows: CostSheetRow[];
  summary: { totalQty: number; totalCost: number | null; totalSales: number; grossProfit: number | null; marginPercent: number | null; profitNote: string | null };
  notes: string[];
  complete: boolean;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/**
 * Cost & Sales Sheet of one sales invoice, built only from recorded transactions:
 *  - quantity / unit price / description: the invoice lines
 *  - unit cost + depot: the SALE_DISPATCH stock-ledger rows written when the invoice was shipped (they snapshot the
 *    ERP's moving-average cost at that moment and the depot the stock left). A line is split across several rows when
 *    the ledger holds several dispatches for it. Product master prices are never used.
 *  - supplier: the suppliers of the posted purchase invoices that received this product into stock up to the dispatch.
 *    The ERP values stock at a moving average (it keeps no per-batch cost), so when several suppliers contributed all are
 *    listed and the row says the cost is blended - one supplier is never invented.
 * Missing information is reported, never replaced by zero.
 */
export async function buildCostSheet(invoiceId: string): Promise<CostSheet> {
  const inv = await prisma.taxInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true, customerName: true, customerCompany: true, currency: true, issuedAt: true, createdAt: true, documentStatus: true, depotId: true, items: { select: { id: true, productId: true, productSku: true, productName: true, quantity: true, unitPrice: true, discountPercent: true, depotName: true }, orderBy: { id: 'asc' } } },
  });
  if (!inv) throw new CostSheetError(404, 'Invoice not found.');
  if (inv.documentStatus === 'DRAFT') throw new CostSheetError(409, 'A draft invoice has no cost sheet yet. Issue the invoice first.');
  const base = await companyCurrency();
  const sellCurrency = String(inv.currency || base).toUpperCase();

  const productIds = Array.from(new Set(inv.items.map((i) => i.productId)));
  const [dispatches, products] = await Promise.all([
    prisma.stockTransaction.findMany({ where: { type: 'SALE_DISPATCH', referenceNumber: inv.invoiceNumber, productId: { in: productIds } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, currency: true } }),
  ]);
  const currencyOf = new Map(products.map((p) => [p.id, String(p.currency || base).toUpperCase()]));
  const pool = new Map<string, { id: string; left: number; unitCost: number; depot: string | null; at: Date }[]>();
  for (const d of dispatches) {
    const a = pool.get(d.productId) || [];
    a.push({ id: d.id, left: Number(d.quantity), unitCost: d.unitCost, depot: d.sourceDepotName, at: d.createdAt });
    pool.set(d.productId, a);
  }

  // suppliers per product, from the purchase receipts (STOCK_IN) recorded before the dispatch
  const receipts = dispatches.length ? await prisma.stockTransaction.findMany({ where: { type: 'STOCK_IN', productId: { in: productIds } }, select: { productId: true, referenceNumber: true, createdAt: true } }) : [];
  const purchases = receipts.length ? await prisma.purchaseInvoice.findMany({ where: { purchaseNumber: { in: Array.from(new Set(receipts.map((x) => x.referenceNumber))) } }, select: { purchaseNumber: true, supplierName: true } }) : [];
  const supplierOf = new Map(purchases.map((p) => [p.purchaseNumber, p.supplierName]));
  const suppliersFor = (productId: string, before: Date) => {
    const set = new Set<string>();
    for (const x of receipts) if (x.productId === productId && x.createdAt <= before && supplierOf.has(x.referenceNumber)) set.add(supplierOf.get(x.referenceNumber)!);
    return Array.from(set);
  };

  const rows: CostSheetRow[] = [];
  const addRow = (it: (typeof inv.items)[number], qty: number, alloc: { unitCost: number; depot: string | null; at: Date } | null) => {
    const issues: string[] = [];
    const unitSell = it.unitPrice, disc = it.discountPercent || 0;
    const totalSales = r2(qty * unitSell * (1 - disc / 100));
    let unitCost: number | null = null, supplier: string | null = null;
    const depot = alloc?.depot ?? null;
    if (!alloc) issues.push('No dispatch cost recorded for this quantity (not shipped, or shipped without a stock record)');
    else if (!(alloc.unitCost > 0)) issues.push('Dispatch recorded a cost of 0 - the actual cost is unknown');
    else unitCost = r4(alloc.unitCost);
    if (alloc) {
      const sup = suppliersFor(it.productId, alloc.at);
      if (!sup.length) issues.push('Supplier not recorded (stock was not received through a posted purchase invoice)');
      else { supplier = sup.join('; '); if (sup.length > 1) issues.push(`Cost is a moving average across purchases from ${sup.length} suppliers`); }
      if (!depot) issues.push('Depot not recorded');
    }
    const totalCost = unitCost === null ? null : r2(qty * unitCost);
    rows.push({
      slNo: 0, sku: it.productSku, description: it.productName, qty, unitCost, costCurrency: unitCost === null ? null : currencyOf.get(it.productId) || base,
      supplier, depot, unitSell, discountPercent: disc, totalCost, totalSales, grossProfit: null, issues,
    });
  };

  for (const it of inv.items) {
    let need = Number(it.quantity);
    const list = pool.get(it.productId) || [];
    for (const a of list) {
      if (need <= 1e-9) break;
      if (a.left <= 1e-9) continue;
      const take = Math.min(need, a.left);
      a.left -= take; need -= take;
      addRow(it, take, a);
    }
    if (need > 1e-9) addRow(it, r4(need), null);
  }
  rows.forEach((r, i) => (r.slNo = i + 1));

  const costCurrencies = Array.from(new Set(rows.map((r) => r.costCurrency).filter(Boolean) as string[]));
  const allCosted = rows.length > 0 && rows.every((r) => r.totalCost !== null);
  const sameCurrency = costCurrencies.length <= 1 && (costCurrencies[0] ?? sellCurrency) === sellCurrency;
  const totalQty = r4(rows.reduce((s, r) => s + r.qty, 0));
  const totalSales = r2(rows.reduce((s, r) => s + r.totalSales, 0));
  const costKnown = r2(rows.reduce((s, r) => s + (r.totalCost ?? 0), 0));
  let profitNote: string | null = null;
  if (!allCosted) profitNote = 'Gross profit is not shown because the cost of one or more lines is missing.';
  else if (!sameCurrency) profitNote = `Cost is in ${costCurrencies.join('/')} and the invoice is in ${sellCurrency}. No verified conversion policy exists, so cost and sales are not combined and no profit is calculated.`;
  const canProfit = allCosted && sameCurrency;
  if (canProfit) for (const r of rows) r.grossProfit = r2(r.totalSales - (r.totalCost as number));
  const grossProfit = canProfit ? r2(totalSales - costKnown) : null;

  const notes: string[] = [
    'Cost is the ERP\'s moving-average unit cost at the moment the goods were dispatched (stock ledger SALE_DISPATCH record); it does not change if product prices change later.',
    'Sales are quantity x unit price less any line discount, excluding VAT, freight and invoice-level discount.',
  ];
  if (inv.documentStatus === 'CANCELLED') notes.push('This invoice is CANCELLED.');
  for (const r of rows) for (const m of r.issues) notes.push(`Row ${r.slNo} (${r.sku}): ${m}`);

  return {
    invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, customerName: inv.customerCompany || inv.customerName, invoiceDate: (inv.issuedAt || inv.createdAt)?.toISOString() ?? null,
    sellCurrency, costCurrencies, baseCurrency: base, rows,
    summary: { totalQty, totalCost: allCosted ? costKnown : null, totalSales, grossProfit, marginPercent: grossProfit !== null && totalSales > 0 ? r2((grossProfit / totalSales) * 100) : null, profitNote },
    notes, complete: allCosted && rows.every((r) => r.supplier && r.depot),
  };
}
