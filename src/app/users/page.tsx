'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { KeyRound, MoreHorizontal, Pencil, Plus, Power } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { Input, SearchInput, Select } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';
import { useToast } from '@/components/ui/Toast';
import { SecretModal } from '@/components/admin/SecretModal';
import { useMe } from '@/hooks/useMe';
import { ALL_ROLES, ROLE_LABELS, isDepotRole, listPermissions, type UserRole } from '@/lib/rbac';

interface UserRow {
  id: string; name: string; email: string; phone: string; role: UserRole; status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  assignedDepotId: string | null; assignedDepotName: string | null; lastLogin: string | null; createdAt: string; createdByName: string | null; permissionRevokes: string[];
}
interface DepotOpt { id: string; name: string; code: string; status: string }

const EMPTY = { name: '', email: '', phone: '', role: 'DEPOT_STAFF' as UserRole, depotId: '', status: 'ACTIVE', revokes: [] as string[] };
const ROLE_TONE: Record<string, 'primary' | 'info' | 'warning' | 'neutral'> = { SUPER_ADMIN: 'primary', MANAGER: 'info', ERP_USER: 'neutral', VIEWER: 'neutral' };
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never');
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', INACTIVE: 'Inactive', SUSPENDED: 'Suspended' };

function UsersInner() {
  const { toast } = useToast();
  const search = useSearchParams();
  const { me, can, loaded } = useMe();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [depots, setDepots] = useState<DepotOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);
  const [roleF, setRoleF] = useState('');
  const [depotF, setDepotF] = useState(search.get('depotId') || '');
  const [statusF, setStatusF] = useState('');

  const [formOpen, setFormOpen] = useState<null | { editing: UserRow | null }>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [secret, setSecret] = useState<null | { title: string; value: string; hint: string }>(null);
  const [disable, setDisable] = useState<UserRow | null>(null);
  const [reset, setReset] = useState<UserRow | null>(null);
  const [adminPw, setAdminPw] = useState('');
  const [acting, setActing] = useState(false);
  const [actError, setActError] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const p = new URLSearchParams();
    if (dq) p.set('q', dq);
    if (roleF) p.set('role', roleF);
    if (depotF) p.set('depotId', depotF);
    if (statusF) p.set('status', statusF);
    try {
      const [u, d] = await Promise.all([fetch(`/api/users?${p}`, { cache: 'no-store' }), fetch('/api/depots', { cache: 'no-store' })]);
      const ud = await u.json().catch(() => null);
      if (!u.ok) { setError(ud?.error || 'Could not load users.'); return; }
      setUsers(ud);
      const dd = await d.json().catch(() => []);
      setDepots(Array.isArray(dd) ? dd : []);
    } catch { setError('Something went wrong. Please try again.'); }
    finally { setLoading(false); }
  }, [dq, roleF, depotF, statusF]);
  useEffect(() => { load(); }, [load]);

  const canCreate = can('users.write');
  const canDisable = can('users.disable');
  const depotName = (id: string | null) => depots.find((d) => d.id === id)?.name;

  const roleOptions = useMemo(
    () => ALL_ROLES.filter((r) => r !== 'DEPOT_USER' || formOpen?.editing?.role === 'DEPOT_USER').map((r) => ({ label: ROLE_LABELS[r], value: r })),
    [formOpen]
  );
  const revocable = useMemo(() => (form.role === 'SUPER_ADMIN' ? [] : listPermissions(form.role)), [form.role]);

  const openCreate = () => { setForm({ ...EMPTY, depotId: depotF }); setFormError(''); setFormOpen({ editing: null }); };
  const openEdit = (u: UserRow) => {
    setForm({ name: u.name, email: u.email, phone: u.phone || '', role: u.role, depotId: u.assignedDepotId || '', status: u.status, revokes: u.permissionRevokes || [] });
    setFormError(''); setFormOpen({ editing: u });
  };

  const needsDepot = isDepotRole(form.role);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formOpen) return;
    setSaving(true); setFormError('');
    try {
      const editing = formOpen.editing;
      const body: any = { name: form.name, email: form.email, phone: form.phone, role: form.role, status: form.status, depotId: needsDepot || form.role === 'VIEWER' ? form.depotId : '', permissionRevokes: form.revokes };
      const res = await fetch(editing ? `/api/users/${editing.id}` : '/api/users', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFormError(data.error || 'Could not save the user.'); return; }
      setFormOpen(null);
      if (!editing && data.temporaryPassword) {
        setSecret({ title: `${data.name} created`, value: data.temporaryPassword, hint: `They sign in with ${data.email} and this temporary password, then change it from their profile menu.` });
      } else toast({ title: 'User saved', variant: 'success' });
      await load();
    } catch { setFormError('Something went wrong. Please try again.'); }
    finally { setSaving(false); }
  };

  const setStatus = async (u: UserRow, status: string) => {
    setActing(true);
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: 'Could not update', description: data.error, variant: 'error' }); return; }
      toast({ title: status === 'ACTIVE' ? 'User enabled' : 'User disabled', description: status === 'ACTIVE' ? undefined : 'They were signed out. Their records are kept.', variant: 'success' });
      setDisable(null); await load();
    } finally { setActing(false); }
  };

  const doReset = async () => {
    if (!reset) return;
    setActing(true); setActError('');
    try {
      const res = await fetch(`/api/users/${reset.id}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: adminPw }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setActError(data.error || 'Could not reset the password.'); return; }
      const name = reset.name;
      setReset(null); setAdminPw('');
      setSecret({ title: `Password reset for ${name}`, value: data.temporaryPassword, hint: 'They have been signed out everywhere. Give them this temporary password.' });
    } finally { setActing(false); }
  };

  if (loading || !loaded) return <div className="space-y-4"><div className="h-10" /><SkeletonTable /></div>;
  if (error) return <ErrorState title="Could not load users" description={error} action={<Button variant="outline" onClick={() => { setLoading(true); load(); }}>Retry</Button>} />;

  const Actions = ({ u }: { u: UserRow }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label="Actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent>
        {canCreate && <DropdownMenuItem onSelect={() => openEdit(u)}><Pencil className="h-3.5 w-3.5" /> Edit / Change role or depot</DropdownMenuItem>}
        {canCreate && <DropdownMenuItem onSelect={() => { setReset(u); setAdminPw(''); setActError(''); }}><KeyRound className="h-3.5 w-3.5" /> Reset password</DropdownMenuItem>}
        {canDisable && <DropdownMenuSeparator />}
        {canDisable && (u.status === 'ACTIVE'
          ? <DropdownMenuItem destructive disabled={u.id === me?.id} onSelect={() => setDisable(u)}><Power className="h-3.5 w-3.5" /> Disable</DropdownMenuItem>
          : <DropdownMenuItem onSelect={() => setStatus(u, 'ACTIVE')}><Power className="h-3.5 w-3.5" /> Enable</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="User Management"
        description="Accounts, roles and depot assignments. Users are never deleted: disabling an account keeps its history."
        actions={canCreate ? <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>New User</Button> : undefined}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="flex-1 min-w-[220px]"><SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or depot…" /></div>
        <Select value={roleF} onChange={(e) => setRoleF(e.target.value)} options={[{ label: 'All roles', value: '' }, ...ALL_ROLES.map((r) => ({ label: ROLE_LABELS[r], value: r }))]} />
        <Select value={depotF} onChange={(e) => setDepotF(e.target.value)} options={[{ label: 'All depots', value: '' }, ...depots.map((d) => ({ label: d.name, value: d.id }))]} />
        <Select value={statusF} onChange={(e) => setStatusF(e.target.value)} options={[{ label: 'All statuses', value: '' }, ...Object.entries(STATUS_LABEL).map(([v, l]) => ({ label: l, value: v }))]} />
      </div>

      {users.length === 0 ? (
        <EmptyState title="No users found" description={q || roleF || depotF || statusF ? 'No users match these filters.' : 'Create the first user.'} action={canCreate ? <Button onClick={openCreate}>New User</Button> : undefined} />
      ) : (
        <>
          <Card className="hidden md:block overflow-hidden">
            <Table>
              <TableHeader>
                <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Depot</TableHead>
                <TableHead>Status</TableHead><TableHead>Last login</TableHead><TableHead>Created</TableHead><TableHead align="right">Actions</TableHead>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell><div className="font-semibold text-ink">{u.name}</div>{u.phone && <div className="text-[11px] text-muted">{u.phone}</div>}</TableCell>
                    <TableCell className="text-xs">{u.email}</TableCell>
                    <TableCell><Badge tone={ROLE_TONE[u.role] || 'warning'}>{ROLE_LABELS[u.role]}</Badge>{u.permissionRevokes.length > 0 && <div className="text-[10px] text-muted mt-1">{u.permissionRevokes.length} restricted</div>}</TableCell>
                    <TableCell className="text-xs">{u.assignedDepotName || depotName(u.assignedDepotId) || (isDepotRole(u.role) ? <span className="text-danger">Not assigned</span> : 'All depots')}</TableCell>
                    <TableCell><StatusBadge status={u.status} /></TableCell>
                    <TableCell className="text-xs text-ink-secondary whitespace-nowrap">{fmt(u.lastLogin)}</TableCell>
                    <TableCell className="text-xs text-ink-secondary"><div>{fmt(u.createdAt)}</div>{u.createdByName && <div className="text-[11px] text-muted">by {u.createdByName}</div>}</TableCell>
                    <TableCell align="right"><Actions u={u} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="md:hidden grid gap-3">
            {users.map((u) => (
              <Card key={u.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-semibold text-ink truncate">{u.name}</div><div className="text-xs text-muted truncate">{u.email}</div></div>
                  <StatusBadge status={u.status} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={ROLE_TONE[u.role] || 'warning'}>{ROLE_LABELS[u.role]}</Badge>
                  <span className="text-ink-secondary">{u.assignedDepotName || (isDepotRole(u.role) ? 'No depot' : 'All depots')}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted"><span>Last login: {fmt(u.lastLogin)}</span><Actions u={u} /></div>
              </Card>
            ))}
          </div>
        </>
      )}

      <Modal
        open={!!formOpen} onClose={() => !saving && setFormOpen(null)} size="xl"
        title={formOpen?.editing ? `Edit ${formOpen.editing.name}` : 'New User'}
        description={formOpen?.editing ? 'Changing the role, depot, status or restrictions signs the user out so the change applies immediately.' : 'A one-time password is generated for the new account.'}
        footer={<><Button variant="outline" onClick={() => setFormOpen(null)} disabled={saving}>Cancel</Button><Button type="submit" form="user-form" loading={saving}>{formOpen?.editing ? 'Save Changes' : 'Create User'}</Button></>}
      >
        <form id="user-form" onSubmit={save} className="space-y-3">
          {formError && <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-3 text-xs text-danger">{formError}</div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" />
            <Input label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole, revokes: [] })} options={roleOptions} />
            {(needsDepot || form.role === 'VIEWER') && (
              <Select label={needsDepot ? 'Depot' : 'Depot (optional: limits a viewer to one depot)'} value={form.depotId} onChange={(e) => setForm({ ...form, depotId: e.target.value })}
                options={[{ label: needsDepot ? 'Select a depot…' : 'All depots', value: '' }, ...depots.map((d) => ({ label: `${d.name}${d.status === 'ACTIVE' ? '' : ' (inactive)'}`, value: d.id }))]} />
            )}
            <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
              options={Object.entries(STATUS_LABEL).map(([v, l]) => ({ label: l, value: v }))} />
          </div>
          {needsDepot && depots.length === 0 && <p className="text-xs text-warning">Create a depot first: depot roles must belong to a depot.</p>}

          {revocable.length > 0 && (
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink select-none">
                Restrict access <span className="font-normal text-muted">({form.revokes.length} permission{form.revokes.length === 1 ? '' : 's'} removed from this role)</span>
              </summary>
              <p className="text-xs text-muted mt-2">Tick anything this person should NOT be able to do even though their role normally allows it.</p>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 max-h-56 overflow-y-auto">
                {revocable.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-xs text-ink py-1 cursor-pointer">
                    <input type="checkbox" checked={form.revokes.includes(p)} onChange={(e) => setForm({ ...form, revokes: e.target.checked ? [...form.revokes, p] : form.revokes.filter((x) => x !== p) })} />
                    <span className="font-mono">{p}</span>
                  </label>
                ))}
              </div>
            </details>
          )}
        </form>
      </Modal>

      <ConfirmDialog open={!!disable} onClose={() => !acting && setDisable(null)} onConfirm={() => disable && setStatus(disable, 'INACTIVE')} loading={acting} destructive
        title={`Disable ${disable?.name}?`} description="They will be signed out immediately and cannot sign in. Everything they created is kept." confirmLabel="Disable" />

      <Modal open={!!reset} onClose={() => !acting && setReset(null)} title={`Reset password for ${reset?.name}`} description="A new temporary password is generated. They are signed out everywhere."
        footer={<><Button variant="outline" onClick={() => setReset(null)} disabled={acting}>Cancel</Button><Button onClick={doReset} loading={acting} disabled={!adminPw}>Reset Password</Button></>}>
        <div className="space-y-3">
          {actError && <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-3 text-xs text-danger">{actError}</div>}
          <Input label="Your password (to confirm)" type="password" value={adminPw} onChange={(e) => setAdminPw(e.target.value)} autoComplete="current-password" />
        </div>
      </Modal>

      {secret && <SecretModal open onClose={() => setSecret(null)} title={secret.title} label="Temporary password" value={secret.value} hint={secret.hint} />}
    </div>
  );
}

export default function UsersPage() {
  return <Suspense fallback={null}><UsersInner /></Suspense>;
}
