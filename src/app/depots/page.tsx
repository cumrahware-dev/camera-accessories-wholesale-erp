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
  Plus,
} from 'lucide-react';
import { formatUSD } from '@/lib/utils';
import { Depot } from '@/types/erp';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button, LinkButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useCan } from '@/components/ocr/parts';
import { hasPermission } from '@/lib/rbac';

const EMPTY_FORM = { name: '', code: '', address: '', city: '', country: '', contactPerson: '', phone: '', email: '' };

export default function DepotsPage() {
  const [depots, setDepots] = useState<Depot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const canCreate = hasPermission(useCan(), 'depots.write');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const setField = (k: keyof typeof EMPTY_FORM, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const createDepot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch('/api/depots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || 'Could not create the depot.');
        return;
      }
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      toast({ title: 'Depot created', description: `${data.name} (${data.code}) is ready to use.`, variant: 'success' });
      await loadData();
    } catch {
      setFormError('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

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
          <>
            {canCreate && (
              <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => { setFormError(null); setCreateOpen(true); }}>
                New Depot
              </Button>
            )}
            <LinkButton href="/depot" variant={canCreate ? 'outline' : 'primary'} iconLeft={<Building2 className="h-4 w-4" />}>
              Open Depot Queue
            </LinkButton>
          </>
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

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New Depot"
        description="Register a warehouse hub. Stock and users can be assigned to it afterwards."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" form="new-depot-form" loading={saving}>Create Depot</Button>
          </>
        }
      >
        <form id="new-depot-form" onSubmit={createDepot} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {formError && (
            <div role="alert" className="sm:col-span-2 rounded-xl border border-danger-border bg-danger-soft p-3 text-xs text-danger">{formError}</div>
          )}
          <Input id="depot-name" label="Depot name" required value={form.name} onChange={(e) => setField('name', e.target.value)} />
          <Input id="depot-code" label="Code" required value={form.code} onChange={(e) => setField('code', e.target.value.toUpperCase())} hint="Short unique code, e.g. DXB" maxLength={12} />
          <Input id="depot-address" label="Address" required wrapperClassName="sm:col-span-2" value={form.address} onChange={(e) => setField('address', e.target.value)} />
          <Input id="depot-city" label="City" required value={form.city} onChange={(e) => setField('city', e.target.value)} />
          <Input id="depot-country" label="Country" required value={form.country} onChange={(e) => setField('country', e.target.value)} />
          <Input id="depot-contact" label="Contact person" required value={form.contactPerson} onChange={(e) => setField('contactPerson', e.target.value)} />
          <Input id="depot-phone" label="Phone" type="tel" required value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
          <Input id="depot-email" label="Email" type="email" required wrapperClassName="sm:col-span-2" value={form.email} onChange={(e) => setField('email', e.target.value)} />
        </form>
      </Modal>
    </div>
  );
}
