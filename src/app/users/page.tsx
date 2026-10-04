'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { KeyRound, MoreHorizontal, Pencil, Plus, Power, ShieldOff } from 'lucide-react';
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
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  accessArea: 'ERP' | 'DEPOT';
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  assignedDepotId: string | null;
  assignedDepotName: string | null;
  lastLogin: string | null;
  createdAt: string;
  createdByName: string | null;
  permissionRevokes: string[];
  hasAccessCode: boolean;
}

interface DepotOpt {
  id: string;
  name: string;
  code: string;
  status: string;
}

const EMPTY = {
  name: '',
  email: '',
  phone: '',
  accessArea: 'ERP' as 'ERP' | 'DEPOT',
  role: 'ERP_USER' as UserRole,
  depotId: '',
  status: 'ACTIVE',
  revokes: [] as string[],
};

const ROLE_TONE: Record<string, 'primary' | 'info' | 'warning' | 'neutral'> = {
  SUPER_ADMIN: 'primary',
  MANAGER: 'info',
  ERP_USER: 'neutral',
  VIEWER: 'neutral',
  DEPOT_MANAGER: 'info',
  DEPOT_STAFF: 'warning',
  DEPOT_SCANNER: 'warning',
  DEPOT_USER: 'warning',
};

const fmt = (d?: string | null) =>
  d
    ? new Date(d).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Never';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

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
  const [areaF, setAreaF] = useState('');
  const [depotF, setDepotF] = useState(search.get('depotId') || '');
  const [statusF, setStatusF] = useState('');

  const [formOpen, setFormOpen] = useState<null | { editing: UserRow | null }>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [secret, setSecret] = useState<null | { title: string; value: string; hint: string }>(null);
  const [disable, setDisable] = useState<UserRow | null>(null);
  const [regenTarget, setRegenTarget] = useState<UserRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<UserRow | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const p = new URLSearchParams();
    if (dq) p.set('q', dq);
    if (roleF) p.set('role', roleF);
    if (depotF) p.set('depotId', depotF);
    if (statusF) p.set('status', statusF);
    try {
      const [u, d] = await Promise.all([
        fetch(`/api/users?${p}`, { cache: 'no-store' }),
        fetch('/api/depots', { cache: 'no-store' }),
      ]);
      const ud = await u.json().catch(() => null);
      if (!u.ok) {
        setError(ud?.error || 'Could not load users.');
        return;
      }
      setUsers(ud);
      const dd = await d.json().catch(() => []);
      setDepots(Array.isArray(dd) ? dd : []);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [dq, roleF, depotF, statusF]);

  useEffect(() => {
    load();
  }, [load]);

  const canCreate = can('users.write');
  const canDisable = can('users.disable');
  const depotName = (id: string | null) => depots.find((d) => d.id === id)?.name;

  const roleOptions = useMemo(() => {
    const roles =
      form.accessArea === 'DEPOT'
        ? (['DEPOT_MANAGER', 'DEPOT_STAFF', 'DEPOT_SCANNER'] as UserRole[])
        : (['SUPER_ADMIN', 'MANAGER', 'ERP_USER', 'VIEWER'] as UserRole[]);
    return roles.map((r) => ({ label: ROLE_LABELS[r], value: r }));
  }, [form.accessArea]);

  const revocable = useMemo(
    () => (form.role === 'SUPER_ADMIN' ? [] : listPermissions(form.role)),
    [form.role]
  );

  const openCreate = () => {
    setForm({ ...EMPTY, depotId: depotF });
    setFormError('');
    setFormOpen({ editing: null });
  };

  const openEdit = (u: UserRow) => {
    setForm({
      name: u.name,
      email: u.email,
      phone: u.phone || '',
      accessArea: isDepotRole(u.role) ? 'DEPOT' : 'ERP',
      role: u.role,
      depotId: u.assignedDepotId || '',
      status: u.status,
      revokes: u.permissionRevokes || [],
    });
    setFormError('');
    setFormOpen({ editing: u });
  };

  const needsDepot = isDepotRole(form.role);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formOpen) return;
    setSaving(true);
    setFormError('');
    try {
      const editing = formOpen.editing;
      const body: any = {
        name: form.name,
        email: form.email,
        phone: form.phone,
        role: form.role,
        status: form.status,
        depotId: needsDepot || form.role === 'VIEWER' ? form.depotId : '',
        permissionRevokes: form.revokes,
      };

      const res = await fetch(editing ? `/api/users/${editing.id}` : '/api/users', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || 'Could not save the user.');
        return;
      }

      setFormOpen(null);
      if (!editing && (data.accessCode || data.temporaryPassword)) {
        const code = data.accessCode || data.temporaryPassword;
        setSecret({
          title: `Access code for ${data.name}`,
          value: code,
          hint: `Give this access code to ${data.name}. They will use it to sign in at ${isDepotRole(data.role) ? '/depot/login' : '/login'}.`,
        });
      } else {
        toast({ title: 'User saved', variant: 'success' });
      }
      await load();
    } catch {
      setFormError('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (u: UserRow, status: string) => {
    setActing(true);
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Could not update', description: data.error, variant: 'error' });
        return;
      }
      toast({
        title: status === 'ACTIVE' ? 'User enabled' : 'User disabled',
        description: status === 'ACTIVE' ? undefined : 'They were signed out. Their records are kept.',
        variant: 'success',
      });
      setDisable(null);
      await load();
    } finally {
      setActing(false);
    }
  };

  const doRegenerateCode = async () => {
    if (!regenTarget) return;
    setActing(true);
    try {
      const res = await fetch(`/api/users/${regenTarget.id}/access-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Could not regenerate access code', description: data.error, variant: 'error' });
        return;
      }
      const name = regenTarget.name;
      const role = regenTarget.role;
      setRegenTarget(null);
      setSecret({
        title: `New access code for ${name}`,
        value: data.accessCode,
        hint: `The previous access code is now invalid. Give this code to ${name} to sign in at ${isDepotRole(role) ? '/depot/login' : '/login'}.`,
      });
      await load();
    } finally {
      setActing(false);
    }
  };

  const doRevokeCode = async () => {
    if (!revokeTarget) return;
    setActing(true);
    try {
      const res = await fetch(`/api/users/${revokeTarget.id}/access-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Could not revoke access code', description: data.error, variant: 'error' });
        return;
      }
      toast({ title: 'Access code revoked', description: 'User can no longer sign in until a new code is generated.', variant: 'success' });
      setRevokeTarget(null);
      await load();
    } finally {
      setActing(false);
    }
  };

  const filteredUsers = useMemo(() => {
    if (!areaF) return users;
    return users.filter((u) => (areaF === 'DEPOT' ? isDepotRole(u.role) : !isDepotRole(u.role)));
  }, [users, areaF]);

  if (loading || !loaded) {
    return (
      <div className="space-y-4">
        <div className="h-10" />
        <SkeletonTable />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load users"
        description={error}
        action={
          <Button
            variant="outline"
            onClick={() => {
              setLoading(true);
              load();
            }}
          >
            Retry
          </Button>
        }
      />
    );
  }

  const Actions = ({ u }: { u: UserRow }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {canCreate && (
          <DropdownMenuItem onSelect={() => openEdit(u)}>
            <Pencil className="h-3.5 w-3.5" /> Edit User / Role / Depot
          </DropdownMenuItem>
        )}
        {canCreate && (
          <DropdownMenuItem onSelect={() => setRegenTarget(u)}>
            <KeyRound className="h-3.5 w-3.5" /> Regenerate Access Code
          </DropdownMenuItem>
        )}
        {canCreate && (
          <DropdownMenuItem onSelect={() => setRevokeTarget(u)}>
            <ShieldOff className="h-3.5 w-3.5" /> Revoke Access Code
          </DropdownMenuItem>
        )}
        {canDisable && <DropdownMenuSeparator />}
        {canDisable &&
          (u.status === 'ACTIVE' ? (
            <DropdownMenuItem destructive disabled={u.id === me?.id} onSelect={() => setDisable(u)}>
              <Power className="h-3.5 w-3.5" /> Disable
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setStatus(u, 'ACTIVE')}>
              <Power className="h-3.5 w-3.5" /> Enable
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="User Management"
        description="Manage system users, access codes, roles, and depot assignments. Zero passwords or hardcoded credentials."
        actions={canCreate ? <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>New User</Button> : undefined}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or depot…" />
        </div>
        <Select
          value={areaF}
          onChange={(e) => setAreaF(e.target.value)}
          options={[
            { label: 'All access areas', value: '' },
            { label: 'ERP Access', value: 'ERP' },
            { label: 'Depot Access', value: 'DEPOT' },
          ]}
        />
        <Select
          value={roleF}
          onChange={(e) => setRoleF(e.target.value)}
          options={[{ label: 'All roles', value: '' }, ...ALL_ROLES.map((r) => ({ label: ROLE_LABELS[r], value: r }))]}
        />
        <Select
          value={depotF}
          onChange={(e) => setDepotF(e.target.value)}
          options={[{ label: 'All depots', value: '' }, ...depots.map((d) => ({ label: d.name, value: d.id }))]}
        />
        <Select
          value={statusF}
          onChange={(e) => setStatusF(e.target.value)}
          options={[{ label: 'All statuses', value: '' }, ...Object.entries(STATUS_LABEL).map(([v, l]) => ({ label: l, value: v }))]}
        />
      </div>

      {filteredUsers.length === 0 ? (
        <EmptyState
          title="No users found"
          description={q || roleF || depotF || statusF || areaF ? 'No users match these filters.' : 'Create the first user.'}
          action={canCreate ? <Button onClick={openCreate}>New User</Button> : undefined}
        />
      ) : (
        <>
          <Card className="hidden md:block overflow-hidden">
            <Table>
              <TableHeader>
                <TableHead>Full Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Access Area</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Depot</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>Created</TableHead>
                <TableHead align="right">Actions</TableHead>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((u) => {
                  const isDepot = isDepotRole(u.role);
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="font-semibold text-slate-900">{u.name}</div>
                        {u.phone && <div className="text-[11px] text-slate-500">{u.phone}</div>}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{u.email}</TableCell>
                      <TableCell>
                        <Badge tone={isDepot ? 'info' : 'primary'}>
                          {isDepot ? 'Depot' : 'ERP'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge tone={ROLE_TONE[u.role] || 'warning'}>{ROLE_LABELS[u.role]}</Badge>
                        {u.permissionRevokes.length > 0 && (
                          <div className="text-[10px] text-slate-500 mt-1">{u.permissionRevokes.length} restricted</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {u.assignedDepotName || depotName(u.assignedDepotId) || (isDepot ? <span className="text-red-600 font-medium">Unassigned</span> : 'All Depots')}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={u.status} />
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap">{fmt(u.lastLogin)}</TableCell>
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                        <div>{fmt(u.createdAt)}</div>
                        {u.createdByName && <div className="text-[11px] text-slate-400">by {u.createdByName}</div>}
                      </TableCell>
                      <TableCell align="right">
                        <Actions u={u} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <div className="md:hidden grid gap-3">
            {filteredUsers.map((u) => (
              <Card key={u.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{u.name}</div>
                    <div className="text-xs text-slate-500 truncate">{u.email}</div>
                  </div>
                  <StatusBadge status={u.status} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={isDepotRole(u.role) ? 'info' : 'primary'}>
                    {isDepotRole(u.role) ? 'Depot' : 'ERP'}
                  </Badge>
                  <Badge tone={ROLE_TONE[u.role] || 'warning'}>{ROLE_LABELS[u.role]}</Badge>
                  <span className="text-slate-600">
                    {u.assignedDepotName || (isDepotRole(u.role) ? 'No depot' : 'All depots')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span>Last login: {fmt(u.lastLogin)}</span>
                  <Actions u={u} />
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* User Create / Edit Modal */}
      <Modal
        open={!!formOpen}
        onClose={() => !saving && setFormOpen(null)}
        size="xl"
        title={formOpen?.editing ? `Edit ${formOpen.editing.name}` : 'New User'}
        description={
          formOpen?.editing
            ? 'Updating user roles or depot assignments takes effect immediately and securely resets active sessions.'
            : 'A unique access code is generated automatically for the new account and shown once.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="user-form" loading={saving}>
              {formOpen?.editing ? 'Save Changes' : 'Create User'}
            </Button>
          </>
        }
      >
        <form id="user-form" onSubmit={save} className="space-y-4">
          {formError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {formError}
            </div>
          )}

          {!formOpen?.editing && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">Access Area</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, accessArea: 'ERP', role: 'ERP_USER', depotId: '' })}
                  className={`p-3 rounded-xl border text-sm font-semibold transition-colors cursor-pointer ${
                    form.accessArea === 'ERP'
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  ARIB Global ERP
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, accessArea: 'DEPOT', role: 'DEPOT_STAFF' })}
                  className={`p-3 rounded-xl border text-sm font-semibold transition-colors cursor-pointer ${
                    form.accessArea === 'DEPOT'
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  ARIB Global Depot
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Full name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              label="Email address"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              autoComplete="off"
            />
            <Input
              label="Phone number"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <Select
              label="Role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRole, revokes: [] })}
              options={roleOptions}
            />
            {(needsDepot || form.role === 'VIEWER') && (
              <Select
                label={needsDepot ? 'Assigned Depot (Required)' : 'Assigned Depot (Optional)'}
                value={form.depotId}
                onChange={(e) => setForm({ ...form, depotId: e.target.value })}
                options={[
                  { label: needsDepot ? 'Select a depot…' : 'All depots', value: '' },
                  ...depots.map((d) => ({
                    label: `${d.name} (${d.code})${d.status === 'ACTIVE' ? '' : ' - inactive'}`,
                    value: d.id,
                  })),
                ]}
              />
            )}
            <Select
              label="Status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              options={Object.entries(STATUS_LABEL).map(([v, l]) => ({ label: l, value: v }))}
            />
          </div>
          {needsDepot && depots.length === 0 && (
            <p className="text-xs text-amber-600">
              Create a depot first: depot users must be assigned to an existing depot.
            </p>
          )}

          {revocable.length > 0 && (
            <details className="rounded-xl border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900 select-none">
                Restrict permissions <span className="font-normal text-slate-500">({form.revokes.length} revoked)</span>
              </summary>
              <p className="text-xs text-slate-500 mt-2">
                Restrict specific capabilities for this user beyond standard role defaults.
              </p>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 max-h-52 overflow-y-auto">
                {revocable.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-xs text-slate-700 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.revokes.includes(p)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          revokes: e.target.checked ? [...form.revokes, p] : form.revokes.filter((x) => x !== p),
                        })
                      }
                    />
                    <span className="font-mono">{p}</span>
                  </label>
                ))}
              </div>
            </details>
          )}
        </form>
      </Modal>

      {/* Disable Confirmation Dialog */}
      <ConfirmDialog
        open={!!disable}
        onClose={() => !acting && setDisable(null)}
        onConfirm={() => disable && setStatus(disable, 'INACTIVE')}
        loading={acting}
        destructive
        title={`Disable ${disable?.name}?`}
        description="The user will be immediately signed out and unable to log in. All existing business records, orders, and audits are preserved."
        confirmLabel="Disable User"
      />

      {/* Regenerate Access Code Confirmation Dialog */}
      <ConfirmDialog
        open={!!regenTarget}
        onClose={() => !acting && setRegenTarget(null)}
        onConfirm={doRegenerateCode}
        loading={acting}
        destructive
        title={`Regenerate access code for ${regenTarget?.name}?`}
        description="Regenerating this access code will invalidate the current code immediately. The user will be signed out everywhere."
        confirmLabel="Regenerate"
      />

      {/* Revoke Access Code Confirmation Dialog */}
      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => !acting && setRevokeTarget(null)}
        onConfirm={doRevokeCode}
        loading={acting}
        destructive
        title={`Revoke access code for ${revokeTarget?.name}?`}
        description="Revoking the access code prevents the user from signing in until a new access code is generated. All data remains intact."
        confirmLabel="Revoke Code"
      />

      {/* One-time Secret Modal */}
      {secret && (
        <SecretModal
          open
          onClose={() => setSecret(null)}
          title={secret.title}
          label="Access Code"
          value={secret.value}
          hint={secret.hint}
        />
      )}
    </div>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={null}>
      <UsersInner />
    </Suspense>
  );
}
