'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Building2,
  Users,
  MapPin,
  Phone,
  Mail,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import { formatUSD } from '@/lib/utils';
import { Depot } from '@/types/erp';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button, LinkButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

export default function DepotsPage() {
  const [depots, setDepots] = useState<Depot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/depots');
      if (res.ok) {
        const data = await res.json();
        setDepots(Array.isArray(data) ? data : []);
      } else {
        setError('Failed to load depots');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-muted text-xs font-medium">Loading depot hub network...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Fulfilment Depots"
        description="Warehouse network managing physical stock, pick/pack operations, and courier dispatches."
        actions={
          <LinkButton href="/depot" iconLeft={<Building2 className="h-4 w-4" />}>
            Open Depot Queue
          </LinkButton>
        }
      />

      {error && (
        <div className="p-3 rounded-2xl bg-danger-soft border border-danger-border text-danger text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Depots Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {depots.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No Depots Configured"
            description="Active warehouse hubs will appear here once registered."
            className="col-span-full"
          />
        ) : (
          depots.map((d) => (
            <Card
              key={d.id}
              className="p-6 space-y-4 flex flex-col justify-between hover:border-primary/40 transition-all"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-primary-soft text-primary">
                      {d.code} {d.isCentralHub ? '· CENTRAL HQ' : ''}
                    </span>
                    <h3 className="text-lg font-bold text-ink mt-1.5">{d.name}</h3>
                    <p className="text-xs text-muted flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3.5 w-3.5 text-muted" />
                      <span>{d.city}, {d.country}</span>
                    </p>
                  </div>

                  <div className="text-right font-mono">
                    <div className="text-xs text-muted">Stock Value</div>
                    <div className="text-sm font-bold text-ink">
                      {formatUSD(d.totalStockValue)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-4 p-3 rounded-lg bg-surface border border-line-soft text-xs font-mono">
                  <div>
                    <span className="text-muted block text-[10px] uppercase font-sans font-semibold">Physical Units</span>
                    <span className="text-ink font-bold text-sm">{d.totalStockUnits} Units</span>
                  </div>
                  <div>
                    <span className="text-muted block text-[10px] uppercase font-sans font-semibold">In Fulfilment</span>
                    <span className="text-warning font-bold text-sm">{d.activeOrdersCount || 0} Orders</span>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-ink-secondary mt-4 pt-3 border-t border-line-soft">
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-muted" />
                    <span>Manager: <strong>{d.contactPerson}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-muted" />
                    <span>{d.phone}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-muted" />
                    <span>{d.email}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-line-soft flex items-center justify-between">
                <span className="text-[11px] text-muted font-mono truncate max-w-[240px]">
                  {d.address}
                </span>
                <Link
                  href="/depot"
                  className="text-xs text-primary hover:underline font-semibold flex items-center gap-1 shrink-0 min-h-[44px] md:min-h-0"
                >
                  <span>Open Depot Queue</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
