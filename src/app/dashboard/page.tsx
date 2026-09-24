'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  DollarSign,
  TrendingUp,
  Package,
  Boxes,
  FileCheck2,
  Truck,
  ShoppingCart,
  Printer,
  Receipt,
  Building2,
  ExternalLink,
  PlusCircle,
  FolderLock,
  Calendar,
  SlidersHorizontal,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { formatUSD, cn } from '@/lib/utils';
import { TaxInvoice, Shipment, User } from '@/types/erp';
import { fetchCurrentUserCached, getCurrentUserCachedSync, fetchWithCache } from '@/lib/client-cache';
import PrintableDocumentModal from '@/components/pdf/PrintableDocumentModal';
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader';
import { KPICard } from '@/components/ui/KPICard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button, LinkButton, IconButton } from '@/components/ui/Button';
import { StatusBadge, MarginBadge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Skeleton, SkeletonKPIRow, SkeletonTable, SkeletonCard } from '@/components/ui/Skeleton';
import type { TrendPoint } from '@/components/dashboard/RevenueProfitChart';
import {
  DashboardCustomizeModal,
  DashboardPreferences,
  DEFAULT_DASHBOARD_PREFERENCES,
  loadDashboardPreferences,
  saveDashboardPreferences,
  isPreferencesModified,
} from '@/components/dashboard/DashboardCustomizeModal';

const RevenueProfitChart = dynamic(
  () => import('@/components/dashboard/RevenueProfitChart').then((m) => m.RevenueProfitChart),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> }
);
const CategoryBreakdownChart = dynamic(
  () => import('@/components/dashboard/CategoryBreakdownChart').then((m) => m.CategoryBreakdownChart),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> }
);

interface OverviewData {
  totals: {
    revenue: number;
    grossProfit: number;
    grossMarginPercent: number;
    orders: number;
    inventoryUnits: number;
    inventoryValue: number;
    pendingProformas: number;
    pendingShipments: number;
  };
  currentMonth: {
    revenue: number;
    profit: number;
    orders: number;
    revenueChangePct: number | null;
    profitChangePct: number | null;
    ordersChangePct: number | null;
    comparisonLabel?: string;
    rangeLabel?: string;
  };
  trend: TrendPoint[];
  salesByCategory: { name: string; revenue: number; units: number }[];
  topProducts: { productId: string; name: string; sku: string; brand: string; unitsSold: number; revenue: number; profit: number; marginPercent: number }[];
  topCustomers: { customerId: string; name: string; orders: number; revenue: number; profit: number; marginPercent: number }[];
  depotPerformance: { depotId: string; name: string; revenue: number; profit: number; orders: number; inventoryUnits: number; inventoryValue: number }[];
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function trendFor(pct: number | null, label = 'vs last month', positiveIsGood = true) {
  if (pct === null) return undefined;
  return {
    direction: (pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat') as 'up' | 'down' | 'flat',
    value: `${pct > 0 ? '+' : ''}${pct}%`,
    label,
    positiveIsGood,
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<{ type: 'TAX_INVOICE' | 'PROFORMA'; data: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterLoading, setFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState('Last 30 days');
  const [isMounted, setIsMounted] = useState(false);

  // Customization state
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [preferences, setPreferences] = useState<DashboardPreferences>(DEFAULT_DASHBOARD_PREFERENCES);

  const loadData = async (selectedRange = dateRange, isBackground = false) => {
    if (!isBackground && !overview) {
      setError(null);
    }
    try {
      // Parallel non-blocking requests using client-side cache
      const [userData, overviewData, invoicesData, shipmentsData] = await Promise.all([
        fetchCurrentUserCached().catch(() => null),
        fetchWithCache<OverviewData>(
          `/api/dashboard/overview?range=${encodeURIComponent(selectedRange)}`,
          undefined,
          20000
        ).catch((e: any) => {
          if (e?.message?.includes('401')) {
            router.push('/login?next=/dashboard');
          }
          return null;
        }),
        fetchWithCache<TaxInvoice[]>('/api/invoices?limit=6', undefined, 15000).catch(() => []),
        fetchWithCache<Shipment[]>('/api/shipments?limit=4', undefined, 15000).catch(() => []),
      ]);

      if (userData?.authenticated && userData.user) {
        setCurrentUser(userData.user);
      } else if (userData && userData.authenticated === false) {
        router.push('/login?next=/dashboard');
        return;
      }

      if (overviewData) {
        setOverview(overviewData);
      } else if (!overview) {
        setError('Unable to load overview metrics. Please try again.');
      }

      if (Array.isArray(invoicesData)) setInvoices(invoicesData.slice(0, 6));
      if (Array.isArray(shipmentsData)) setShipments(shipmentsData.slice(0, 4));
    } catch (err: any) {
      console.error('Error loading dashboard:', err);
      if (err?.message?.includes('401')) {
        router.push('/login?next=/dashboard');
        return;
      }
      if (!overview) {
        setError('Something went wrong while loading the dashboard.');
      }
    } finally {
      setLoading(false);
      setFilterLoading(false);
    }
  };

  const handleDateRangeChange = async (newRange: string) => {
    setDateRange(newRange);
    setFilterLoading(true);
    try {
      const overviewData = await fetchWithCache<OverviewData>(
        `/api/dashboard/overview?range=${encodeURIComponent(newRange)}`,
        undefined,
        15000
      );
      if (overviewData) {
        setOverview(overviewData);
      }
    } catch (err) {
      console.error('Error updating overview for range:', err);
    } finally {
      setFilterLoading(false);
    }
  };

  useEffect(() => {
    setIsMounted(true);
    setPreferences(loadDashboardPreferences());
    const syncUser = getCurrentUserCachedSync()?.user;
    if (syncUser) setCurrentUser(syncUser);
    loadData();
  }, []);

  const isDepotUser = isMounted && currentUser?.role === 'DEPOT_USER';
  const userName = isMounted && currentUser?.name ? currentUser.name.split(' ')[0] : 'Administrator';
  const greeting = isMounted ? getGreeting() : 'Good day';
  const isCustomized = isMounted && isPreferencesModified(preferences);

  if (loading) {
    return (
      <div className="flex flex-col gap-6 pb-12">
        <Skeleton className="h-16 w-full rounded-lg" />
        <SkeletonKPIRow count={6} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SkeletonCard className="lg:col-span-2 h-80" />
          <SkeletonCard className="h-80" />
        </div>
        <SkeletonTable rows={5} cols={5} />
      </div>
    );
  }

  if (error && !overview) {
    return (
      <ErrorState
        title="Unable to load dashboard"
        description={error}
        action={<Button onClick={() => { setLoading(true); loadData(); }}>Try Again</Button>}
      />
    );
  }

  const t = overview?.totals || {
    revenue: 0,
    grossProfit: 0,
    grossMarginPercent: 0,
    orders: 0,
    inventoryUnits: 0,
    inventoryValue: 0,
    pendingProformas: 0,
    pendingShipments: 0,
  };
  const cm = overview?.currentMonth || {
    revenue: 0,
    profit: 0,
    orders: 0,
    revenueChangePct: null,
    profitChangePct: null,
    ordersChangePct: null,
    comparisonLabel: 'vs last month',
  };

  const comparisonLabel = cm.comparisonLabel || 'vs last month';

  const anyKpiVisible =
    (!isDepotUser && (preferences.kpiRevenue || preferences.kpiProfit || preferences.kpiInventory)) ||
    preferences.kpiOrders ||
    preferences.kpiProformas ||
    preferences.kpiShipments;

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Executive Header */}
      <PageHeader
        eyebrow="01 / OVERVIEW"
        title={`${greeting}, ${userName}`}
        description="Here's how ARIB GLOBAL is performing today."
        actions={
          <>
            <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-xs">
              {filterLoading ? (
                <Loader2 className="h-3.5 w-3.5 text-brand-600 animate-spin shrink-0" />
              ) : (
                <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              )}
              <select
                value={dateRange}
                onChange={(e) => handleDateRangeChange(e.target.value)}
                disabled={filterLoading}
                className="bg-transparent border-none p-0 text-xs font-medium text-slate-700 focus:ring-0 cursor-pointer disabled:opacity-60"
              >
                <option value="Today">Today</option>
                <option value="Last 7 days">Last 7 days</option>
                <option value="Last 30 days">Last 30 days</option>
                <option value="This Quarter">This Quarter</option>
                <option value="Year to Date">Year to Date</option>
                <option value="All Time">All Time</option>
              </select>
            </div>

            <Button
              size="sm"
              variant={isCustomized ? 'secondary' : 'outline'}
              iconLeft={<SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />}
              onClick={() => setShowCustomizeModal(true)}
              className="text-xs text-slate-700 border-slate-200 relative"
              title="Customize dashboard layout & visible widgets"
            >
              Customize
              {isCustomized && (
                <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-brand-500 inline-block" title="Custom view active" />
              )}
            </Button>

            {isDepotUser ? (
              <LinkButton href="/depot" iconLeft={<Boxes className="h-4 w-4" />} size="sm">
                Open Depot Queue
              </LinkButton>
            ) : (
              <LinkButton href="/proformas/new" iconLeft={<PlusCircle className="h-4 w-4" />} size="sm">
                New Proforma
              </LinkButton>
            )}
          </>
        }
      />

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div>
      )}

      {/* Business Overview KPI Cards */}
      {anyKpiVisible && (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Business Overview
            </div>
            {cm.rangeLabel && (
              <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                Period: {cm.rangeLabel}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
            {preferences.kpiRevenue && !isDepotUser && (
              <KPICard
                label="Revenue"
                value={formatUSD(t.revenue)}
                restricted={isDepotUser}
                trend={trendFor(cm.revenueChangePct, comparisonLabel)}
              />
            )}
            {preferences.kpiProfit && !isDepotUser && (
              <KPICard
                label="Gross Profit"
                value={formatUSD(t.grossProfit)}
                restricted={isDepotUser}
                trend={trendFor(cm.profitChangePct, comparisonLabel)}
                helperText={`${t.grossMarginPercent}% margin`}
              />
            )}
            {preferences.kpiOrders && (
              <KPICard
                label="Orders"
                value={t.orders}
                trend={trendFor(cm.ordersChangePct, comparisonLabel)}
              />
            )}
            {preferences.kpiInventory && !isDepotUser && (
              <KPICard
                label="Inventory Value"
                value={formatUSD(t.inventoryValue)}
                restricted={isDepotUser}
                helperText={`${t.inventoryUnits.toLocaleString()} units`}
              />
            )}
            {preferences.kpiProformas && (
              <KPICard
                label="Pending Proformas"
                value={t.pendingProformas}
                helperText="Awaiting conversion"
              />
            )}
            {preferences.kpiShipments && (
              <KPICard
                label="Pending Shipments"
                value={t.pendingShipments}
                helperText="Awaiting delivery"
              />
            )}
          </div>
        </div>
      )}

      {/* Main Charts Row */}
      {!isDepotUser && (preferences.showRevenueProfitChart || preferences.showCategoryChart) && (
        <div
          className={cn(
            'grid gap-4',
            preferences.showRevenueProfitChart && preferences.showCategoryChart
              ? 'grid-cols-1 lg:grid-cols-3'
              : 'grid-cols-1'
          )}
        >
          {preferences.showRevenueProfitChart && (
            <Card className={preferences.showCategoryChart ? 'lg:col-span-2' : ''}>
              <CardHeader>
                <div>
                  <CardTitle>Revenue & Profit</CardTitle>
                  <p className="text-xs text-slate-500 mt-0.5">Performance trend for {dateRange}</p>
                </div>
                <Link href="/reports/sales" prefetch={false} className="text-xs text-brand-600 font-medium hover:underline shrink-0">
                  Full analytics
                </Link>
              </CardHeader>
              <CardContent>
                {overview!.trend.every((p) => p.revenue === 0 && p.profit === 0) ? (
                  <EmptyState icon={TrendingUp} title="No sales recorded in this period" description="Revenue and profit trends will appear once invoices are issued." compact />
                ) : (
                  <RevenueProfitChart data={overview!.trend} />
                )}
              </CardContent>
            </Card>
          )}

          {preferences.showCategoryChart && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Sales by Category</CardTitle>
                  <p className="text-xs text-slate-500 mt-0.5">Breakdown for {dateRange}</p>
                </div>
              </CardHeader>
              <CardContent>
                {overview!.salesByCategory.length === 0 ? (
                  <EmptyState icon={Package} title="No category data" description="Category breakdown will populate with invoiced orders." compact />
                ) : (
                  <CategoryBreakdownChart data={overview!.salesByCategory} />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Top Products & Top Customers */}
      {!isDepotUser && (preferences.showTopProducts || preferences.showTopCustomers) && (
        <div
          className={cn(
            'grid gap-4',
            preferences.showTopProducts && preferences.showTopCustomers
              ? 'grid-cols-1 lg:grid-cols-2'
              : 'grid-cols-1'
          )}
        >
          {preferences.showTopProducts && (
            <Card className="overflow-hidden">
              <CardHeader>
                <div>
                  <CardTitle>Top Products</CardTitle>
                  <p className="text-xs text-slate-500 mt-0.5">Leaderboard for {dateRange}</p>
                </div>
                <Link href="/reports/profit" prefetch={false} className="text-xs text-brand-600 font-medium hover:underline shrink-0">
                  View catalog
                </Link>
              </CardHeader>
              {overview!.topProducts.length === 0 ? (
                <EmptyState icon={Package} title="No product sales yet" description="Top selling items will show here." compact />
              ) : (
                <Table className="border-0 rounded-none shadow-none">
                  <TableHeader>
                    <TableHead>Product</TableHead>
                    <TableHead align="right">Units</TableHead>
                    <TableHead align="right">Revenue</TableHead>
                    <TableHead align="right">Margin</TableHead>
                  </TableHeader>
                  <TableBody>
                    {overview!.topProducts.map((p) => (
                      <TableRow key={p.productId}>
                        <TableCell>
                          <div className="font-semibold text-slate-900">{p.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{p.sku}</div>
                        </TableCell>
                        <TableCell align="right">{p.unitsSold}</TableCell>
                        <TableCell align="right" className="font-semibold">{formatUSD(p.revenue)}</TableCell>
                        <TableCell align="right">
                          <MarginBadge marginPercent={p.marginPercent} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          )}

          {preferences.showTopCustomers && (
            <Card className="overflow-hidden">
              <CardHeader>
                <div>
                  <CardTitle>Top Customers</CardTitle>
                  <p className="text-xs text-slate-500 mt-0.5">Top accounts for {dateRange}</p>
                </div>
                <Link href="/customers" prefetch={false} className="text-xs text-brand-600 font-medium hover:underline shrink-0">
                  View all
                </Link>
              </CardHeader>
              {overview!.topCustomers.length === 0 ? (
                <EmptyState icon={Building2} title="No customer activity yet" description="Leading wholesale clients will show here." compact />
              ) : (
                <Table className="border-0 rounded-none shadow-none">
                  <TableHeader>
                    <TableHead>Customer</TableHead>
                    <TableHead align="right">Orders</TableHead>
                    <TableHead align="right">Revenue</TableHead>
                    <TableHead align="right">Margin</TableHead>
                  </TableHeader>
                  <TableBody>
                    {overview!.topCustomers.map((c) => (
                      <TableRow key={c.customerId}>
                        <TableCell className="font-semibold text-slate-900">{c.name}</TableCell>
                        <TableCell align="right">{c.orders}</TableCell>
                        <TableCell align="right" className="font-semibold">{formatUSD(c.revenue)}</TableCell>
                        <TableCell align="right">
                          <MarginBadge marginPercent={c.marginPercent} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          )}
        </div>
      )}

      {/* Depot Performance Table */}
      {!isDepotUser && preferences.showDepotPerformance && overview!.depotPerformance.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader>
            <div>
              <CardTitle>Depot Performance</CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">Warehouse sales & stock for {dateRange}</p>
            </div>
            <Link href="/depots" prefetch={false} className="text-xs text-brand-600 font-medium hover:underline shrink-0">
              Manage hubs
            </Link>
          </CardHeader>
          <Table className="border-0 rounded-none shadow-none">
            <TableHeader>
              <TableHead>Depot Hub</TableHead>
              <TableHead align="right">Sales</TableHead>
              <TableHead align="right">Profit</TableHead>
              <TableHead align="right">Orders</TableHead>
              <TableHead align="right">Inventory Units</TableHead>
            </TableHeader>
            <TableBody>
              {overview!.depotPerformance.map((d) => (
                <TableRow key={d.depotId}>
                  <TableCell className="font-semibold text-slate-900">{d.name}</TableCell>
                  <TableCell align="right">{formatUSD(d.revenue)}</TableCell>
                  <TableCell align="right" className="text-emerald-700 font-medium">{formatUSD(d.profit)}</TableCell>
                  <TableCell align="right">{d.orders}</TableCell>
                  <TableCell align="right" className="font-mono text-slate-700">
                    {d.inventoryUnits.toLocaleString()} units
                    <span className="text-slate-400 font-sans"> ({formatUSD(d.inventoryValue)})</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Tax Invoices & Active Dispatches Queue */}
      {(preferences.showInvoicesQueue || preferences.showDispatchesQueue) && (
        <div
          className={cn(
            'grid gap-6',
            preferences.showInvoicesQueue && preferences.showDispatchesQueue
              ? 'grid-cols-1 lg:grid-cols-3'
              : 'grid-cols-1'
          )}
        >
          {preferences.showInvoicesQueue && (
            <div className={cn('flex flex-col gap-3', preferences.showDispatchesQueue && 'lg:col-span-2')}>
              <SectionHeader
                title="Tax Invoices & Fulfilment Queue"
                actions={
                  <Link href="/invoices" prefetch={false} className="text-xs text-brand-600 font-medium hover:underline">
                    View all invoices
                  </Link>
                }
              />
              <Card className="p-0 overflow-hidden">
                {invoices.length === 0 ? (
                  <EmptyState
                    icon={Receipt}
                    title="No Tax Invoices Yet"
                    description="Tax invoices will appear here once converted from a confirmed proforma."
                    action={
                      <LinkButton href="/proformas/new" iconLeft={<PlusCircle className="h-4 w-4" />}>
                        Create First Proforma
                      </LinkButton>
                    }
                  />
                ) : (
                  <Table className="border-0 rounded-none shadow-none">
                    <TableHeader>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Depot</TableHead>
                      <TableHead align="right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead align="right">Actions</TableHead>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell>
                            <Link href={`/invoices/${inv.id}`} prefetch={false} className="font-mono font-semibold text-brand-600 hover:underline text-xs">
                              {inv.invoiceNumber}
                            </Link>
                            {inv.proformaNumber && <div className="text-[10px] text-slate-400 font-mono">From: {inv.proformaNumber}</div>}
                          </TableCell>
                          <TableCell>
                            <div className="font-semibold text-slate-900 text-xs">{inv.customerCompany}</div>
                            <div className="text-[11px] text-slate-500">{inv.customerName}</div>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                              <Building2 className="h-3.5 w-3.5 text-slate-400" />
                              {inv.depotName.replace(' Depot', '').replace(' Hub', '')}
                            </span>
                          </TableCell>
                          <TableCell align="right" className="font-mono font-semibold text-xs">
                            {!isDepotUser ? formatUSD(inv.grandTotal) : '—'}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={inv.fulfilmentStatus} />
                          </TableCell>
                          <TableCell align="right">
                            <div className="flex items-center justify-end gap-1">
                              <IconButton label="Print / PDF" onClick={() => setSelectedDoc({ type: 'TAX_INVOICE', data: inv })}>
                                <Printer className="h-3.5 w-3.5 text-slate-500" />
                              </IconButton>
                              <LinkButton href={`/invoices/${inv.id}`} size="sm" variant="secondary">
                                Open
                              </LinkButton>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
            </div>
          )}

          {preferences.showDispatchesQueue && (
            <div className="flex flex-col gap-3">
              <SectionHeader
                title="Recent Activity & Dispatches"
                actions={
                  <Link href="/shipments" prefetch={false} className="text-xs text-brand-600 font-medium hover:underline">
                    All AWBs
                  </Link>
                }
              />
              <div className="flex flex-col gap-3">
                {shipments.length === 0 ? (
                  <Card>
                    <EmptyState
                      icon={Truck}
                      title="No Active Dispatches"
                      description="Dispatched orders will appear here with live courier tracking."
                      compact
                    />
                  </Card>
                ) : (
                  shipments.map((shp) => (
                    <Card key={shp.id} className="p-3.5 flex flex-col gap-2.5">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[10px] font-mono font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-100 uppercase">
                            {shp.courier.replace(/_/g, ' ')}
                          </span>
                          <h4 className="text-xs font-semibold text-slate-900 mt-1.5">{shp.customerCompany}</h4>
                          <p className="text-[11px] font-mono text-slate-500">AWB: {shp.airwayBillNumber}</p>
                        </div>
                        <StatusBadge status={shp.status} />
                      </div>

                      <div className="p-2 rounded bg-slate-50 text-[11px] text-slate-600 space-y-1 border border-slate-100">
                        <div className="flex justify-between">
                          <span>Depot</span>
                          <span className="text-slate-900 font-medium">{shp.depotName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Package</span>
                          <span className="text-slate-900 font-mono">{shp.weightKg} kg ({shp.packageCount} box)</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-0.5">
                        <a
                          href={shp.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-semibold text-brand-600 hover:underline flex items-center gap-1"
                        >
                          Track Shipment
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <LinkButton href={`/shipments/${shp.id}`} size="sm" variant="secondary">
                          Details
                        </LinkButton>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* When user has turned off all widgets */}
      {!anyKpiVisible &&
        !preferences.showRevenueProfitChart &&
        !preferences.showCategoryChart &&
        !preferences.showTopProducts &&
        !preferences.showTopCustomers &&
        !preferences.showDepotPerformance &&
        !preferences.showInvoicesQueue &&
        !preferences.showDispatchesQueue && (
          <Card className="p-8 text-center">
            <EmptyState
              icon={SlidersHorizontal}
              title="All Widgets Hidden"
              description="You have hidden all metric cards and widgets in your customized layout."
              action={
                <Button size="sm" onClick={() => setShowCustomizeModal(true)}>
                  Customize Layout
                </Button>
              }
            />
          </Card>
        )}

      {/* Modals */}
      {selectedDoc && (
        <PrintableDocumentModal
          isOpen={true}
          onClose={() => setSelectedDoc(null)}
          documentType={selectedDoc.type}
          data={selectedDoc.data}
        />
      )}

      <DashboardCustomizeModal
        open={showCustomizeModal}
        onClose={() => setShowCustomizeModal(false)}
        preferences={preferences}
        onSave={(newPrefs) => setPreferences(newPrefs)}
        isDepotUser={isDepotUser}
      />
    </div>
  );
}
