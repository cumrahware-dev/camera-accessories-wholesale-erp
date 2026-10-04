import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { guardApi, depotIdFilter } from '@/lib/api-auth';

interface CachedOverview {
  data: any;
  expiresAt: number;
}
const overviewCache = new Map<string, CachedOverview>();
const OVERVIEW_CACHE_TTL_MS = 30 * 1000;

type RangeKey = 'today' | '7d' | '30d' | 'quarter' | 'ytd' | 'all';

interface RangeConfig {
  key: RangeKey;
  label: string;
  startDate: Date | null;
  endDate: Date;
  prevStartDate: Date | null;
  prevEndDate: Date | null;
  comparisonLabel: string;
}

function parseDateRange(raw: string | null): RangeConfig {
  const now = new Date();
  const clean = (raw || '').toLowerCase().trim();

  if (clean === 'today') {
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const prevStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    const prevEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, now.getHours(), now.getMinutes(), now.getSeconds(), 999);
    return {
      key: 'today',
      label: 'Today',
      startDate,
      endDate: now,
      prevStartDate,
      prevEndDate,
      comparisonLabel: 'vs yesterday',
    };
  }

  if (clean === '7d' || clean.includes('7')) {
    const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevStartDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const prevEndDate = startDate;
    return {
      key: '7d',
      label: 'Last 7 days',
      startDate,
      endDate: now,
      prevStartDate,
      prevEndDate,
      comparisonLabel: 'vs prev 7 days',
    };
  }

  if (clean === 'quarter' || clean.includes('quarter')) {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    const startDate = new Date(now.getFullYear(), quarterStartMonth, 1, 0, 0, 0, 0);
    const prevStartDate = new Date(now.getFullYear(), quarterStartMonth - 3, 1, 0, 0, 0, 0);
    const prevEndDate = startDate;
    return {
      key: 'quarter',
      label: 'This Quarter',
      startDate,
      endDate: now,
      prevStartDate,
      prevEndDate,
      comparisonLabel: 'vs prev quarter',
    };
  }

  if (clean === 'ytd' || clean.includes('year') || clean.includes('ytd')) {
    const startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const prevStartDate = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0);
    const prevEndDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0);
    return {
      key: 'ytd',
      label: 'Year to Date',
      startDate,
      endDate: now,
      prevStartDate,
      prevEndDate,
      comparisonLabel: 'vs last year',
    };
  }

  if (clean === 'all' || clean.includes('all')) {
    return {
      key: 'all',
      label: 'All Time',
      startDate: null,
      endDate: now,
      prevStartDate: null,
      prevEndDate: null,
      comparisonLabel: 'all-time record',
    };
  }

  // Default: 'Last 30 days'
  const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const prevStartDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const prevEndDate = startDate;
  return {
    key: '30d',
    label: 'Last 30 days',
    startDate,
    endDate: now,
    prevStartDate,
    prevEndDate,
    comparisonLabel: 'vs prev 30 days',
  };
}

interface TrendBucket {
  label: string;
  start: Date;
  end: Date;
  revenue: number;
  cost: number;
  orders: number;
}

function generateTrendBuckets(range: RangeConfig): TrendBucket[] {
  const now = range.endDate;
  const buckets: TrendBucket[] = [];

  if (range.key === 'today') {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    for (let h = 0; h < 24; h += 4) {
      const bStart = new Date(base.getTime() + h * 3600 * 1000);
      const bEnd = new Date(base.getTime() + (h + 4) * 3600 * 1000);
      const label = `${String(h).padStart(2, '0')}:00`;
      buckets.push({ label, start: bStart, end: bEnd, revenue: 0, cost: 0, orders: 0 });
    }
    return buckets;
  }

  if (range.key === '7d') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 0, 0, 0, 0);
      const bEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
      buckets.push({ label, start: d, end: bEnd, revenue: 0, cost: 0, orders: 0 });
    }
    return buckets;
  }

  if (range.key === '30d') {
    const startMs = range.startDate!.getTime();
    const intervalMs = 6 * 24 * 3600 * 1000;
    for (let i = 0; i < 5; i++) {
      const bStart = new Date(startMs + i * intervalMs);
      const bEnd = new Date(Math.min(startMs + (i + 1) * intervalMs, now.getTime()));
      const label = bStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      buckets.push({ label, start: bStart, end: bEnd, revenue: 0, cost: 0, orders: 0 });
    }
    return buckets;
  }

  if (range.key === 'quarter') {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    for (let i = 0; i < 3; i++) {
      const m = quarterStartMonth + i;
      const bStart = new Date(now.getFullYear(), m, 1, 0, 0, 0, 0);
      const bEnd = new Date(now.getFullYear(), m + 1, 0, 23, 59, 59, 999);
      const label = bStart.toLocaleDateString('en-US', { month: 'short' });
      buckets.push({ label, start: bStart, end: bEnd, revenue: 0, cost: 0, orders: 0 });
    }
    return buckets;
  }

  if (range.key === 'ytd') {
    for (let m = 0; m <= now.getMonth(); m++) {
      const bStart = new Date(now.getFullYear(), m, 1, 0, 0, 0, 0);
      const bEnd = new Date(now.getFullYear(), m + 1, 0, 23, 59, 59, 999);
      const label = bStart.toLocaleDateString('en-US', { month: 'short' });
      buckets.push({ label, start: bStart, end: bEnd, revenue: 0, cost: 0, orders: 0 });
    }
    return buckets;
  }

  // 'all': 6 trailing months
  for (let i = 5; i >= 0; i--) {
    const bStart = new Date(now.getFullYear(), now.getMonth() - i, 1, 0, 0, 0, 0);
    const bEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
    const label = bStart.toLocaleDateString('en-US', { month: 'short' });
    buckets.push({ label, start: bStart, end: bEnd, revenue: 0, cost: 0, orders: 0 });
  }
  return buckets;
}

const num = (v: unknown) => Number(v ?? 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) => d.toISOString();

/**
 * Dashboard numbers computed IN THE DATABASE.
 *
 * This used to load every invoice with all its line items, every product and every inventory row into Node and loop
 * over them (tens of thousands of rows per view). With the database a few hundred milliseconds away that was several
 * seconds per load. Now each figure is one SQL aggregate and all of them run in parallel, so the whole dashboard
 * costs about one database round trip. The arithmetic is unchanged: revenue = sum of invoice totals, cost = sum of
 * quantity x product purchase price, cancelled and draft invoices excluded.
 */
async function buildOverview(depotId: string | undefined, rangeConfig: RangeConfig) {
  const isDepotScoped = !!depotId;
  // draft invoices are not sales yet; cancelled ones never were
  const scope = depotId
    ? Prisma.sql`i."fulfilmentStatus" <> 'CANCELLED' AND i."documentStatus" <> 'DRAFT' AND i."depotId" = ${depotId}`
    : Prisma.sql`i."fulfilmentStatus" <> 'CANCELLED' AND i."documentStatus" <> 'DRAFT'`;

  const inRange = (lo: Date | null, hi: Date | null, hiInclusive: boolean) => {
    const parts: Prisma.Sql[] = [];
    if (lo) parts.push(Prisma.sql`i."createdAt" >= ${iso(lo)}::timestamp`);
    if (hi) parts.push(hiInclusive ? Prisma.sql`i."createdAt" <= ${iso(hi)}::timestamp` : Prisma.sql`i."createdAt" < ${iso(hi)}::timestamp`);
    return parts.length ? Prisma.sql`AND ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
  };
  const cur = inRange(rangeConfig.startDate, rangeConfig.endDate, true);
  const costOfInvoice = Prisma.sql`COALESCE((SELECT SUM(it.quantity * COALESCE(p."purchasePrice", 0)) FROM "InvoiceItem" it JOIN "Product" p ON p.id = it."productId" WHERE it."invoiceId" = i.id), 0)`;

  const period = (range: Prisma.Sql) => prisma.$queryRaw<any[]>`
    SELECT COUNT(*)::int AS orders, COALESCE(SUM(f.g), 0) AS revenue, COALESCE(SUM(f.cost), 0) AS cost
      FROM (SELECT i."grandTotal" AS g, ${costOfInvoice} AS cost FROM "TaxInvoice" i WHERE ${scope} ${range}) f`;

  const buckets = generateTrendBuckets(rangeConfig);
  const bucketCase = buckets.length
    ? Prisma.sql`CASE ${Prisma.join(buckets.map((b, idx) => Prisma.sql`WHEN i."createdAt" >= ${iso(b.start)}::timestamp AND i."createdAt" <= ${iso(b.end)}::timestamp THEN ${idx}::int`), ' ')} END`
    : Prisma.sql`NULL::int`;

  const [curT, prevT, trendRows, catRows, prodRows, custRows, depotSales, inv, depots, proformaPending, shipmentsPending] = await Promise.all([
    period(cur),
    rangeConfig.prevStartDate && rangeConfig.prevEndDate ? period(inRange(rangeConfig.prevStartDate, rangeConfig.prevEndDate, false)) : Promise.resolve([{ orders: 0, revenue: 0, cost: 0 }]),
    prisma.$queryRaw<any[]>`
      SELECT f.b AS bucket, COUNT(*)::int AS orders, COALESCE(SUM(f.g), 0) AS revenue, COALESCE(SUM(f.cost), 0) AS cost
        FROM (SELECT ${bucketCase} AS b, i."grandTotal" AS g, ${costOfInvoice} AS cost FROM "TaxInvoice" i WHERE ${scope} ${cur}) f
       WHERE f.b IS NOT NULL GROUP BY f.b`,
    prisma.$queryRaw<any[]>`
      SELECT COALESCE(NULLIF(p."categoryName", ''), 'General Optics') AS name, COALESCE(SUM(it."totalPrice"), 0) AS revenue, COALESCE(SUM(it.quantity), 0)::int AS units
        FROM "InvoiceItem" it JOIN "TaxInvoice" i ON i.id = it."invoiceId" LEFT JOIN "Product" p ON p.id = it."productId"
       WHERE ${scope} ${cur} GROUP BY 1 ORDER BY revenue DESC`,
    prisma.$queryRaw<any[]>`
      SELECT it."productId" AS "productId", MIN(p.name) AS name, MIN(p.sku) AS sku, MIN(p.brand) AS brand,
             COALESCE(SUM(it.quantity), 0)::int AS units, COALESCE(SUM(it."totalPrice"), 0) AS revenue,
             COALESCE(SUM(it.quantity * COALESCE(p."purchasePrice", 0)), 0) AS cost
        FROM "InvoiceItem" it JOIN "TaxInvoice" i ON i.id = it."invoiceId" LEFT JOIN "Product" p ON p.id = it."productId"
       WHERE ${scope} ${cur} GROUP BY it."productId" ORDER BY revenue DESC LIMIT 5`,
    prisma.$queryRaw<any[]>`
      SELECT f.cid AS "customerId", MIN(f.cname) AS name, MIN(f.ccompany) AS company, COUNT(*)::int AS orders,
             COALESCE(SUM(f.g), 0) AS revenue, COALESCE(SUM(f.cost), 0) AS cost
        FROM (SELECT COALESCE(i."customerId", 'cust-direct') AS cid, i."customerName" AS cname, i."customerCompany" AS ccompany, i."grandTotal" AS g, ${costOfInvoice} AS cost
                FROM "TaxInvoice" i WHERE ${scope} ${cur}) f
       GROUP BY f.cid ORDER BY revenue DESC LIMIT 5`,
    isDepotScoped ? Promise.resolve([]) : prisma.$queryRaw<any[]>`
      SELECT f.did AS "depotId", COUNT(*)::int AS orders, COALESCE(SUM(f.g), 0) AS revenue, COALESCE(SUM(f.cost), 0) AS cost
        FROM (SELECT i."depotId" AS did, i."grandTotal" AS g, ${costOfInvoice} AS cost FROM "TaxInvoice" i WHERE ${scope} ${cur}) f GROUP BY f.did`,
    prisma.$queryRaw<any[]>`
      SELECT COALESCE(SUM(di.quantity), 0)::int AS units, COALESCE(SUM(di.quantity * COALESCE(p."purchasePrice", 0)), 0) AS value
        FROM "DepotInventory" di JOIN "Product" p ON p.id = di."productId" ${depotId ? Prisma.sql`WHERE di."depotId" = ${depotId}` : Prisma.empty}`,
    isDepotScoped ? Promise.resolve([] as any[]) : prisma.depot.findMany({ select: { id: true, name: true, totalStockUnits: true, totalStockValue: true } }),
    prisma.proforma.count({
      where: depotId ? { items: { some: { selectedDepotId: depotId } }, status: { in: ['DRAFT', 'SENT', 'CONFIRMED'] } } : { status: { in: ['DRAFT', 'SENT', 'CONFIRMED'] } },
    }),
    prisma.shipment.count({ where: depotId ? { depotId, status: { not: 'DELIVERED' } } : { status: { not: 'DELIVERED' } } }),
  ]);

  const c = { orders: num(curT[0]?.orders), revenue: num(curT[0]?.revenue), cost: num(curT[0]?.cost) };
  const pv = { orders: num(prevT[0]?.orders), revenue: num(prevT[0]?.revenue), cost: num(prevT[0]?.cost) };
  const profit = c.revenue - c.cost;
  const prevProfit = pv.revenue - pv.cost;
  const pctChange = (current: number, previous: number): number | null => {
    if (previous === 0) return current > 0 ? 100 : null;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  };

  const trendByIdx = new Map<number, { revenue: number; cost: number; orders: number }>(trendRows.map((t) => [num(t.bucket), { revenue: num(t.revenue), cost: num(t.cost), orders: num(t.orders) }]));
  const trend = buckets.map((b, idx) => {
    const t = trendByIdx.get(idx) || { revenue: 0, cost: 0, orders: 0 };
    return { month: b.label, revenue: r2(t.revenue), profit: r2(t.revenue - t.cost), orders: t.orders };
  });

  const salesByCategory = catRows.map((r) => ({ name: r.name, revenue: r2(num(r.revenue)), units: num(r.units) }));
  const topProducts = prodRows.map((r) => {
    const revenue = num(r.revenue), prof = revenue - num(r.cost);
    return { productId: r.productId, name: r.name || 'Unknown Product', sku: r.sku || '—', brand: r.brand || '—', unitsSold: num(r.units), revenue: r2(revenue), profit: r2(prof), marginPercent: revenue ? Math.round((prof / revenue) * 1000) / 10 : 0 };
  });
  const topCustomers = custRows.map((r) => {
    const revenue = num(r.revenue), prof = revenue - num(r.cost);
    const company = r.company || r.name || 'Direct';
    return { customerId: r.customerId, name: company || r.name || 'Direct Customer', orders: num(r.orders), revenue: r2(revenue), profit: r2(prof), marginPercent: revenue ? Math.round((prof / revenue) * 1000) / 10 : 0 };
  });

  const salesByDepot = new Map<string, { revenue: number; cost: number; orders: number }>(depotSales.map((d) => [d.depotId, { revenue: num(d.revenue), cost: num(d.cost), orders: num(d.orders) }]));
  const depotPerformance = !isDepotScoped && depots.length > 0
    ? depots.map((d) => {
        const sales = salesByDepot.get(d.id) || { revenue: 0, cost: 0, orders: 0 };
        return { depotId: d.id, name: d.name, revenue: r2(sales.revenue), profit: r2(sales.revenue - sales.cost), orders: sales.orders, inventoryUnits: d.totalStockUnits || 0, inventoryValue: r2(d.totalStockValue || 0) };
      }).sort((a, b) => b.revenue - a.revenue)
    : [];

  return {
    totals: {
      revenue: r2(c.revenue),
      grossProfit: r2(profit),
      grossMarginPercent: c.revenue ? Math.round((profit / c.revenue) * 1000) / 10 : 0,
      orders: c.orders,
      inventoryUnits: num(inv[0]?.units),
      inventoryValue: r2(num(inv[0]?.value)),
      pendingProformas: proformaPending,
      pendingShipments: shipmentsPending,
    },
    currentMonth: {
      revenue: r2(c.revenue),
      profit: r2(profit),
      orders: c.orders,
      revenueChangePct: pctChange(c.revenue, pv.revenue),
      profitChangePct: pctChange(profit, prevProfit),
      ordersChangePct: pctChange(c.orders, pv.orders),
      comparisonLabel: rangeConfig.comparisonLabel,
      rangeLabel: rangeConfig.label,
    },
    trend,
    salesByCategory,
    topProducts,
    topCustomers,
    depotPerformance,
  };
}

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'dashboard.view');
  if (!auth.ok) return auth.response;

  try {
    const depotId = depotIdFilter(auth.user);
    const rawRange = req.nextUrl.searchParams.get('range') || req.nextUrl.searchParams.get('dateRange');
    const rangeConfig = parseDateRange(rawRange);
    const cacheKey = `${depotId || 'GLOBAL'}_${rangeConfig.key}`;

    const cached = overviewCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json(cached.data, { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=45' } });
    }

    const result = await buildOverview(depotId, rangeConfig);
    overviewCache.set(cacheKey, { data: result, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=45' } });
  } catch (error: any) {
    // No stand-in data: showing made-up numbers when the database hiccups is worse than a clear, retryable error.
    console.error('Error building dashboard overview:', error?.message);
    return NextResponse.json({ error: 'The dashboard could not be loaded right now. Please retry.' }, { status: 503 });
  }
}
