'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingCart, FileCheck2, Receipt, Truck, CheckCircle2, ArrowRight } from 'lucide-react';
import { formatUSD } from '@/lib/utils';
import { TaxInvoice, Proforma } from '@/types/erp';
import { PageHeader } from '@/components/ui/PageHeader';
import { LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { SearchInput } from '@/components/ui/Input';
import { useDebounce } from '@/hooks/useDebounce';

interface StageConfig {
  key: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STAGES: StageConfig[] = [
  { key: 'proformas', label: 'Open Proformas', description: 'Awaiting customer confirmation', icon: FileCheck2 },
  { key: 'packing', label: 'To Fulfil', description: 'Invoiced, awaiting pick & pack', icon: Receipt },
  { key: 'transit', label: 'In Transit', description: 'Dispatched to customer', icon: Truck },
  { key: 'delivered', label: 'Delivered', description: 'Completed orders', icon: CheckCircle2 },
];

import { fetchWithCache, fetchCurrentUserCached } from '@/lib/client-cache';

export default function OrdersPipelinePage() {
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [proformas, setProformas] = useState<Proforma[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [loading, setLoading] = useState(true);

  const loadData = async (force = false, query = '') => {
    try {
      const q = query.trim();
      const invUrl = q ? `/api/invoices?q=${encodeURIComponent(q)}` : '/api/invoices';
      const pfUrl = q ? `/api/proformas?q=${encodeURIComponent(q)}` : '/api/proformas';

      const me = await fetchCurrentUserCached().catch(() => null);
      const canSeeProformas = me?.user?.role !== 'DEPOT_USER';
      const [invRes, pfRes] = await Promise.all([
        fetchWithCache<TaxInvoice[]>(invUrl, undefined, force ? 0 : 5000),
        // Depot has no proforma access; skip the request instead of triggering a 403.
        canSeeProformas
          ? fetchWithCache<Proforma[]>(pfUrl, undefined, force ? 0 : 5000).catch(() => [] as Proforma[])
          : Promise.resolve([] as Proforma[]),
      ]);
      setInvoices(Array.isArray(invRes) ? invRes : []);
      setProformas(Array.isArray(pfRes) ? pfRes : []);
    } catch {
      setInvoices([]);
      setProformas([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(true, debouncedSearch);
  }, [debouncedSearch]);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/events');
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (['PROFORMA_UPDATED', 'PROFORMA_CONFIRMED', 'INVOICE_CREATED'].includes(payload.type)) {
            loadData(true);
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (eventSource) eventSource.close();
    };
  }, []);

  const openProformas = proformas.filter((p) => p.status !== 'CONVERTED');
  const toFulfil = invoices.filter((i) =>
    ['READY_FOR_PACKING', 'PROCESSING', 'PACKED'].includes(i.fulfilmentStatus)
  );
  const inTransit = invoices.filter((i) => i.fulfilmentStatus === 'SHIPPED');
  const delivered = invoices.filter((i) => i.fulfilmentStatus === 'DELIVERED');

  const stageData: Record<string, { count: number; items: any[] }> = {
    proformas: { count: openProformas.length, items: openProformas },
    packing: { count: toFulfil.length, items: toFulfil },
    transit: { count: inTransit.length, items: inTransit },
    delivered: { count: delivered.length, items: delivered },
  };

  const totalInPipeline = openProformas.length + toFulfil.length + inTransit.length;

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Order Pipeline"
        description="Every live order from quotation through dispatch and delivery."
      />

      <div className="max-w-md">
        <SearchInput
          placeholder="Search by order #, invoice #, or customer..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {STAGES.map((s) => (
            <SkeletonCard key={s.key} className="h-64" />
          ))}
        </div>
      ) : totalInPipeline === 0 && delivered.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="Nothing in the pipeline yet"
          description="Create a proforma and confirm it to start moving an order through the fulfilment pipeline."
          action={<LinkButton href="/proformas/new">Create Proforma</LinkButton>}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {STAGES.map((stage) => {
            const Icon = stage.icon;
            const data = stageData[stage.key];
            return (
              <div key={stage.key} className="flex flex-col rounded-2xl border border-line bg-surface overflow-hidden">
                <div className="px-4 py-3.5 border-b border-line">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <h2 className="text-sm font-semibold text-ink">{stage.label}</h2>
                    </div>
                    <span className="text-sm font-semibold text-ink">{data.count}</span>
                  </div>
                  <p className="text-xs text-muted mt-1">{stage.description}</p>
                </div>

                <div className="flex-1 p-3 space-y-2 min-h-[8rem]">
                  {data.items.length === 0 ? (
                    <div className="flex h-full items-center justify-center py-6">
                      <span className="text-xs text-muted">Nothing here</span>
                    </div>
                  ) : (
                    data.items.slice(0, 8).map((item: any) => {
                      const isProforma = stage.key === 'proformas';
                      const href = isProforma ? `/proformas/${item.id}` : `/invoices/${item.id}`;
                      const number = isProforma ? item.proformaNumber : item.invoiceNumber;
                      const status = isProforma ? item.status : item.fulfilmentStatus;
                      return (
                        <Link
                          key={item.id}
                          href={href}
                          className="block rounded-xl border border-line bg-surface px-3 py-2.5 hover:border-primary transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-semibold text-primary truncate">{number}</span>
                            <span className="font-mono text-xs text-ink shrink-0">
                              {formatUSD(item.grandTotal)}
                            </span>
                          </div>
                          <div className="text-xs text-ink mt-1 truncate">{item.customerCompany}</div>
                          <div className="mt-2">
                            <StatusBadge status={status} />
                          </div>
                        </Link>
                      );
                    })
                  )}
                  {data.items.length > 8 && (
                    <Link
                      href={stage.key === 'proformas' ? '/proformas' : '/invoices'}
                      className="flex items-center justify-center gap-1 py-2 text-xs font-medium text-primary hover:underline"
                    >
                      View all {data.items.length} <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
