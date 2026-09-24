import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
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

function computeOverviewMetrics({
  invoices,
  products,
  depots,
  inventoryUnits,
  inventoryValue,
  pendingProformas,
  pendingShipments,
  isDepotScoped,
  rangeConfig,
}: {
  invoices: any[];
  products: any[];
  depots: any[];
  inventoryUnits: number;
  inventoryValue: number;
  pendingProformas: number;
  pendingShipments: number;
  isDepotScoped: boolean;
  rangeConfig: RangeConfig;
}) {
  const productById = new Map(products.map((p) => [p.id, p]));
  const costOfItems = (items: any[]) =>
    (items || []).reduce(
      (sum, item) => sum + (item.quantity || 0) * (productById.get(item.productId)?.purchasePrice || 0),
      0
    );

  // Filter invoices by selected date range
  const filteredInvoices = invoices.filter((inv) => {
    if (inv.fulfilmentStatus === 'CANCELLED') return false;
    if (!rangeConfig.startDate) return true; // 'all'
    const t = new Date(inv.createdAt).getTime();
    return t >= rangeConfig.startDate.getTime() && t <= rangeConfig.endDate.getTime();
  });

  // Comparison invoices for previous equivalent period
  const prevInvoices = invoices.filter((inv) => {
    if (inv.fulfilmentStatus === 'CANCELLED') return false;
    if (!rangeConfig.prevStartDate || !rangeConfig.prevEndDate) return false;
    const t = new Date(inv.createdAt).getTime();
    return t >= rangeConfig.prevStartDate.getTime() && t < rangeConfig.prevEndDate.getTime();
  });

  // Period Totals
  const periodRevenue = filteredInvoices.reduce((s, i) => s + (i.grandTotal || 0), 0);
  const periodCost = filteredInvoices.reduce((s, i) => s + costOfItems(i.items), 0);
  const periodGrossProfit = periodRevenue - periodCost;
  const grossMarginPercent = periodRevenue ? Math.round((periodGrossProfit / periodRevenue) * 1000) / 10 : 0;

  // Previous Period Totals
  const prevRevenue = prevInvoices.reduce((s, i) => s + (i.grandTotal || 0), 0);
  const prevCost = prevInvoices.reduce((s, i) => s + costOfItems(i.items), 0);
  const prevGrossProfit = prevRevenue - prevCost;
  const prevOrders = prevInvoices.length;

  const pctChange = (current: number, previous: number): number | null => {
    if (previous === 0) return current > 0 ? 100 : null;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  };

  const revenueChangePct = pctChange(periodRevenue, prevRevenue);
  const profitChangePct = pctChange(periodGrossProfit, prevGrossProfit);
  const ordersChangePct = pctChange(filteredInvoices.length, prevOrders);

  // Trend chart buckets
  const buckets = generateTrendBuckets(rangeConfig);
  for (const inv of filteredInvoices) {
    const invTime = new Date(inv.createdAt).getTime();
    const bucket = buckets.find((b) => invTime >= b.start.getTime() && invTime <= b.end.getTime());
    if (bucket) {
      bucket.revenue += inv.grandTotal || 0;
      bucket.cost += costOfItems(inv.items);
      bucket.orders += 1;
    }
  }

  const trend = buckets.map((b) => ({
    month: b.label,
    revenue: Math.round(b.revenue * 100) / 100,
    profit: Math.round((b.revenue - b.cost) * 100) / 100,
    orders: b.orders,
  }));

  // Sales by Category
  const categoryTotals = new Map<string, { revenue: number; units: number }>();
  for (const inv of filteredInvoices) {
    for (const item of inv.items || []) {
      const categoryName = productById.get(item.productId)?.categoryName || 'General Optics';
      const entry = categoryTotals.get(categoryName) || { revenue: 0, units: 0 };
      entry.revenue += item.totalPrice || 0;
      entry.units += item.quantity || 0;
      categoryTotals.set(categoryName, entry);
    }
  }
  const salesByCategory = Array.from(categoryTotals.entries())
    .map(([name, v]) => ({ name, revenue: Math.round(v.revenue * 100) / 100, units: v.units }))
    .sort((a, b) => b.revenue - a.revenue);

  // Top Products
  const productTotals = new Map<string, { unitsSold: number; revenue: number; cost: number }>();
  for (const inv of filteredInvoices) {
    for (const item of inv.items || []) {
      const entry = productTotals.get(item.productId) || { unitsSold: 0, revenue: 0, cost: 0 };
      entry.unitsSold += item.quantity || 0;
      entry.revenue += item.totalPrice || 0;
      entry.cost += (item.quantity || 0) * (productById.get(item.productId)?.purchasePrice || 0);
      productTotals.set(item.productId, entry);
    }
  }
  const topProducts = Array.from(productTotals.entries())
    .map(([productId, v]) => {
      const p = productById.get(productId);
      const profit = v.revenue - v.cost;
      return {
        productId,
        name: p?.name || 'Unknown Product',
        sku: p?.sku || '—',
        brand: p?.brand || '—',
        unitsSold: v.unitsSold,
        revenue: Math.round(v.revenue * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        marginPercent: v.revenue ? Math.round((profit / v.revenue) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Top Customers
  const customerTotals = new Map<string, { name: string; company: string; orders: number; revenue: number; cost: number }>();
  for (const inv of filteredInvoices) {
    const custId = inv.customerId || 'cust-direct';
    const entry = customerTotals.get(custId) || {
      name: inv.customerName || 'Direct Customer',
      company: inv.customerCompany || inv.customerName || 'Direct',
      orders: 0,
      revenue: 0,
      cost: 0,
    };
    entry.orders += 1;
    entry.revenue += inv.grandTotal || 0;
    entry.cost += costOfItems(inv.items);
    customerTotals.set(custId, entry);
  }
  const topCustomers = Array.from(customerTotals.entries())
    .map(([customerId, v]) => {
      const profit = v.revenue - v.cost;
      return {
        customerId,
        name: v.company || v.name,
        orders: v.orders,
        revenue: Math.round(v.revenue * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        marginPercent: v.revenue ? Math.round((profit / v.revenue) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Depot Performance
  let depotPerformance: Array<{
    depotId: string;
    name: string;
    revenue: number;
    profit: number;
    orders: number;
    inventoryUnits: number;
    inventoryValue: number;
  }> = [];
  if (!isDepotScoped && depots.length > 0) {
    const invoicesByDepot = new Map<string, { revenue: number; cost: number; orders: number }>();
    for (const inv of filteredInvoices) {
      const dId = inv.depotId || 'dep-central';
      const entry = invoicesByDepot.get(dId) || { revenue: 0, cost: 0, orders: 0 };
      entry.revenue += inv.grandTotal || 0;
      entry.cost += costOfItems(inv.items);
      entry.orders += 1;
      invoicesByDepot.set(dId, entry);
    }

    depotPerformance = depots
      .map((d) => {
        const sales = invoicesByDepot.get(d.id) || { revenue: 0, cost: 0, orders: 0 };
        return {
          depotId: d.id,
          name: d.name,
          revenue: Math.round(sales.revenue * 100) / 100,
          profit: Math.round((sales.revenue - sales.cost) * 100) / 100,
          orders: sales.orders,
          inventoryUnits: d.totalStockUnits || 0,
          inventoryValue: Math.round((d.totalStockValue || 0) * 100) / 100,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }

  return {
    totals: {
      revenue: Math.round(periodRevenue * 100) / 100,
      grossProfit: Math.round(periodGrossProfit * 100) / 100,
      grossMarginPercent,
      orders: filteredInvoices.length,
      inventoryUnits,
      inventoryValue: Math.round(inventoryValue * 100) / 100,
      pendingProformas,
      pendingShipments,
    },
    currentMonth: {
      revenue: Math.round(periodRevenue * 100) / 100,
      profit: Math.round(periodGrossProfit * 100) / 100,
      orders: filteredInvoices.length,
      revenueChangePct,
      profitChangePct,
      ordersChangePct,
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

    const currentTime = Date.now();
    const cached = overviewCache.get(cacheKey);

    if (cached && currentTime < cached.expiresAt) {
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'private, max-age=15, stale-while-revalidate=45',
        },
      });
    }

    const isDepotScoped = !!depotId;
    const invoiceWhere = depotId
      ? { depotId, fulfilmentStatus: { not: 'CANCELLED' as const } }
      : { fulfilmentStatus: { not: 'CANCELLED' as const } };

    const [invoices, products, proformaPending, shipmentsPending, depots, inventoryRows] = await withDbTimeout(() =>
      Promise.all([
        prisma.taxInvoice.findMany({
          where: invoiceWhere,
          select: {
            createdAt: true,
            grandTotal: true,
            customerId: true,
            customerName: true,
            customerCompany: true,
            depotId: true,
            fulfilmentStatus: true,
            items: { select: { productId: true, quantity: true, totalPrice: true } },
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.product.findMany({ select: { id: true, name: true, sku: true, brand: true, categoryName: true, purchasePrice: true } }),
        prisma.proforma.count({
          where: depotId
            ? { items: { some: { selectedDepotId: depotId } }, status: { in: ['DRAFT', 'SENT', 'CONFIRMED'] } }
            : { status: { in: ['DRAFT', 'SENT', 'CONFIRMED'] } },
        }),
        prisma.shipment.count({
          where: depotId ? { depotId, status: { not: 'DELIVERED' } } : { status: { not: 'DELIVERED' } },
        }),
        isDepotScoped ? Promise.resolve([]) : prisma.depot.findMany({ select: { id: true, name: true, totalStockUnits: true, totalStockValue: true } }),
        prisma.depotInventory.findMany({
          where: depotId ? { depotId } : undefined,
          select: { depotId: true, quantity: true, productId: true },
        }),
      ])
    );

    const productById = new Map(products.map((p) => [p.id, p]));
    const inventoryUnits = inventoryRows.reduce((s, r) => s + r.quantity, 0);
    const inventoryValue = inventoryRows.reduce((s, r) => s + r.quantity * (productById.get(r.productId)?.purchasePrice || 0), 0);

    const result = computeOverviewMetrics({
      invoices,
      products,
      depots,
      inventoryUnits,
      inventoryValue,
      pendingProformas: proformaPending,
      pendingShipments: shipmentsPending,
      isDepotScoped,
      rangeConfig,
    });

    overviewCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS,
    });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, max-age=15, stale-while-revalidate=45',
      },
    });
  } catch (error) {
    console.error('Error building dashboard overview from DB, building from dataStore:', error);
    try {
      const rawRange = req.nextUrl.searchParams.get('range') || req.nextUrl.searchParams.get('dateRange');
      const rangeConfig = parseDateRange(rawRange);

      const products = dataStore.getProducts();
      const invoices = dataStore.getInvoices();
      const proformas = dataStore.getProformas();
      const shipments = dataStore.getShipments();
      const depots = dataStore.getDepots();

      const totalUnits = products.reduce((sum, p) => sum + (p.totalStock || 0), 0);
      const totalValuation = products.reduce((sum, p) => sum + (p.totalStock || 0) * (p.purchasePrice || 0), 0);

      const fallbackResult = computeOverviewMetrics({
        invoices,
        products,
        depots,
        inventoryUnits: totalUnits,
        inventoryValue: totalValuation,
        pendingProformas: proformas.filter((p) => p.status !== 'CONVERTED').length,
        pendingShipments: shipments.filter((s) => s.status !== 'DELIVERED').length,
        isDepotScoped: false,
        rangeConfig,
      });

      return NextResponse.json(fallbackResult);
    } catch (fallbackError) {
      console.error('Fatal overview fallback failure:', fallbackError);
      return NextResponse.json({ error: 'Failed to build dashboard overview' }, { status: 500 });
    }
  }
}
