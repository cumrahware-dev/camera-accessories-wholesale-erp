'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Banknote, Building2, CheckCircle2, FileText, MapPin, Pencil, Percent, Phone, Plus, ShieldCheck, Star, Trash2, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import ImageUploadField from '@/components/ui/ImageUploadField';
import { invalidateSettings } from '@/lib/client-cache';

type Company = Record<string, any>;
interface Bank { id: string; label: string; bankName: string; branch: string; accountName: string; accountNumber: string; iban: string; swiftBic: string; routingCode: string; currency: string; bankAddress: string; paymentInstructions: string; otherInfo: string; isActive: boolean; isDefault: boolean; usedByIssuedDocuments: number }
interface Tax { id: string; name: string; rate: number; description: string; isActive: boolean; isDefault: boolean; effectiveFrom: string; inForce: boolean }

const today = () => new Date().toISOString().slice(0, 10);

/** The printed address, built the same way the server builds it, so the preview is exactly what documents will show. */
function composePreview(c: Company): string {
  const t = (v?: string) => (v || '').trim();
  return [
    ...t(c.addressOffice).split(/\r?\n/).map((l) => l.trim()).filter(Boolean), t(c.addressBuilding), [t(c.addressStreet), t(c.addressArea)].filter(Boolean).join(' '),
    t(c.poBox) ? (/^p\.?\s*o\.?\s*box/i.test(t(c.poBox)) ? t(c.poBox) : `P. O. Box ${t(c.poBox)}`) : '', [t(c.addressCity), t(c.addressCountry)].filter(Boolean).join(' - '),
  ].filter(Boolean).join('\n');
}

function SectionCard({ icon: Icon, letter, title, description, children, action }: { icon: React.ComponentType<{ className?: string }>; letter: string; title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <h2 className="text-base font-semibold text-ink"><span className="mr-1.5 text-muted">{letter}.</span>{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const EMPTY_BANK = { label: '', bankName: '', branch: '', accountName: '', accountNumber: '', iban: '', swiftBic: '', routingCode: '', currency: '', bankAddress: '', paymentInstructions: '', otherInfo: '', isActive: true, isDefault: false };
const EMPTY_TAX = { name: '', rate: '0', description: '', isActive: true, isDefault: false, effectiveFrom: today() };

export default function CompanySettingsPage() {
  const { toast } = useToast();
  const [saved, setSaved] = useState<Company | null>(null);
  const [form, setForm] = useState<Company | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [okMessage, setOkMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const [cr, tr] = await Promise.all([fetch('/api/company', { cache: 'no-store' }), fetch('/api/tax-rates', { cache: 'no-store' })]);
      const cj = await cr.json().catch(() => ({}));
      if (!cr.ok) { setLoadError(cj.error || 'Could not load company details.'); return; }
      setSaved(cj.company); setForm(cj.company); setBanks(cj.bankAccounts); setCanEdit(!!cj.canEdit); setLoadError(null);
      if (tr.ok) setTaxes((await tr.json()).rates);
    } catch { setLoadError('Network error. Please retry.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (patch: Company) => setForm((f) => (f ? { ...f, ...patch } : f));
  const dirty = useMemo(() => !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
  useEffect(() => {
    if (!dirty || !editing) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, editing]);

  const cancel = () => { setForm(saved); setEditing(false); setFieldErrors({}); setFormError(''); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || saving) return;
    setSaving(true); setFieldErrors({}); setFormError(''); setOkMessage('');
    try {
      const res = await fetch('/api/company', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFieldErrors(j.fields || {}); setFormError(j.error || 'Could not save company details.');
        toast({ title: 'Could not save', description: j.error, variant: 'error' });
        return;
      }
      setSaved(j.company); setForm(j.company); setEditing(false);
      setOkMessage(j.message || 'Company details updated successfully.');
      invalidateSettings();
      toast({ title: 'Company details updated successfully.', variant: 'success' });
    } catch { setFormError('Network error. Nothing was saved.'); } finally { setSaving(false); }
  };

  // ── bank accounts ─────────────────────────────────────────────
  const [bankModal, setBankModal] = useState<{ id?: string; v: typeof EMPTY_BANK } | null>(null);
  const [bankErrors, setBankErrors] = useState<Record<string, string>>({});
  const [bankBusy, setBankBusy] = useState(false);
  const [bankDelete, setBankDelete] = useState<Bank | null>(null);

  const saveBank = async () => {
    if (!bankModal) return;
    setBankBusy(true); setBankErrors({});
    try {
      const res = await fetch(bankModal.id ? `/api/company/bank-accounts/${bankModal.id}` : '/api/company/bank-accounts', { method: bankModal.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bankModal.v) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setBankErrors(j.fields || {}); if (!j.fields) toast({ title: 'Could not save', description: j.error, variant: 'error' }); return; }
      setBankModal(null); toast({ title: bankModal.id ? 'Bank account updated.' : 'Bank account added.', variant: 'success' }); invalidateSettings(); load();
    } finally { setBankBusy(false); }
  };
  const bankAction = async (b: Bank, patch: Record<string, boolean>, okTitle: string) => {
    const res = await fetch(`/api/company/bank-accounts/${b.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ title: 'Could not update', description: j.error, variant: 'error' }); return; }
    toast({ title: okTitle, variant: 'success' }); invalidateSettings(); load();
  };
  const removeBank = async () => {
    if (!bankDelete) return;
    const res = await fetch(`/api/company/bank-accounts/${bankDelete.id}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));
    setBankDelete(null);
    if (!res.ok) { toast({ title: 'Cannot delete', description: j.error, variant: 'error' }); return; }
    toast({ title: 'Bank account deleted.', variant: 'success' }); invalidateSettings(); load();
  };

  // ── tax rates ─────────────────────────────────────────────────
  const [taxModal, setTaxModal] = useState<{ id?: string; v: typeof EMPTY_TAX } | null>(null);
  const [taxBusy, setTaxBusy] = useState(false);
  const [taxDelete, setTaxDelete] = useState<Tax | null>(null);
  const saveTax = async () => {
    if (!taxModal) return;
    setTaxBusy(true);
    try {
      const res = await fetch(taxModal.id ? `/api/tax-rates/${taxModal.id}` : '/api/tax-rates', { method: taxModal.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...taxModal.v, rate: taxModal.v.rate === '' ? '' : Number(taxModal.v.rate) }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: 'Could not save tax rate', description: j.error, variant: 'error' }); return; }
      setTaxModal(null); toast({ title: 'Tax rate saved. Products that follow the default tax were updated; existing documents are unchanged.', variant: 'success' }); load();
    } finally { setTaxBusy(false); }
  };
  const removeTax = async () => {
    if (!taxDelete) return;
    const res = await fetch(`/api/tax-rates/${taxDelete.id}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));
    setTaxDelete(null);
    if (!res.ok) { toast({ title: 'Cannot delete', description: j.error, variant: 'error' }); return; }
    toast({ title: 'Tax rate deleted.', variant: 'success' }); load();
  };

  if (loadError) return <ErrorState title="Could not open Company & Business Details" description={loadError} action={<Link href="/settings" className="text-sm font-semibold text-primary">Back to Settings</Link>} />;
  if (!form || !saved) return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-64" /></div>;

  const ro = !editing;
  const f = (k: string, label: string, extra: Partial<React.ComponentProps<typeof Input>> = {}) => (
    <Input label={label} value={form[k] ?? ''} onChange={(e) => set({ [k]: e.target.value })} disabled={ro} error={fieldErrors[k]} {...extra} />
  );
  const preview = composePreview(form);
  const defaultTax = taxes.find((t) => t.inForce);

  return (
    <div className="flex max-w-4xl flex-col gap-6 pb-24">
      <PageHeader
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Company & Business Details' }]}
        title="Company & Business Details"
        description={canEdit ? 'Everything printed on your Proformas, Tax Invoices, Service Invoices, PDFs and emails comes from here.' : 'View only. Only a Super Admin can change these details.'}
        actions={canEdit && !editing ? <Button iconLeft={<Pencil className="h-4 w-4" />} onClick={() => { setEditing(true); setOkMessage(''); }}>Edit</Button> : undefined}
      />

      {okMessage && <div role="status" className="flex items-center gap-2 rounded-xl border border-success-border bg-success-soft p-3 text-sm text-success"><CheckCircle2 className="h-4 w-4" />{okMessage}</div>}
      {formError && <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-3 text-sm text-danger">{formError}</div>}
      {!canEdit && <div className="rounded-xl border border-line bg-surface p-3 text-xs text-ink-secondary">You can view company, bank and tax details but not change them.</div>}

      <form onSubmit={save} noValidate className="flex flex-col gap-6">
        <SectionCard icon={Building2} letter="A" title="Company Information" description="The legal and trading names shown on documents.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {f('companyName', 'Company Name *')}
            {f('tradingName', 'Trading Name')}
          </div>
        </SectionCard>

        <SectionCard icon={MapPin} letter="B" title="Address" description="Each part is printed on its own line. The preview shows exactly what documents will carry.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Textarea label="Office Address *" rows={2} wrapperClassName="sm:col-span-2" hint="Office number, floor. One line per row." value={form.addressOffice ?? ''} onChange={(e) => set({ addressOffice: e.target.value })} disabled={ro} error={fieldErrors.addressOffice} />
            {f('addressBuilding', 'Building')}
            {f('addressStreet', 'Street')}
            {f('addressArea', 'Area')}
            {f('poBox', 'PO Box', { placeholder: 'e.g. 87433' })}
            {f('addressCity', 'City *')}
            {f('addressCountry', 'Country *')}
          </div>
          <div className="mt-4 rounded-xl bg-surface p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Printed address</div>
            <pre data-testid="address-preview" className="mt-1 whitespace-pre-wrap font-sans text-sm text-ink">{preview || '—'}</pre>
          </div>
        </SectionCard>

        <SectionCard icon={Phone} letter="C" title="Contact Information">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {f('phone', 'Phone', { inputMode: 'tel' })}
            {f('mobile', 'Mobile', { inputMode: 'tel' })}
            {f('email', 'Email *', { type: 'email' })}
            {f('website', 'Website', { placeholder: 'https://' })}
          </div>
        </SectionCard>

        <SectionCard icon={ShieldCheck} letter="D" title="Tax & Registration" description="Printed on every tax document.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {f('vatGstNumber', 'TRN / VAT Registration Number *')}
            {f('corporateTaxNumber', 'Corporate Tax Number')}
            {f('tradeLicenceNumber', 'Trade Licence Number')}
            {f('dunsNumber', 'D-U-N-S Number')}
          </div>
        </SectionCard>

        <SectionCard icon={FileText} letter="F" title="Document Settings" description="Currency, logo and numbering. Numbers can go up but never down, so an existing number is never repeated.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {f('currency', 'Default Currency', { maxLength: 3, placeholder: 'AED' })}
            {f('currencySymbol', 'Currency Symbol')}
            {f('invoicePrefix', 'Tax Invoice Prefix')}
            {f('invoiceNextNumber', 'Next Tax Invoice Number', { type: 'number', min: 1 })}
            {f('proformaPrefix', 'Proforma Prefix')}
            {f('proformaNextNumber', 'Next Proforma Number', { type: 'number', min: 1 })}
            <div className="sm:col-span-2">
              {ro ? (
                <div><div className="mb-1.5 text-xs font-medium text-ink">Company Logo</div>{form.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={form.logoUrl} alt="Company logo" className="h-14 w-auto object-contain" /> : <span className="text-xs text-muted">No logo</span>}</div>
              ) : (
                <ImageUploadField value={form.logoUrl ?? ''} onChange={(url) => set({ logoUrl: url })} label="Company Logo" placeholder="Paste a logo URL, or upload a PNG/SVG" />
              )}
            </div>
          </div>
        </SectionCard>

        {editing && (
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-popover backdrop-blur">
            <span className="mr-auto text-xs text-muted">{dirty ? 'You have unsaved changes.' : 'No changes yet.'}</span>
            <Button type="button" variant="outline" iconLeft={<X className="h-4 w-4" />} onClick={cancel} disabled={saving}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!dirty}>Save</Button>
          </div>
        )}
      </form>

      <SectionCard
        icon={Banknote} letter="E" title="Bank Details"
        description="Accounts printed on documents: those in the document's currency, otherwise the default account. Inactive accounts never appear on new documents."
        action={canEdit ? <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => { setBankErrors({}); setBankModal({ v: { ...EMPTY_BANK } }); }}>Add Bank Account</Button> : undefined}
      >
        {banks.length === 0 ? <p className="rounded-lg border border-dashed border-line p-5 text-center text-sm text-muted">No bank account yet. Documents will not show bank details until one is added.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {banks.map((b) => (
              <li key={b.id} data-testid="bank-card" className={`rounded-xl border p-4 text-xs ${b.isActive ? 'border-line bg-white' : 'border-line-soft bg-surface-muted opacity-80'}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-ink">{b.label || b.bankName}</span>
                  {b.isDefault && <Badge tone="primary" icon={<Star className="h-3 w-3" />}>Default</Badge>}
                  {!b.isActive && <Badge tone="neutral">Inactive</Badge>}
                  {b.currency && <Badge tone="info">{b.currency}</Badge>}
                </div>
                <dl className="mt-2 space-y-0.5 text-ink-secondary">
                  <div>{[b.bankName, b.branch].filter(Boolean).join(', ')}</div>
                  {b.accountName && <div>Account name: {b.accountName}</div>}
                  {b.accountNumber && <div>Account no.: <span className="font-mono">{b.accountNumber}</span></div>}
                  {b.iban && <div>IBAN: <span className="font-mono">{b.iban}</span></div>}
                  {b.swiftBic && <div>SWIFT / BIC: <span className="font-mono">{b.swiftBic}</span></div>}
                </dl>
                {b.usedByIssuedDocuments > 0 && <p className="mt-2 text-[11px] text-muted">On {b.usedByIssuedDocuments} issued document{b.usedByIssuedDocuments === 1 ? '' : 's'}.</p>}
                {canEdit && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => { setBankErrors({}); setBankModal({ id: b.id, v: { ...EMPTY_BANK, ...Object.fromEntries(Object.keys(EMPTY_BANK).map((k) => [k, (b as any)[k] ?? (EMPTY_BANK as any)[k]])) } as any }); }}>Edit</Button>
                    {!b.isDefault && b.isActive && <Button size="sm" variant="outline" onClick={() => bankAction(b, { isDefault: true }, 'Default bank account changed.')}>Set default</Button>}
                    {!b.isDefault && <Button size="sm" variant="outline" onClick={() => bankAction(b, { isActive: !b.isActive }, b.isActive ? 'Account deactivated.' : 'Account activated.')}>{b.isActive ? 'Deactivate' : 'Activate'}</Button>}
                    <Button size="sm" variant="ghost" iconLeft={<Trash2 className="h-3.5 w-3.5" />} disabled={b.usedByIssuedDocuments > 0} title={b.usedByIssuedDocuments > 0 ? 'Used by issued documents: deactivate instead' : 'Delete'} onClick={() => setBankDelete(b)}>Delete</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        icon={Percent} letter="G" title="Tax Rates"
        description="The default tax applies to the product catalogue and new documents. Documents already created keep the tax they were created with."
        action={canEdit ? <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setTaxModal({ v: { ...EMPTY_TAX } })}>Add Tax Rate</Button> : undefined}
      >
        <div className="mb-3 rounded-lg bg-surface p-3 text-sm" data-testid="default-tax">Current default: <b>{defaultTax ? `${defaultTax.name} ${defaultTax.rate}%` : 'none configured (0%)'}</b></div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="bg-surface text-left text-[11px] font-semibold uppercase tracking-wider text-muted"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2">Effective from</th><th className="px-3 py-2">Status</th>{canEdit && <th className="px-3 py-2" />}</tr></thead>
            <tbody className="divide-y divide-line-soft">
              {taxes.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2"><span className="font-medium text-ink">{t.name}</span>{t.description && <div className="text-[11px] text-muted">{t.description}</div>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.rate}%</td>
                  <td className="px-3 py-2">{new Date(t.effectiveFrom).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{t.inForce && <Badge tone="success">Default in force</Badge>}{t.isDefault && !t.inForce && <Badge tone="warning">Default (scheduled)</Badge>}{!t.isActive && <Badge tone="neutral">Inactive</Badge>}</div></td>
                  {canEdit && <td className="px-3 py-2 text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => setTaxModal({ id: t.id, v: { name: t.name, rate: String(t.rate), description: t.description, isActive: t.isActive, isDefault: t.isDefault, effectiveFrom: t.effectiveFrom.slice(0, 10) } })}>Edit</Button>{!t.isDefault && <Button size="sm" variant="ghost" onClick={() => setTaxDelete(t)} aria-label={`Delete ${t.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>}</div></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Bank account form */}
      <Modal open={!!bankModal} onClose={() => setBankModal(null)} title={bankModal?.id ? 'Edit Bank Account' : 'Add Bank Account'} size="xl"
        footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setBankModal(null)} disabled={bankBusy}>Cancel</Button><Button onClick={saveBank} loading={bankBusy}>Save</Button></div>}>
        {bankModal && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(['label:Account Label', 'bankName:Bank Name *', 'branch:Branch', 'accountName:Account Name', 'accountNumber:Account Number', 'iban:IBAN', 'swiftBic:SWIFT / BIC', 'routingCode:Routing Code', 'currency:Currency (e.g. AED)', 'bankAddress:Bank Address'] as const).map((s) => {
              const [k, label] = s.split(':');
              return <Input key={k} label={label} value={(bankModal.v as any)[k]} maxLength={k === 'currency' ? 3 : undefined} onChange={(e) => setBankModal({ ...bankModal, v: { ...bankModal.v, [k]: e.target.value } })} error={bankErrors[k]} wrapperClassName={k === 'bankAddress' ? 'sm:col-span-2' : undefined} />;
            })}
            <Textarea label="Payment Instructions" rows={2} wrapperClassName="sm:col-span-2" value={bankModal.v.paymentInstructions} onChange={(e) => setBankModal({ ...bankModal, v: { ...bankModal.v, paymentInstructions: e.target.value } })} hint="Printed under the account, e.g. 'Please quote the invoice number.'" />
            <Input label="Other Bank Information" wrapperClassName="sm:col-span-2" value={bankModal.v.otherInfo} onChange={(e) => setBankModal({ ...bankModal, v: { ...bankModal.v, otherInfo: e.target.value } })} />
            <label className="flex min-h-[44px] items-center gap-2 text-xs"><input type="checkbox" checked={bankModal.v.isActive} onChange={(e) => setBankModal({ ...bankModal, v: { ...bankModal.v, isActive: e.target.checked } })} /> Active (shown on new documents)</label>
            <label className="flex min-h-[44px] items-center gap-2 text-xs"><input type="checkbox" checked={bankModal.v.isDefault} onChange={(e) => setBankModal({ ...bankModal, v: { ...bankModal.v, isDefault: e.target.checked } })} /> Default account</label>
          </div>
        )}
      </Modal>

      {/* Tax rate form */}
      <Modal open={!!taxModal} onClose={() => setTaxModal(null)} title={taxModal?.id ? 'Edit Tax Rate' : 'Add Tax Rate'}
        footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setTaxModal(null)} disabled={taxBusy}>Cancel</Button><Button onClick={saveTax} loading={taxBusy}>Save</Button></div>}>
        {taxModal && (
          <div className="grid gap-3">
            <Input label="Tax Name *" value={taxModal.v.name} onChange={(e) => setTaxModal({ ...taxModal, v: { ...taxModal.v, name: e.target.value } })} placeholder="e.g. VAT" />
            <Input label="Tax Rate (%) *" type="number" min={0} max={100} step="0.01" inputMode="decimal" value={taxModal.v.rate} onChange={(e) => setTaxModal({ ...taxModal, v: { ...taxModal.v, rate: e.target.value } })} />
            <Input label="Effective Date" type="date" value={taxModal.v.effectiveFrom} onChange={(e) => setTaxModal({ ...taxModal, v: { ...taxModal.v, effectiveFrom: e.target.value } })} hint="A future date schedules the rate; until then the current default stays in force." />
            <Input label="Description" value={taxModal.v.description} onChange={(e) => setTaxModal({ ...taxModal, v: { ...taxModal.v, description: e.target.value } })} />
            <label className="flex min-h-[44px] items-center gap-2 text-xs"><input type="checkbox" checked={taxModal.v.isActive} onChange={(e) => setTaxModal({ ...taxModal, v: { ...taxModal.v, isActive: e.target.checked } })} /> Active</label>
            <label className="flex min-h-[44px] items-center gap-2 text-xs"><input type="checkbox" checked={taxModal.v.isDefault} onChange={(e) => setTaxModal({ ...taxModal, v: { ...taxModal.v, isDefault: e.target.checked } })} /> Default tax (used for the catalogue and new documents)</label>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!bankDelete} onClose={() => setBankDelete(null)} onConfirm={removeBank} title="Delete this bank account?" confirmLabel="Delete" destructive description={`${bankDelete?.bankName ?? ''} ${bankDelete?.currency ?? ''} will be removed. It is not on any issued document.`} />
      <ConfirmDialog open={!!taxDelete} onClose={() => setTaxDelete(null)} onConfirm={removeTax} title="Delete this tax rate?" confirmLabel="Delete" destructive description={`${taxDelete?.name ?? ''} ${taxDelete?.rate ?? ''}% will be removed. Existing documents keep the tax they were created with.`} />
    </div>
  );
}
