import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi, depotIdFilter } from '@/lib/api-auth';
import { canViewCosts } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { fileResponse, parseFormat, type Cell } from '@/lib/exports/files';

export const dynamic = 'force-dynamic';

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Inventory report download (XLSX or CSV) from the real stock records: one row per product per depot.
 * Filters (same as the on-screen report): depotId, brand, category (id or name), q, status (in | low | out),
 * valuedOnly=1 (leave out rows whose stock value is 0). Cost and value columns only for roles allowed to see costs;
 * depot users only get their own depot.
 */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.read');
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const format = parseFormat(sp.get('format'));
  if (!format) return NextResponse.json({ error: 'format must be xlsx or csv.' }, { status: 400 });

  const q = sp.get('q')?.trim();
  const brand = sp.get('brand')?.trim();
  const category = sp.get('category')?.trim();
  const status = (sp.get('status') || 'ALL').toLowerCase();
  const valuedOnly = sp.get('valuedOnly') === '1' || sp.get('valuedOnly') === 'true';
  const scoped = depotIdFilter(auth.user);
  const depotId = scoped || (sp.get('depotId') && sp.get('depotId') !== 'ALL' ? sp.get('depotId')! : undefined);
  const showCost = canViewCosts(auth.user.role);

  try {
    const product: any = {};
    if (q) product.OR = [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }, { brand: { contains: q, mode: 'insensitive' } }];
    if (brand && brand !== 'ALL') product.brand = brand;
    if (category && category !== 'ALL') product.AND = [{ OR: [{ categoryId: category }, { categoryName: category }] }];

    const inv = await prisma.depotInventory.findMany({
      where: { ...(depotId ? { depotId } : {}), ...(Object.keys(product).length ? { product } : {}) },
      include: { product: true, depot: { select: { name: true } } },
      take: 100_000,
    });

    const statusOf = (quantity: number, available: number, min: number) => (quantity <= 0 ? 'Out of stock' : available <= min ? 'Low stock' : 'In stock');
    type Row = { sku: string; name: string; brand: string; category: string; depot: string; avail: number; reserved: number; total: number; cost: number; value: number; st: string };
    let list: Row[] = inv.map((i) => ({
      sku: i.product.sku, name: i.product.name, brand: i.product.brand, category: i.product.categoryName || '', depot: i.depot.name,
      avail: i.availableQuantity, reserved: i.allocatedQuantity, total: i.quantity, cost: i.product.purchasePrice, value: r2(i.quantity * i.product.purchasePrice),
      st: statusOf(i.quantity, i.availableQuantity, i.minStockLevel),
    }));
    if (status === 'low') list = list.filter((r) => r.st === 'Low stock');
    else if (status === 'out') list = list.filter((r) => r.st === 'Out of stock');
    else if (status === 'in') list = list.filter((r) => r.st === 'In stock');
    // Same rule as the on-screen report: rows whose stock value is 0 (no stock, or no cost) can be left out.
    if (valuedOnly) list = list.filter((r) => r.value !== 0);
    list.sort((a, b) => a.brand.localeCompare(b.brand) || a.sku.localeCompare(b.sku) || a.depot.localeCompare(b.depot));

    const head = ['SKU', 'Product', 'Brand', 'Category', 'Depot', 'Available Quantity', 'Reserved / Blocked Quantity', 'Total Quantity', ...(showCost ? ['Unit Cost', 'Inventory Value'] : []), 'Stock Status'];
    const rows: Cell[][] = list.map((r) => [r.sku, r.name, r.brand, r.category, r.depot, r.avail, r.reserved, r.total, ...(showCost ? [r.cost, r.value] : []), r.st]);
    const sum = (f: (r: Row) => number) => list.reduce((s, r) => s + f(r), 0);
    const foot: Cell[] = ['Sum total', '', '', '', '', sum((r) => r.avail), sum((r) => r.reserved), sum((r) => r.total), ...(showCost ? ['', r2(sum((r) => r.value))] : []), ''];

    const depotLabel = depotId ? inv[0]?.depot.name || (await prisma.depot.findUnique({ where: { id: depotId }, select: { name: true } }))?.name || depotId : 'All depots';
    const filters = [`Depot: ${depotLabel}`, `Brand: ${brand && brand !== 'ALL' ? brand : 'All'}`, `Category: ${category && category !== 'ALL' ? category : 'All'}`, `Stock status: ${status === 'all' ? 'All' : status}`, ...(q ? [`Search: ${q}`] : []), ...(valuedOnly ? ['Rows with a stock value of 0 are not listed'] : [])];
    const note = [`Inventory report - generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, filters.join(' | '), ...(showCost ? ['Unit cost = the product\'s current purchase cost (weighted average once purchases are posted). Inventory value = total quantity x unit cost.'] : [])];

    // Per-depot summary sheet (XLSX only)
    const byDepot = new Map<string, { units: number; avail: number; reserved: number; value: number; skus: Set<string> }>();
    for (const r of list) {
      const d = byDepot.get(r.depot) || { units: 0, avail: 0, reserved: 0, value: 0, skus: new Set<string>() };
      d.units += r.total; d.avail += r.avail; d.reserved += r.reserved; d.value += r.value; d.skus.add(r.sku);
      byDepot.set(r.depot, d);
    }
    const sumHead = ['Depot', 'SKUs', 'Total Quantity', 'Available Quantity', 'Reserved / Blocked Quantity', ...(showCost ? ['Inventory Value'] : [])];
    const sumRows: Cell[][] = Array.from(byDepot.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([n, d]) => [n, d.skus.size, d.units, d.avail, d.reserved, ...(showCost ? [r2(d.value)] : [])]);

    await writeAudit({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, {
      action: 'DATA_EXPORT', entityType: 'Inventory', entityId: 'report', entityLabel: 'Inventory report',
      description: `Inventory report exported (${format.toUpperCase()}, ${rows.length} rows${showCost ? ', with cost' : ''})`,
      metadata: { format, rows: rows.length, filters: { q, brand, category, status, depotId, valuedOnly } },
    });
    return fileResponse(format, 'Inventory_Report', [
      { name: 'Inventory', head, rows, foot, note },
      { name: 'Summary by depot', head: sumHead, rows: sumRows, note: filters },
    ]);
  } catch (e: any) {
    console.error('[inventory export] failed:', e?.message);
    return NextResponse.json({ error: 'The inventory report could not be exported. Please try again.' }, { status: 500 });
  }
}
