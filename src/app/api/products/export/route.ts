import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi, depotIdFilter } from '@/lib/api-auth';
import { canViewCosts } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { fileResponse, parseFormat, type Cell } from '@/lib/exports/files';

export const dynamic = 'force-dynamic';

/**
 * Product catalogue download (XLSX or CSV) straight from the database.
 * Filters: q, brand, category (id or name), status (ACTIVE | INACTIVE | ALL), depotId.
 * Purchase cost is included only for roles allowed to see costs; depot users only see their own depot's stock.
 */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'products.read');
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const format = parseFormat(sp.get('format'));
  if (!format) return NextResponse.json({ error: 'format must be xlsx or csv.' }, { status: 400 });

  const q = sp.get('q')?.trim();
  const brand = sp.get('brand')?.trim();
  const category = sp.get('category')?.trim();
  const status = (sp.get('status') || 'ALL').toUpperCase();
  const scoped = depotIdFilter(auth.user);
  const depotFilter = scoped || sp.get('depotId')?.trim() || undefined;
  const showCost = canViewCosts(auth.user.role);

  try {
    const where: any = {};
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }, { brand: { contains: q, mode: 'insensitive' } }, { barcode: { contains: q, mode: 'insensitive' } }];
    if (brand && brand !== 'ALL') where.brand = brand;
    if (category && category !== 'ALL') where.AND = [{ OR: [{ categoryId: category }, { categoryName: category }] }];
    if (status === 'ACTIVE' || status === 'INACTIVE') where.status = status;

    const products = await prisma.product.findMany({
      where,
      orderBy: [{ brand: 'asc' }, { sku: 'asc' }],
      include: { inventories: { where: depotFilter ? { depotId: depotFilter } : undefined, include: { depot: { select: { name: true, status: true } } } } },
      take: 50_000,
    });

    const depotName = depotFilter ? (await prisma.depot.findUnique({ where: { id: depotFilter }, select: { name: true } }))?.name || '' : '';
    const head = ['SKU', 'Product Name', 'Brand', 'Model', 'Category', 'Subcategory', 'Description', 'Selling Price', 'Wholesale Price', ...(showCost ? ['Purchase Cost'] : []), 'Tax Rate %', 'Available Stock', 'Depot', 'Status'];
    // Same stock filter as the Products screen: IN_STOCK, OUT_OF_STOCK, LOW_STOCK.
    const stockFilter = (sp.get('stock') || 'ALL').toUpperCase();
    const stockOf = (p: (typeof products)[number]) => p.inventories.reduce((s, i) => s + (i.availableQuantity || 0), 0);
    const kept = products.filter((p) => {
      const st = stockOf(p);
      if (stockFilter === 'IN_STOCK') return st > 0;
      if (stockFilter === 'OUT_OF_STOCK') return st <= 0;
      if (stockFilter === 'LOW_STOCK') return st > 0 && st <= (p.minStockLevel ?? 10);
      return true;
    });
    const rows: Cell[][] = kept.map((p) => {
      const stock = p.inventories.reduce((s, i) => s + (i.availableQuantity || 0), 0);
      const depots = depotFilter ? depotName : p.inventories.filter((i) => i.quantity > 0).map((i) => `${i.depot.name} (${i.availableQuantity})`).join('; ');
      return [p.sku, p.name, p.brand, p.model || '', p.categoryName || '', p.subcategory || '', p.description || '', p.sellingPrice, p.wholesalePrice, ...(showCost ? [p.purchasePrice] : []), p.taxRate, stock, depots, p.status];
    });

    await writeAudit({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, {
      action: 'DATA_EXPORT', entityType: 'Product', entityId: 'catalogue', entityLabel: 'Product catalogue',
      description: `Product catalogue exported (${format.toUpperCase()}, ${rows.length} products${showCost ? ', with cost' : ''})`,
      metadata: { format, rows: rows.length, filters: { q, brand, category, status, depotId: depotFilter } },
    });
    return fileResponse(format, 'Product_Catalogue', [{ name: 'Product Catalogue', head, rows }]);
  } catch (e: any) {
    console.error('[products export] failed:', e?.message);
    return NextResponse.json({ error: 'The catalogue could not be exported. Please try again.' }, { status: 500 });
  }
}
