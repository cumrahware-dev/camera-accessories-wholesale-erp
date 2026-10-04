'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Smartphone,
  Boxes,
  Package,
  Truck,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Search,
  Filter,
  RefreshCw,
  Barcode,
  ExternalLink,
  ChevronRight,
  Building2,
  Layers,
} from 'lucide-react';
import { User, TaxInvoice } from '@/types/erp';
import { fetchCurrentUserCached, getCurrentUserCachedSync, fetchWithCache } from '@/lib/client-cache';
import { formatUSD, formatDate } from '@/lib/utils';
import { DepotOverview } from '@/components/depot/DepotOverview';

export default function DepotDashboard() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => getCurrentUserCachedSync()?.user || null);
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'READY_FOR_PACKING' | 'IN_PACKING' | 'DISPATCHED'>('ALL');

  const loadData = async () => {
    let user: User | null = currentUser;

    try {
      const userData = await fetchCurrentUserCached();
      if (userData?.authenticated && userData.user) {
        user = userData.user;
        setCurrentUser(user);
      }
    } catch {}

    try {
      const allInvoices = await fetchWithCache<TaxInvoice[]>('/api/invoices', undefined, 10000);
      if (Array.isArray(allInvoices)) {
        const filtered = allInvoices.filter(
          (inv: any) => !user?.assignedDepotId || inv.depotId === user.assignedDepotId
        );
        setInvoices(filtered);
      }
    } catch {}

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const readyToPick = invoices.filter((i) => i.fulfilmentStatus === 'READY_FOR_PACKING');
  const inPacking = invoices.filter((i) => i.fulfilmentStatus === 'PROCESSING' || i.fulfilmentStatus === 'PACKED');
  const dispatched = invoices.filter((i) => i.fulfilmentStatus === 'SHIPPED' || i.fulfilmentStatus === 'DELIVERED');

  // Filtered list based on Search & Status
  const filteredOrders = invoices.filter((inv) => {
    // Status filter
    if (filterStatus === 'READY_FOR_PACKING' && inv.fulfilmentStatus !== 'READY_FOR_PACKING') return false;
    if (filterStatus === 'IN_PACKING' && inv.fulfilmentStatus !== 'PROCESSING' && inv.fulfilmentStatus !== 'PACKED') return false;
    if (filterStatus === 'DISPATCHED' && inv.fulfilmentStatus !== 'SHIPPED' && inv.fulfilmentStatus !== 'DELIVERED') return false;

    // Search query filter (matches invoice number, customer company, customer name, SKU, or serials)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchInv = inv.invoiceNumber?.toLowerCase().includes(q);
      const matchCompany = inv.customerCompany?.toLowerCase().includes(q);
      const matchCust = inv.customerName?.toLowerCase().includes(q);
      const matchItem = inv.items?.some(
        (item: any) =>
          item.productName?.toLowerCase().includes(q) ||
          item.productSku?.toLowerCase().includes(q) ||
          item.allocatedSerials?.some((s: string) => s.toLowerCase().includes(q))
      );
      const matchAwb = inv.shippingDetails?.airwayBillNumber?.toLowerCase().includes(q);

      return matchInv || matchCompany || matchCust || matchItem || matchAwb;
    }

    return true;
  });

  const statCards = [
    {
      title: '1. Ready to Pick',
      subtitle: 'Items on shelves',
      value: readyToPick.length,
      icon: Boxes,
      color: 'text-warning',
      bgColor: 'bg-warning-soft',
      borderColor: 'border-warning-border',
      href: '/depot/pick',
      actionText: 'Open Picking Queue',
    },
    {
      title: '2. In Packing',
      subtitle: 'Box & photo station',
      value: inPacking.length,
      icon: Package,
      color: 'text-orange',
      bgColor: 'bg-orange-soft',
      borderColor: 'border-orange/20',
      href: '/depot/pack',
      actionText: 'Open Packing Station',
    },
    {
      title: '3. Dispatched',
      subtitle: 'Courier handover',
      value: dispatched.length,
      icon: Truck,
      color: 'text-primary',
      bgColor: 'bg-primary-soft',
      borderColor: 'border-primary/20',
      href: '/depot/ship',
      actionText: 'View Shipments & AWBs',
    },
  ];

  return (
    <div className="flex flex-col gap-4 sm:gap-6 max-w-6xl mx-auto pb-20 sm:pb-16 px-1 sm:px-0">
      {/* Depot Header */}
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
              <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-ink truncate">
                Depot Operations
              </h1>
            </div>
            <p className="text-[11px] sm:text-sm text-ink-secondary mt-0.5 sm:mt-1 leading-relaxed">
              <strong className="text-primary font-mono text-[10px] sm:text-xs">{currentUser?.assignedDepotName || 'No depot assigned'}</strong>
              <span className="hidden sm:inline"> • Live order queues & quick dispatch</span>
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={loadData}
              className="flex items-center justify-center gap-1.5 h-11 w-11 sm:h-auto sm:w-auto sm:px-3 sm:py-1.5 rounded-full border border-line bg-white text-ink-secondary hover:text-ink text-xs hover:bg-surface active:bg-surface-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <Link
              href="/depot/inventory"
              className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 sm:py-1.5 rounded-full bg-primary hover:bg-primary-hover text-white text-[11px] sm:text-xs font-semibold transition-colors"
            >
              <Layers className="h-3.5 w-3.5 text-white" />
              <span className="hidden xs:inline">Depot</span>
              <span>Inventory</span>
            </Link>
          </div>
        </div>
      </div>

      {/* This depot's numbers (computed on the server, filtered by depot) */}
      <DepotOverview depotId={currentUser?.assignedDepotId} />

      {/* Stat Cards Pipeline — 3-column horizontal scroll on mobile, grid on desktop */}
      <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-1 sm:pb-0 snap-x snap-mandatory -mx-1 px-1 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-3 sm:overflow-visible scrollbar-none">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.title}
              href={stat.href}
              className="min-w-[72%] xs:min-w-[65%] sm:min-w-0 snap-start p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-line bg-white hover:border-primary/40 transition-all group flex flex-col justify-between shadow-xs hover:shadow-md"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] sm:text-xs font-bold font-mono text-muted">{stat.title}</span>
                    <p className="text-2xl sm:text-3xl font-black text-ink mt-0.5 sm:mt-1 font-mono tracking-tight">{stat.value}</p>
                    <p className="text-[10px] sm:text-[11px] text-muted mt-0.5">{stat.subtitle}</p>
                  </div>
                  <div className={`h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl ${stat.bgColor} ${stat.borderColor} border flex items-center justify-center ${stat.color} group-hover:scale-105 transition-transform`}>
                    <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 mt-3 sm:mt-5 pt-2.5 sm:pt-3 border-t border-line text-[11px] sm:text-xs font-semibold text-primary group-hover:text-primary-hover transition-colors">
                <span>{stat.actionText}</span>
                <ArrowRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Search & Filter Toolbar */}
      <div className="p-3 sm:p-5 rounded-2xl sm:rounded-3xl bg-white border border-line flex flex-col gap-2.5 sm:gap-3 shadow-xs">
        {/* Quick Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 sm:left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            type="text"
            placeholder="Search invoice, customer, SKU, serial..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 sm:pl-10 pr-14 py-3 sm:py-2.5 min-h-11 sm:min-h-0 rounded-full bg-surface border border-line text-ink placeholder-muted text-xs focus:border-primary focus:bg-white focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-secondary hover:text-ink bg-line px-2 py-0.5 rounded-full active:bg-line"
            >
              Clear
            </button>
          )}
        </div>

        {/* Quick Filter Tabs — horizontal scroll on mobile */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1 sm:mx-0 sm:px-0">
          <button
            onClick={() => setFilterStatus('ALL')}
            className={`px-3 py-2 min-h-11 sm:min-h-0 inline-flex items-center rounded-full text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-colors shrink-0 active:scale-95 ${
              filterStatus === 'ALL'
                ? 'bg-primary text-white shadow-xs'
                : 'bg-white text-ink-secondary hover:text-ink border border-line hover:bg-surface'
            }`}
          >
            All ({invoices.length})
          </button>
          <button
            onClick={() => setFilterStatus('READY_FOR_PACKING')}
            className={`px-3 py-2 min-h-11 sm:min-h-0 inline-flex items-center rounded-full text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-colors shrink-0 active:scale-95 ${
              filterStatus === 'READY_FOR_PACKING'
                ? 'bg-warning text-white shadow-xs'
                : 'bg-white text-ink-secondary hover:text-warning border border-line hover:bg-surface'
            }`}
          >
            To Pick ({readyToPick.length})
          </button>
          <button
            onClick={() => setFilterStatus('IN_PACKING')}
            className={`px-3 py-2 min-h-11 sm:min-h-0 inline-flex items-center rounded-full text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-colors shrink-0 active:scale-95 ${
              filterStatus === 'IN_PACKING'
                ? 'bg-orange text-white shadow-xs'
                : 'bg-white text-ink-secondary hover:text-orange border border-line hover:bg-surface'
            }`}
          >
            To Pack ({inPacking.length})
          </button>
          <button
            onClick={() => setFilterStatus('DISPATCHED')}
            className={`px-3 py-2 min-h-11 sm:min-h-0 inline-flex items-center rounded-full text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-colors shrink-0 active:scale-95 ${
              filterStatus === 'DISPATCHED'
                ? 'bg-success text-white shadow-xs'
                : 'bg-white text-ink-secondary hover:text-success border border-line hover:bg-surface'
            }`}
          >
            Dispatched ({dispatched.length})
          </button>
        </div>
      </div>

      {/* Orders List — card-based feed */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-line overflow-hidden shadow-xs">
        <div className="px-3.5 py-3 sm:p-5 border-b border-line flex items-center justify-between gap-2 bg-surface/50">
          <h2 className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-muted font-mono">
            Orders Feed ({filteredOrders.length})
          </h2>
          <span className="text-[10px] sm:text-[11px] font-mono text-muted truncate max-w-[45%]">
            {searchQuery ? `"${searchQuery}"` : 'All orders'}
          </span>
        </div>

        {loading ? (
          <div className="text-center py-12 space-y-2">
            <RefreshCw className="h-6 w-6 animate-spin text-primary mx-auto" />
            <p className="text-xs text-muted">Loading orders...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-10 sm:py-12 space-y-2 px-4">
            <CheckCircle2 className="h-8 w-8 sm:h-10 sm:w-10 text-success mx-auto opacity-80" />
            <p className="text-sm font-semibold text-ink">No orders matching search</p>
            <p className="text-[11px] sm:text-xs text-muted max-w-sm mx-auto leading-relaxed">
              Try searching with another invoice number, customer name, SKU code, or serial barcode.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {filteredOrders.map((invoice) => {
              const isToPick = invoice.fulfilmentStatus === 'READY_FOR_PACKING';
              const isToPack = invoice.fulfilmentStatus === 'PROCESSING' || invoice.fulfilmentStatus === 'PACKED';
              const isDispatched = invoice.fulfilmentStatus === 'SHIPPED' || invoice.fulfilmentStatus === 'DELIVERED';

              const nextActionLink = isToPick ? '/depot/pick' : isToPack ? '/depot/pack' : '/depot/ship';
              const nextActionText = isToPick ? 'Pick Items' : isToPack ? 'Pack & Photo' : 'View Tracking';

              return (
                <div
                  key={invoice.id}
                  className="p-3 sm:p-5 hover:bg-surface active:bg-surface-muted transition-colors"
                >
                  {/* Top row: icon + invoice info */}
                  <div className="flex items-start gap-2.5 sm:gap-3.5">
                    <div
                      className={`h-9 w-9 sm:h-11 sm:w-11 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0 ${
                        isToPick
                          ? 'bg-warning-soft text-warning border border-warning-border'
                          : isToPack
                          ? 'bg-orange-soft text-orange border border-orange/20'
                          : 'bg-success-soft text-success border border-success-border'
                      }`}
                    >
                      {isToPick && <Boxes className="h-4 w-4 sm:h-5 sm:w-5" />}
                      {isToPack && <Package className="h-4 w-4 sm:h-5 sm:w-5" />}
                      {isDispatched && <Truck className="h-4 w-4 sm:h-5 sm:w-5" />}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      {/* Invoice number + status badge */}
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <span className="font-mono text-[13px] sm:text-sm font-bold text-ink">
                          {invoice.invoiceNumber}
                        </span>
                        <span
                          className={`px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold font-mono leading-none ${
                            isToPick
                              ? 'bg-warning-soft text-warning border border-warning-border'
                              : isToPack
                              ? 'bg-orange-soft text-orange border border-orange/20'
                              : 'bg-success-soft text-success border border-success-border'
                          }`}
                        >
                          {invoice.fulfilmentStatus}
                        </span>
                      </div>

                      {/* Customer */}
                      <div className="text-[11px] sm:text-xs text-ink font-semibold truncate">
                        {invoice.customerCompany}
                        <span className="text-muted font-normal ml-1.5">
                          ({invoice.items?.length || 0} items)
                        </span>
                      </div>

                      {/* Metadata row */}
                      <div className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-3 gap-y-0.5 text-[10px] sm:text-[11px] font-mono text-muted">
                        <span>Total: <strong className="text-ink">{formatUSD(invoice.grandTotal)}</strong></span>
                        {invoice.shippingDetails?.airwayBillNumber && (
                          <span className="text-primary flex items-center gap-0.5 font-semibold">
                            <Barcode className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                            <span className="truncate max-w-[90px] sm:max-w-none">AWB: {invoice.shippingDetails.airwayBillNumber}</span>
                          </span>
                        )}
                        <span className="hidden xs:inline">Date: {formatDate(invoice.issueDate || invoice.createdAt)}</span>
                      </div>
                    </div>

                    {/* Action Button — visible inline on all sizes */}
                    <Link
                      href={nextActionLink}
                      className={`flex min-h-[44px] items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs font-bold transition-all shrink-0 active:scale-95 ${
                        isToPick
                          ? 'bg-warning hover:bg-warning/90 text-white'
                          : isToPack
                          ? 'bg-orange hover:bg-orange-hover text-white'
                          : 'bg-primary hover:bg-primary-hover text-white'
                      }`}
                    >
                      <span className="hidden sm:inline">{nextActionText}</span>
                      <span className="sm:hidden">{isToPick ? 'Pick' : isToPack ? 'Pack' : 'Track'}</span>
                      <ChevronRight className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
