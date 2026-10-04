'use client';

import React from 'react';
import { Input, Select, Textarea } from '@/components/ui/Input';

export interface DepotRow {
  id: string; code: string; name: string; city: string; country: string; address: string; contactPerson: string; phone: string; email: string;
  notes?: string; status: 'ACTIVE' | 'INACTIVE'; hasAccessCode?: boolean; userCount?: number; totalStockUnits: number; activeOrdersCount: number;
  accessCodeRotatedAt?: string | null; accessCodeRevokedAt?: string | null; createdAt?: string; createdByName?: string | null;
}

export const EMPTY_DEPOT_FORM = { name: '', code: '', city: '', country: '', address: '', contactPerson: '', phone: '', email: '', status: 'ACTIVE', notes: '' };
export type DepotFormValues = typeof EMPTY_DEPOT_FORM;

export function depotToForm(d: DepotRow): DepotFormValues {
  return { name: d.name, code: d.code, city: d.city, country: d.country === '—' ? '' : d.country, address: d.address, contactPerson: d.contactPerson, phone: d.phone, email: d.email, status: d.status, notes: d.notes || '' };
}

export function DepotForm({ form, set, editing }: { form: DepotFormValues; set: (k: keyof DepotFormValues, v: string) => void; editing: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Input label="Depot name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Dubai Main Depot" />
      <Input label="Depot code" required value={form.code} disabled={editing} maxLength={20}
        onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="e.g. DXB-001"
        hint={editing ? 'The code cannot be changed after creation.' : 'Unique. The access code is generated for you.'} />
      <Input label="Location (city)" required value={form.city} onChange={(e) => set('city', e.target.value)} />
      <Input label="Country" value={form.country} onChange={(e) => set('country', e.target.value)} />
      <Input label="Address" required wrapperClassName="sm:col-span-2" value={form.address} onChange={(e) => set('address', e.target.value)} />
      <Input label="Contact person" required value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />
      <Input label="Contact number" type="tel" required value={form.phone} onChange={(e) => set('phone', e.target.value)} />
      <Input label="Email" type="email" required wrapperClassName={editing ? 'sm:col-span-2' : ''} value={form.email} onChange={(e) => set('email', e.target.value)} />
      {!editing && (
        <Select label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}
          options={[{ label: 'Active', value: 'ACTIVE' }, { label: 'Inactive', value: 'INACTIVE' }]} />
      )}
      <Textarea label="Notes" wrapperClassName="sm:col-span-2" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
    </div>
  );
}
