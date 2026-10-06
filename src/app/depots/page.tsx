'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, KeyRound, MoreHorizontal, Pencil, Plus, Power, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button, LinkButton } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { SecretModal } from '@/components/admin/SecretModal';
import { DepotForm, DepotFormValues, DepotRow, EMPTY_DEPOT_FORM, depotToForm } from '@/components/admin/DepotForm';
import { useMe } from '@/hooks/useMe';

export default function DepotsPage() {
  const { toast } = useToast();
  const { can, loaded } = useMe();
  const [depots, setDepots] = useState<DepotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState<null | { editing: DepotRow | null }>(null);
  const [form, setForm] = useState<DepotFormValues>(EMPTY_DEPOT_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [secret, setSecret] = useState<null | { title: string; value: string; hint: string }>(null);
  const [regen, setRegen] = useState<DepotRow | null>(null);
  const [toggle, setToggle] = useState<DepotRow | null>(null);
  const [acting, setActing] = useState(false);

  const canManage = can('depots.write');
  const canCode = can('depots.access_code');
  const canDisable = can('depots.disable');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/depots', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || 'Could not load depots.'); return; }
      setDepots(Array.isArray(data) ? data : []);
    } catch { setError('Something went wrong. Please try again.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(EMPTY_DEPOT_FORM); setFormError(''); setFormOpen({ editing: null }); };
  const openEdit = (d: DepotRow) => {
    setForm(depotToForm(d));
    setFormError(''); setFormOpen({ editing: d });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formOpen) return;
    setSaving(true); setFormError('');
    try {
      const editing = formOpen.editing;
      const res = await fetch(editing ? `/api/depots/${editing.id}` : '/api/depots', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFormError(data.error || 'Could not save the depot.'); return; }
      setFormOpen(null);
      if (!editing && data.accessCode) {
        setSecret({ title: `${data.name} created`, value: data.accessCode, hint: `Give this to the ${data.name} team. They sign in at /depot-login. If it is lost, generate a new one.` });
      } else {
        toast({ title: 'Depot updated', variant: 'success' });
      }
      await load();
    } catch { setFormError('Something went wrong. Please try again.'); }
    finally { setSaving(false); }
  };

  const doRegenerate = async () => {
    if (!regen) return;
    setActing(true);
    try {
      const res = await fetch(`/api/depots/${regen.id}/access-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'regenerate' }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: 'Could not regenerate', description: data.error, variant: 'error' }); return; }
      const name = regen.name;
      setRegen(null);
      setSecret({ title: `New access code for ${name}`, value: data.accessCode, hint: 'The previous code no longer works. Anyone signed in with it has been signed out.' });
      await load();
    } finally { setActing(false); }
  };

  const doToggle = async () => {
    if (!toggle) return;
    setActing(true);
    try {
      const next = toggle.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      const res = await fetch(`/api/depots/${toggle.id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: 'Could not change status', description: data.error, variant: 'error' }); return; }
      toast({ title: next === 'ACTIVE' ? 'Depot activated' : 'Depot deactivated', description: next === 'ACTIVE' ? undefined : 'Sign-in is blocked. All data is kept.', variant: 'success' });
      setToggle(null);
      await load();
    } finally { setActing(false); }
  };

  if (loading || !loaded) return <div className="space-y-4"><div className="h-10" /><SkeletonTable /></div>;
  if (error) return <ErrorState title="Could not load depots" description={error} action={<Button variant="outline" onClick={() => { setLoading(true); load(); }}>Retry</Button>} />;

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title={canManage ? 'Depot Management' : 'Depots'}
        description="Warehouses that hold stock and fulfil orders. Each depot signs in with its own access code and only ever sees its own data. Active depots appear immediately in every Dispatch Depot list."
        actions={canManage ? <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>Add New Depot</Button> : undefined}
      />

      {!canManage && (
        <div role="note" className="rounded-xl border border-warning-border bg-warning-soft p-3 text-sm text-ink">
          <b>You can view depots but not create them.</b> Only a Super Admin can create or edit depots. Sign in with the Super Admin access code (or ask a Super Admin) to add one. Until at least one active depot exists, the Dispatch Depot list on a Proforma will be empty.
        </div>
      )}

      {depots.length === 0 ? (
        <EmptyState icon={Building2} title="No depots yet"
          description={canManage ? 'Create your first depot. Its access code is generated automatically.' : 'No depots have been set up yet. A Super Admin needs to create the first one.'}
          action={canManage ? <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>Add New Depot</Button> : undefined} />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block overflow-hidden">
            <Table>
              <TableHeader>
                  <TableHead>Depot</TableHead><TableHead>Code</TableHead><TableHead>Location</TableHead>
                  <TableHead align="right">Users</TableHead><TableHead align="right">Inventory</TableHead>
                  <TableHead>Status</TableHead><TableHead align="right">Actions</TableHead>
              </TableHeader>
              <TableBody>
                {depots.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link href={`/depots/${d.id}`} className="font-semibold text-primary hover:underline">{d.name}</Link>
                      <div className="text-[11px] text-muted">{d.contactPerson}</div>
                    </TableCell>
                    <TableCell><span className="font-mono text-xs">{d.code}</span></TableCell>
                    <TableCell className="text-xs text-ink-secondary">{d.city}{d.country && d.country !== '—' ? `, ${d.country}` : ''}</TableCell>
                    <TableCell align="right" className="font-mono text-xs">{d.userCount ?? '—'}</TableCell>
                    <TableCell align="right" className="font-mono text-xs">{d.totalStockUnits.toLocaleString()} units</TableCell>
                    <TableCell>
                      <StatusBadge status={d.status} />
                      {canManage && d.hasAccessCode === false && <div className="mt-1"><Badge tone="warning">No access code</Badge></div>}
                    </TableCell>
                    <TableCell align="right">
                      <RowActions d={d} canManage={canManage} canCode={canCode} canDisable={canDisable} onEdit={openEdit} onRegen={setRegen} onToggle={setToggle} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden grid gap-3">
            {depots.map((d) => (
              <Card key={d.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/depots/${d.id}`} className="font-semibold text-primary">{d.name}</Link>
                    <div className="text-xs text-muted"><span className="font-mono">{d.code}</span> · {d.city}</div>
                  </div>
                  <StatusBadge status={d.status} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-surface p-2"><div className="text-muted">Users</div><div className="font-mono font-semibold">{d.userCount ?? '—'}</div></div>
                  <div className="rounded-lg bg-surface p-2"><div className="text-muted">Inventory</div><div className="font-mono font-semibold">{d.totalStockUnits.toLocaleString()} units</div></div>
                </div>
                <div className="flex justify-end">
                  <RowActions d={d} canManage={canManage} canCode={canCode} canDisable={canDisable} onEdit={openEdit} onRegen={setRegen} onToggle={setToggle} />
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <Modal
        open={!!formOpen}
        onClose={() => !saving && setFormOpen(null)}
        title={formOpen?.editing ? `Edit ${formOpen.editing.name}` : 'Add New Depot'}
        description={formOpen?.editing ? undefined : 'A unique access code is generated automatically when you save.'}
        size="xl"
        footer={<><Button variant="outline" onClick={() => setFormOpen(null)} disabled={saving}>Cancel</Button><Button type="submit" form="depot-form" loading={saving}>{formOpen?.editing ? 'Save Changes' : 'Create Depot'}</Button></>}
      >
        <form id="depot-form" onSubmit={save} className="space-y-3">
          {formError && <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-3 text-xs text-danger">{formError}</div>}
          <DepotForm form={form} set={(k, v) => setForm((f) => ({ ...f, [k]: v }))} editing={!!formOpen?.editing} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!regen}
        onClose={() => !acting && setRegen(null)}
        onConfirm={doRegenerate}
        title="Regenerate access code?"
        description="Regenerating this access code will invalidate the current code. Continue?"
        confirmLabel="Regenerate"
        cancelLabel="Cancel"
        destructive
        loading={acting}
      />
      <ConfirmDialog
        open={!!toggle}
        onClose={() => !acting && setToggle(null)}
        onConfirm={doToggle}
        title={toggle?.status === 'ACTIVE' ? `Deactivate ${toggle?.name}?` : `Activate ${toggle?.name}?`}
        description={toggle?.status === 'ACTIVE'
          ? 'Sign-in for this depot will stop working and anyone signed in will be signed out. Inventory, orders and history are kept.'
          : 'The depot will be able to sign in again with its current access code.'}
        confirmLabel={toggle?.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
        destructive={toggle?.status === 'ACTIVE'}
        loading={acting}
      />
      {secret && <SecretModal open onClose={() => setSecret(null)} title={secret.title} label="Access code" value={secret.value} hint={secret.hint} />}
    </div>
  );
}

function RowActions({ d, canManage, canCode, canDisable, onEdit, onRegen, onToggle }: {
  d: DepotRow; canManage: boolean; canCode: boolean; canDisable: boolean;
  onEdit: (d: DepotRow) => void; onRegen: (d: DepotRow) => void; onToggle: (d: DepotRow) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <LinkButton href={`/depots/${d.id}`} size="sm" variant="outline">View</LinkButton>
      {(canManage || canCode || canDisable) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent>
            {canManage && <DropdownMenuItem onSelect={() => onEdit(d)}><Pencil className="h-3.5 w-3.5" /> Edit</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => { window.location.href = `/depots/${d.id}?tab=users`; }}><Users className="h-3.5 w-3.5" /> Manage Users</DropdownMenuItem>
            {(canCode || canDisable) && <DropdownMenuSeparator />}
            {canCode && <DropdownMenuItem onSelect={() => onRegen(d)}><KeyRound className="h-3.5 w-3.5" /> Regenerate Code</DropdownMenuItem>}
            {canDisable && (
              <DropdownMenuItem destructive={d.status === 'ACTIVE'} onSelect={() => onToggle(d)}>
                <Power className="h-3.5 w-3.5" /> {d.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
