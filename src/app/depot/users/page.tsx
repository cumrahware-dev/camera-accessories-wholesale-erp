'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, Power } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Input, Select } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { SecretModal } from '@/components/admin/SecretModal';
import { ROLE_LABELS, type UserRole } from '@/lib/rbac';
import { useMe } from '@/hooks/useMe';

interface Staff { id: string; name: string; email: string; phone: string; role: UserRole; status: string; lastLogin: string | null }
const STAFF_ROLES: UserRole[] = ['DEPOT_STAFF', 'DEPOT_SCANNER'];
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Never');

/** Depot Manager: staff of THIS depot only. The server takes the depot from the session and ignores anything else. */
export default function DepotUsersPage() {
  const { toast } = useToast();
  const { me, can, loaded } = useMe();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<null | { editing: Staff | null }>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'DEPOT_STAFF' as UserRole });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<null | { title: string; value: string }>(null);
  const [toggle, setToggle] = useState<Staff | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/depot-users', { cache: 'no-store' });
    const j = await res.json().catch(() => null);
    if (!res.ok) { setError(j?.error || 'Could not load your team.'); return; }
    setStaff(j); setError('');
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loaded && !can('depot_users.manage')) return <p className="p-6 text-sm text-muted">You do not have access to depot staff management.</p>;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setFormError('');
    try {
      const editing = open?.editing;
      const res = await fetch(editing ? `/api/depot-users/${editing.id}` : '/api/depot-users', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { name: form.name, phone: form.phone, role: form.role } : form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFormError(data.error || 'Could not save.'); return; }
      setOpen(null);
      if (!editing && data.temporaryPassword) setSecret({ title: `${data.name} added`, value: data.temporaryPassword });
      else toast({ title: 'Saved', variant: 'success' });
      await load();
    } finally { setSaving(false); }
  };

  const reset = async (s: Staff) => {
    const res = await fetch(`/api/depot-users/${s.id}`, { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ title: 'Could not reset', description: j.error, variant: 'error' }); return; }
    setSecret({ title: `Password reset for ${s.name}`, value: j.temporaryPassword });
  };

  const setStatus = async (s: Staff, status: string) => {
    const res = await fetch(`/api/depot-users/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ title: 'Could not update', description: j.error, variant: 'error' }); return; }
    setToggle(null); toast({ title: status === 'ACTIVE' ? 'Enabled' : 'Disabled', variant: 'success' }); await load();
  };

  return (
    <div className="flex flex-col gap-5 max-w-4xl mx-auto pb-20 px-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-ink">Depot Staff</h1>
          <p className="text-xs sm:text-sm text-ink-secondary mt-0.5">{me?.assignedDepotName || 'Your depot'} · people who pick, pack and scan here</p>
        </div>
        <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => { setForm({ name: '', email: '', phone: '', role: 'DEPOT_STAFF' }); setFormError(''); setOpen({ editing: null }); }}>Add</Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid gap-3">
        {staff.length === 0 && !error && <Card className="p-6 text-sm text-muted text-center">No staff accounts yet.</Card>}
        {staff.map((s) => (
          <Card key={s.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-ink">{s.name}</span><Badge tone="neutral">{ROLE_LABELS[s.role]}</Badge><StatusBadge status={s.status} /></div>
              <div className="text-xs text-muted truncate">{s.email} · last login {fmt(s.lastLogin)}</div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={() => { setForm({ name: s.name, email: s.email, phone: s.phone, role: s.role }); setFormError(''); setOpen({ editing: s }); }}>Edit</Button>
              <Button size="sm" variant="outline" iconLeft={<KeyRound className="h-3.5 w-3.5" />} onClick={() => reset(s)}>Reset password</Button>
              {s.status === 'ACTIVE'
                ? <Button size="sm" variant="outline" className="text-danger" iconLeft={<Power className="h-3.5 w-3.5" />} onClick={() => setToggle(s)}>Disable</Button>
                : <Button size="sm" variant="outline" iconLeft={<Power className="h-3.5 w-3.5" />} onClick={() => setStatus(s, 'ACTIVE')}>Enable</Button>}
            </div>
          </Card>
        ))}
      </div>

      <Modal open={!!open} onClose={() => !saving && setOpen(null)} title={open?.editing ? `Edit ${open.editing.name}` : 'Add staff member'}
        footer={<><Button variant="outline" onClick={() => setOpen(null)} disabled={saving}>Cancel</Button><Button type="submit" form="staff-form" loading={saving}>Save</Button></>}>
        <form id="staff-form" onSubmit={save} className="space-y-3">
          {formError && <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-3 text-xs text-danger">{formError}</div>}
          <Input label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          {!open?.editing && <Input label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" />}
          <Input label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })} options={STAFF_ROLES.map((r) => ({ label: ROLE_LABELS[r], value: r }))} />
        </form>
      </Modal>
      <ConfirmDialog open={!!toggle} onClose={() => setToggle(null)} onConfirm={() => toggle && setStatus(toggle, 'INACTIVE')} destructive
        title={`Disable ${toggle?.name}?`} description="They are signed out right away and cannot sign in. Their history is kept." confirmLabel="Disable" />
      {secret && <SecretModal open onClose={() => setSecret(null)} title={secret.title} label="Temporary password" value={secret.value} hint="Give it to them in person; they should change it after signing in." />}
    </div>
  );
}
