import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { guardApi, depotIdFilter } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const num = (v: unknown) => Number(v ?? 0);

/**
 * Profitability figures, computed in the database.
 * Previously every invoice with all its items and every product was loaded into Node (over a megabyte per call).
 * Now: a handful of SQL aggregates, and only products that actually sold are listed (ranked by revenue, top `limit`),
 * with exact totals over ALL of them in `profitabilitySummary` so the page's headline numbers are unaffected.
 *
 * GET ?limit=500 (max 2000)
 */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'dashboard.view');
  if (!auth.ok) return auth.response;

  try {
    const depotId = depotIdFilter(auth.user);
    const limit = Math.min(2000, Math.max(10, Number(req.nextUrl.searchParams.get('limit')) || 500));
    const scope = depotId
      ? Prisma.sql`i."fulfilmentStatus" <> 'CANCELLED' AND i."documentStatus" <> 'DRAFT' AND i."depotId" = ${depotId}`
      : Prisma.sql`i."fulfilmentStatus" <> 'CANCELLED' AND i."documentStatus" <> 'DRAFT'`;

    const [totals, service, units, productCount, sold] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT COALESCE(SUM(i."grandTotal"), 0) AS revenue,
               COALESCE(SUM((SELECT SUM(it.quantity * COALESCE(p."purchasePrice", 0)) FROM "InvoiceItem" it JOIN "Product" p ON p.id = it."productId" WHERE it."invoiceId" = i.id)), 0) AS cost
          FROM "TaxInvoice" i WHERE ${scope}`,
      prisma.$queryRaw<any[]>`SELECT COALESCE(SUM("grandTotal"), 0) AS revenue FROM "ServiceInvoice" WHERE status <> 'CANCELLED'`,
      prisma.depotInventory.aggregate({ where: depotId ? { depotId } : undefined, _sum: { quantity: true } }),
      prisma.product.count(),
      prisma.$queryRaw<any[]>`
        SELECT g.*, SUM(g.revenue) OVER () AS "allRevenue", SUM(g.cost) OVER () AS "allCost", COUNT(*) OVER ()::int AS "soldCount"
          FROM (
            SELECT p.id AS "productId", p.name, p.sku, p.brand, p."categoryName", p."purchasePrice", p."sellingPrice",
                   SUM(it.quantity)::int AS units, SUM(it.quantity * it."unitPrice") AS revenue, SUM(it.quantity) * COALESCE(p."purchasePrice", 0) AS cost
              FROM "InvoiceItem" it JOIN "TaxInvoice" i ON i.id = it."invoiceId" JOIN "Product" p ON p.id = it."productId"
             WHERE ${scope} GROUP BY p.id
          ) g
         ORDER BY g.revenue DESC LIMIT ${limit}`,
    ]);

    const productRevenue = num(totals[0]?.revenue);
    const serviceRevenue = num(service[0]?.revenue);
    const cost = num(totals[0]?.cost);

    const profitability = sold.map((r) => {
      const totalRevenue = num(r.revenue), totalCost = num(r.cost), grossProfit = totalRevenue - totalCost, unitsSold = num(r.units);
      return {
        productId: r.productId,
        productName: r.name,
        sku: r.sku,
        brand: r.brand,
        categoryName: r.categoryName || 'General',
        unitsSold,
        totalRevenue,
        totalCost,
        grossProfit,
        grossMarginPercent: totalRevenue ? Number(((grossProfit / totalRevenue) * 100).toFixed(1)) : 0,
        averageSellingPrice: unitsSold ? totalRevenue / unitsSold : num(r.sellingPrice),
        averagePurchasePrice: num(r.purchasePrice),
      };
    });

    const allRevenue = num(sold[0]?.allRevenue), allCost = num(sold[0]?.allCost);
    return NextResponse.json({
      success: true,
      stats: {
        productRevenue,
        serviceRevenue,
        totalRevenue: productRevenue + serviceRevenue,
        grossProfit: productRevenue - cost,
        totalStockUnits: units._sum.quantity || 0,
        totalProducts: productCount,
      },
      insights: [],
      profitability,
      profitabilitySummary: {
        productsSold: num(sold[0]?.soldCount),
        shown: profitability.length,
        totalRevenue: allRevenue,
        totalCost: allCost,
        grossProfit: allRevenue - allCost,
      },
    });
  } catch (error: any) {
    console.error('Error building profitability stats:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
