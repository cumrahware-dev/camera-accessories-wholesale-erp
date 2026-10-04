'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { KeyRound, Pencil, Power, ShieldOff } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button, LinkButton } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { SecretModal } from '@/components/admin/SecretModal';
import { DepotForm, DepotFormValues, DepotRow, depotToForm } from '@/components/admin/DepotForm';
import { ROLE_LABELS, type UserRole } from '@/lib/rbac';
import { useMe } from '@/hooks/useMe';

type Tab = 'overview' | 'users' | 'inventory' | 'orders' | 'shipments' | 'activity';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'users', label: 'Users' }, { key: 'inventory', label: 'Inventory' },
  { key: 'orders', label: 'Orders' }, { key: 'shipments', label: 'Shipments' }, { key: 'activity', label: 'Activity' },
];
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

function DepotDetail() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const { toast } = useToast();
  const { can, loaded } = useMe();
  const [depot, setDepot] = useState<(DepotRow & { stats?: any }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>((search.get('tab') as Tab) || 'overview');
  const [rows, setRows] = useState<any[] | null>(null);
  const [rowsError, setRowsError] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<DepotFormValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [secret, setSecret] = useState<null | { value: string }>(null);
  const [confirm, setConfirm] = useState<null | 'regen' | 'revoke' | 'toggle'>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/depots/${id}`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || 'Could not load this depot.'); return; }
      setDepot(data); setError(null);
    } catch { setError('Something went wrong. Please try again.'); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab === 'overview') return;
    setRows(null); setRowsError('');
    fetch(`/api/depots/${id}/${tab}`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error(j?.error || 'Could not load.'); return j; })
      .then(setRows).catch((e) => setRowsError(e.message));
  }, [tab, id]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true); setFormError('');
    try {
      const res = await fetch(`/api/depots/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFormError(data.error || 'Could not save.'); return; }
      setEditOpen(false); toast({ title: 'Depot updated', variant: 'success' }); await load();
    } finally { setSaving(false); }
  };

  const run = async () => {
    if (!depot || !confirm) return;
    setActing(true);
    try {
      if (confirm === 'toggle') {
        const next = depot.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
        const res = await fetch(`/api/depots/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { toast({ title: 'Could not change status', description: data.error, variant: 'error' }); return; }
        toast({ title: next === 'ACTIVE' ? 'Depot activated' : 'Depot deactivated', variant: 'success' });
      } else {
        const res = await fetch(`/api/depots/${id}/access-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: confirm === 'regen' ? 'regenerate' : 'revoke' }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { toast({ title: 'Action failed', description: data.error, variant: 'error' }); return; }
        if (confirm === 'regen') setSecret({ value: data.accessCode });
        else toast({ title: 'Access code revoked', description: 'This depot cannot sign in until a new code is generated.', variant: 'success' });
      }
      setConfirm(null); await load();
    } finally { setActing(false); }
  };

  if (error) return <ErrorState title="Could not open this depot" description={error} action={<LinkButton href="/depots" variant="outline">Back to depots</LinkButton>} />;
  if (!depot || !loaded) return <div className="py-24 text-center text-xs text-muted">Loading depot…</div>;

  const canManage = can('depots.write');
  const canCode = can('depots.access_code');
  const canDisable = can('depots.disable');
  const s = depot.stats;

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        breadcrumbs={[{ label: 'Depots', href: '/depots' }, { label: depot.name }]}
        title={<span className="inline-flex flex-wrap items-center gap-2.5">{depot.name}<StatusBadge status={depot.status} /></span>}
        description={<><span className="font-mono">{depot.code}</span> · {depot.city}{depot.country && depot.country !== '—' ? `, ${depot.country}` : ''}</>}
        actions={
          <>
            {canManage && <Button variant="outline" size="sm" iconLeft={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setForm(depotToForm(depot)); setFormError(''); setEditOpen(true); }}>Edit</Button>}
            {canDisable && <Button variant="outline" size="sm" iconLeft={<Power className="h-3.5 w-3.5" />} onClick={() => setConfirm('toggle')} className={depot.status === 'ACTIVE' ? 'text-danger' : ''}>{depot.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button>}
          </>
        }
      />

      <div className="flex gap-1 overflow-x-auto border-b border-line -mx-1 px-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px min-h-[44px] ${tab === t.key ? 'border-primary text-primary' : 'border-transparent text-ink-secondary hover:text-ink'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[['Users', s?.users], ['Stock units', s?.stockUnits?.toLocaleString()], ['Active orders', s?.activeOrders], ['Shipped', s?.shipped]].map(([k, v]) => (
                <Card key={String(k)} className="p-4"><div className="text-xs text-muted">{k}</div><div className="text-2xl font-bold font-mono text-ink mt-1">{v ?? 0}</div></Card>
              ))}
            </div>
            <Card className="p-5 space-y-3 text-sm">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Details</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                {[['Address', depot.address], ['Contact person', depot.contactPerson], ['Contact number', depot.phone], ['Email', depot.email], ['Created', `${fmt(depot.createdAt)}${depot.createdByName ? ` by ${depot.createdByName}` : ''}`]].map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-ink break-words">{v || '—'}</dd></div>
                ))}
                {depot.notes && <div className="sm:col-span-2"><dt className="text-xs text-muted">Notes</dt><dd className="text-ink whitespace-pre-wrap">{depot.notes}</dd></div>}
              </dl>
            </Card>
          </div>

          {canCode && (
            <Card className="p-5 space-y-4 h-fit">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> Access code</h3>
                {depot.hasAccessCode ? <Badge tone="success">Active</Badge> : <Badge tone="danger">{depot.accessCodeRevokedAt ? 'Revoked' : 'None'}</Badge>}
              </div>
              <p className="text-xs text-ink-secondary leading-relaxed">
                The code is stored only as a one-way hash, so it cannot be looked up. {depot.hasAccessCode ? `Last generated ${fmt(depot.accessCodeRotatedAt)}.` : 'Generate a new code to let this depot sign in.'}
              </p>
              <div className="flex flex-col gap-2">
                <Button iconLeft={<KeyRound className="h-4 w-4" />} onClick={() => setConfirm('regen')}>{depot.hasAccessCode ? 'Regenerate Access Code' : 'Generate Access Code'}</Button>
                {depot.hasAccessCode && <Button variant="outline" iconLeft={<ShieldOff className="h-4 w-4" />} onClick={() => setConfirm('revoke')} className="text-danger">Revoke Access Code</Button>}
              </div>
            </Card>
          )}
        </div>
      )}

      {tab !== 'overview' && (
        <Card className="overflow-hidden">
          {rowsError && <p className="p-5 text-sm text-danger">{rowsError}</p>}
          {!rowsError && rows === null && <p className="p-5 text-sm text-muted">Loading…</p>}
          {rows && rows.length === 0 && <p className="p-5 text-sm text-muted">Nothing here yet.</p>}
          {rows && rows.length > 0 && <DataList tab={tab} rows={rows} depotId={id} canManageUsers={can('users.read')} />}
        </Card>
      )}

      <Modal open={editOpen} onClose={() => !saving && setEditOpen(false)} title={`Edit ${depot.name}`} size="xl"
        footer={<><Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button><Button type="submit" form="edit-depot" loading={saving}>Save Changes</Button></>}>
        <form id="edit-depot" onSubmit={save} className="space-y-3">
          {formError && <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-3 text-xs text-danger">{formError}</div>}
          {form && <DepotForm form={form} set={(k, v) => setForm((f) => (f ? { ...f, [k]: v } : f))} editing />}
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirm} onClose={() => !acting && setConfirm(null)} onConfirm={run} loading={acting}
        destructive={confirm !== 'toggle' || depot.status === 'ACTIVE'}
        title={confirm === 'regen' ? 'Regenerate access code?' : confirm === 'revoke' ? 'Revoke access code?' : depot.status === 'ACTIVE' ? `Deactivate ${depot.name}?` : `Activate ${depot.name}?`}
        description={confirm === 'regen' ? 'Regenerating this access code will invalidate the current code. Continue?'
          : confirm === 'revoke' ? 'This depot will not be able to sign in until you generate a new code. People signed in now are signed out.'
          : depot.status === 'ACTIVE' ? 'Sign-in stops working and everyone signed in is signed out. Inventory, orders and history are kept.' : 'The depot can sign in again with its current access code.'}
        confirmLabel={confirm === 'regen' ? 'Regenerate' : confirm === 'revoke' ? 'Revoke' : depot.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
      />
      {secret && <SecretModal open onClose={() => setSecret(null)} title={`New access code for ${depot.name}`} label="Access code" value={secret.value} hint="The previous code no longer works." />}
    </div>
  );
}

function DataList({ tab, rows, depotId, canManageUsers }: { tab: Tab; rows: any[]; depotId: string; canManageUsers: boolean }) {
  const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted';
  const td = 'px-4 py-3 text-xs text-ink';
  const wrap = (head: string[], body: React.ReactNode) => (
    <div className="overflow-x-auto"><table className="w-full"><thead className="bg-surface border-b border-line"><tr>{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead><tbody className="divide-y divide-line-soft">{body}</tbody></table></div>
  );
  if (tab === 'users') return (
    <>
      {wrap(['Name', 'Email', 'Role', 'Status', 'Last login'], rows.map((u) => (
        <tr key={u.id}><td className={td}>{u.name}</td><td className={td}>{u.email}</td><td className={td}>{ROLE_LABELS[u.role as UserRole] || u.role}</td><td className={td}><StatusBadge status={u.status} /></td><td className={td}>{fmt(u.lastLogin)}</td></tr>
      )))}
      {canManageUsers && <div className="p-3 border-t border-line-soft text-right"><Link href={`/users?depotId=${depotId}`} className="text-xs font-medium text-primary hover:underline">Manage users →</Link></div>}
    </>
  );
  if (tab === 'inventory') return wrap(['SKU', 'Product', 'On hand', 'Allocated', 'Available'], rows.map((r) => (
    <tr key={r.id}><td className={`${td} font-mono`}>{r.sku}</td><td className={td}>{r.name}<div className="text-[11px] text-muted">{r.brand}</div></td><td className={`${td} font-mono`}>{r.quantity}</td><td className={`${td} font-mono`}>{r.allocatedQuantity}</td><td className={`${td} font-mono`}>{r.availableQuantity}</td></tr>
  )));
  if (tab === 'orders') return wrap(['Invoice', 'Customer', 'Fulfilment', 'Date'], rows.map((o) => (
    <tr key={o.id}><td className={td}><Link className="text-primary font-medium hover:underline" href={`/invoices/${o.id}`}>{o.invoiceNumber}</Link></td><td className={td}>{o.customerCompany}</td><td className={td}><StatusBadge status={o.fulfilmentStatus} /></td><td className={td}>{fmt(o.createdAt)}</td></tr>
  )));
  if (tab === 'shipments') return wrap(['Shipment', 'Invoice', 'Courier', 'AWB', 'Status'], rows.map((r) => (
    <tr key={r.id}><td className={`${td} font-mono`}>{r.shipmentNumber}</td><td className={td}>{r.invoice?.invoiceNumber}</td><td className={td}>{String(r.courier).replace(/_/g, ' ')}</td><td className={`${td} font-mono`}>{r.airwayBillNumber}</td><td className={td}><StatusBadge status={r.status} /></td></tr>
  )));
  return wrap(['When', 'Who', 'Action', 'Details'], rows.map((a) => (
    <tr key={a.id}><td className={`${td} whitespace-nowrap`}>{fmt(a.timestamp)}</td><td className={td}>{a.userName}</td><td className={`${td} font-mono`}>{a.action}</td><td className={td}>{a.description}</td></tr>
  )));
}

export default function DepotDetailPage() {
  return <Suspense fallback={null}><DepotDetail /></Suspense>;
}
