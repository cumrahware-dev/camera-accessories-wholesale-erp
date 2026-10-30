'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Truck, Pencil, Power, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, SearchInput, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { Carrier, CarrierType } from '@/types/erp';

const TYPE_OPTIONS: { label: string; value: CarrierType }[] = [
  { label: 'Air Cargo', value: 'AIR_CARGO' },
  { label: 'Courier', value: 'COURIER' },
  { label: 'Sea Freight', value: 'SEA_FREIGHT' },
  { label: 'Road Transport', value: 'ROAD_TRANSPORT' },
  { label: 'Other', value: 'OTHER' },
];
const typeLabel = (t: string) => TYPE_OPTIONS.find((o) => o.value === t)?.label || t;

const emptyForm = { name: '', type: 'COURIER' as CarrierType, code: '', contactPerson: '', contactNumber: '', email: '', website: '', trackingUrlTemplate: '', address: '', remarks: '' };

export default function CarrierManagementPage() {
  const { toast } = useToast();
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Carrier | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/carriers', { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Could not load carriers.');
      setCarriers(await res.json());
    } catch (e: any) {
      setError(e.message || 'Could not load carriers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return carriers.filter((c) => {
      if (statusFilter === 'ACTIVE' && !c.isActive) return false;
      if (statusFilter === 'INACTIVE' && c.isActive) return false;
      if (q && !`${c.name} ${c.code || ''} ${c.contactPerson || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [carriers, query, statusFilter]);
  const active = carriers.filter((c) => c.isActive);
  const inactive = carriers.filter((c) => !c.isActive);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setFormError(''); setModalOpen(true); };
  const openEdit = (c: Carrier) => {
    setEditing(c);
    setForm({
      name: c.name, type: c.type, code: c.code || '', contactPerson: c.contactPerson || '', contactNumber: c.contactNumber || '',
      email: c.email || '', website: c.website || '', trackingUrlTemplate: c.trackingUrlTemplate || '', address: c.address || '', remarks: c.remarks || '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { setFormError('Carrier name is required.'); return; }
    // Duplicate protection: block an obvious duplicate client-side too, not only on the server.
    const dup = carriers.find((c) => c.name.trim().toLowerCase() === form.name.trim().toLowerCase() && c.id !== editing?.id);
    if (dup) { setFormError(`A carrier named "${form.name.trim()}" already exists.`); return; }
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch(editing ? `/api/carriers/${editing.id}` : '/api/carriers', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not save the carrier.');
      toast({ title: editing ? 'Carrier updated' : 'Carrier added', description: form.name, variant: 'success' });
      setModalOpen(false);
      load();
    } catch (e: any) {
      setFormError(e.message || 'Could not save the carrier.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c: Carrier) => {
    setTogglingId(c.id);
    try {
      const res = await fetch(`/api/carriers/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !c.isActive }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not update the carrier.');
      toast({ title: c.isActive ? 'Carrier deactivated' : 'Carrier activated', description: c.name, variant: 'success' });
      load();
    } catch (e: any) {
      toast({ title: 'Could not update the carrier', description: e.message, variant: 'error' });
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Carrier Management"
        description="Couriers and freight carriers used across shipment dispatch. Add a carrier here once, then pick it on any shipment — no code changes needed."
        actions={<Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>Add Carrier</Button>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 border border-line rounded-2xl divide-x divide-line bg-surface overflow-hidden">
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Total Carriers</div>
          <div className="text-2xl font-semibold text-ink mt-1.5">{carriers.length}</div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Active</div>
          <div className="text-2xl font-semibold text-success mt-1.5">{active.length}</div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Inactive</div>
          <div className="text-2xl font-semibold text-muted mt-1.5">{inactive.length}</div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <SearchInput placeholder="Search by name, code or contact..." value={query} onChange={(e) => setQuery(e.target.value)} wrapperClassName="w-full sm:w-96" />
        <div className="flex gap-2">
          {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 min-h-11 sm:min-h-0 rounded-xl text-xs font-semibold border ${statusFilter === s ? 'bg-primary text-white border-primary' : 'bg-white text-ink-secondary border-line hover:bg-surface'}`}
            >
              {s === 'ALL' ? 'All' : s === 'ACTIVE' ? 'Active' : 'Inactive'}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted sm:ml-auto">{filtered.length} carriers</span>
      </div>

      {loading ? (
        <SkeletonTable rows={5} cols={5} />
      ) : error ? (
        <ErrorState description={error} action={<Button onClick={load}>Try Again</Button>} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={carriers.length === 0 ? 'No carriers yet' : 'No matching carriers'}
          description={carriers.length === 0 ? 'Add a carrier (e.g. Cathay Cargo) so it can be selected when dispatching shipments.' : 'No carriers match your search or filter.'}
          action={carriers.length === 0 && <Button onClick={openCreate}>Add Carrier</Button>}
        />
      ) : (
        <Card className="overflow-hidden p-0 border-0 rounded-none bg-transparent">
          <Table>
            <TableHeader>
              <TableHead>Carrier</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Tracking</TableHead>
              <TableHead align="center">Status</TableHead>
              <TableHead align="right">Actions</TableHead>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-semibold text-ink">{c.name}</div>
                    {c.code && <div className="text-xs text-muted font-mono mt-0.5">{c.code}</div>}
                  </TableCell>
                  <TableCell className="text-muted">{typeLabel(c.type)}</TableCell>
                  <TableCell>
                    <div className="text-sm text-ink">{c.contactPerson || <span className="text-muted">—</span>}</div>
                    <div className="text-xs text-muted">{[c.contactNumber, c.email].filter(Boolean).join(' · ')}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted">{c.trackingUrlTemplate ? 'Tracking URL configured' : 'No tracking URL template'}</TableCell>
                  <TableCell align="center">
                    <Badge tone={c.isActive ? 'success' : 'neutral'}>{c.isActive ? 'Active' : 'Inactive'}</Badge>
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" iconLeft={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(c)}>Edit</Button>
                      <Button size="sm" variant="outline" loading={togglingId === c.id} iconLeft={<Power className="h-3.5 w-3.5" />} onClick={() => toggleActive(c)}>
                        {c.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add Carrier'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={save} loading={saving}>{editing ? 'Save Changes' : 'Add Carrier'}</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && <div className="text-sm text-danger bg-danger-soft border border-danger-border rounded-lg px-3 py-2">{formError}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Carrier Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cathay Cargo" />
            <Select label="Carrier Type" options={TYPE_OPTIONS} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CarrierType })} />
            <Input label="Carrier Code" hint="Optional" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. CX" />
            <Input label="Contact Person" hint="Optional" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
            <Input label="Contact Number" hint="Optional" value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} />
            <Input label="Email" hint="Optional" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input label="Website" hint="Optional" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://..." />
            <Input
              label="Tracking URL Template"
              hint="Optional — use {awb} where the AWB number goes"
              value={form.trackingUrlTemplate}
              onChange={(e) => setForm({ ...form, trackingUrlTemplate: e.target.value })}
              placeholder="https://example.com/track?awb={awb}"
            />
          </div>
          <Textarea label="Address" hint="Optional" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} />
          <Textarea label="Remarks" hint="Optional" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={2} />
        </div>
      </Modal>
    </div>
  );
}
