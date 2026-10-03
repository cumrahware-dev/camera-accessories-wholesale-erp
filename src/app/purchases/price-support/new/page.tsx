'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Paperclip, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { apiJson, Field, fmtDate, isoDay, money } from '@/components/purchasing/parts';

function SupportForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const editId = sp.get('id');
  const presetInvoice = sp.get('invoice');
  const { toast } = useToast();

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [creditHeads, setCreditHeads] = useState<any[]>([]);
  const [settleHeads, setSettleHeads] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [invoice, setInvoice] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ supplierId: '', purchaseInvoiceId: '', supportReference: '', supportDate: isoDay(new Date()), amount: '', reason: '', accountingHeadId: 'acc-4510', settlementHeadId: 'acc-2100' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    Promise.all([apiJson<any>('/api/suppliers'), apiJson<any[]>('/api/accounting/heads?usage=PRICE_SUPPORT_CREDIT'), apiJson<any[]>('/api/accounting/heads?usage=PRICE_SUPPORT_SETTLEMENT')])
      .then(([s, c, st]) => { setSuppliers(Array.isArray(s) ? s : s.suppliers || []); setCreditHeads(c); setSettleHeads(st); })
      .catch((e) => setError(e.message));
  }, []);

  // preset from an invoice page, or load an entry being edited
  useEffect(() => {
    if (editId) {
      apiJson<any>(`/api/price-support/${editId}`).then((s) => {
        if (s.status !== 'DRAFT' && s.status !== 'REJECTED') { router.replace(`/purchases/price-support/${s.id}`); return; }
        setForm({ supplierId: s.supplierId, purchaseInvoiceId: s.purchaseInvoiceId, supportReference: s.supportReference, supportDate: isoDay(s.supportDate), amount: String(s.amount), reason: s.reason, accountingHeadId: s.accountingHeadId, settlementHeadId: s.settlementHeadId });
      }).catch((e) => setError(e.message));
    } else if (presetInvoice) {
      apiJson<any>(`/api/purchase-invoices/${presetInvoice}`).then((inv) => set({ supplierId: inv.supplierId, purchaseInvoiceId: inv.id })).catch(() => {});
    }
  }, [editId, presetInvoice, router]);

  // posted invoices of the chosen supplier
  useEffect(() => {
    if (!form.supplierId) { setInvoices([]); return; }
    apiJson<any[]>(`/api/purchase-invoices?status=POSTED&supplierId=${encodeURIComponent(form.supplierId)}`).then(setInvoices).catch(() => setInvoices([]));
  }, [form.supplierId]);

  // details of the chosen invoice (incl. support already recorded)
  useEffect(() => {
    if (!form.purchaseInvoiceId) { setInvoice(null); return; }
    apiJson<any>(`/api/purchase-invoices/${form.purchaseInvoiceId}`).then(setInvoice).catch(() => setInvoice(null));
  }, [form.purchaseInvoiceId]);

  const filtered = useMemo(() => {
    const q = invoiceQuery.trim().toLowerCase();
    return invoices.filter((i) => !q || `${i.supplierInvoiceNumber} ${i.purchaseNumber}`.toLowerCase().includes(q));
  }, [invoices, invoiceQuery]);

  const alreadyRecorded = invoice ? invoice.priceSupport.entries.filter((e: any) => e.status !== 'REJECTED' && e.id !== editId).reduce((s: number, e: any) => s + e.amount, 0) : 0;
  const remaining = invoice ? invoice.grandTotal - alreadyRecorded : 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const s = await apiJson<any>(editId ? `/api/price-support/${editId}` : '/api/price-support', { method: editId ? 'PUT' : 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount) }) });
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        try {
          await apiJson(`/api/price-support/${s.id}/attachment`, { method: 'POST', body: fd });
        } catch (err: any) {
          toast({ title: 'Saved, but the attachment failed', description: err.message, variant: 'warning' });
        }
      }
      toast({ title: editId ? 'Price support updated' : 'Price support saved as draft', description: `${s.supportNumber}. Submit it for approval when ready.`, variant: 'success' });
      router.push(`/purchases/price-support/${s.id}`);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-6 pb-16">
      <PageHeader
        breadcrumbs={[{ label: 'Supplier Price Support', href: '/purchases/price-support' }, { label: editId ? 'Edit' : 'New' }]}
        title={editId ? 'Edit Price Support' : 'New Supplier Price Support'}
        description="Records a discount or rebate received after the invoice was posted. The original invoice, product cost and stock valuation are not changed."
      />
      {error && <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-3 text-sm text-danger">{error}</div>}

      <Card>
        <CardHeader><CardTitle>1 · Supplier and original invoice</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Select label="Supplier" required value={form.supplierId} onChange={(e) => set({ supplierId: e.target.value, purchaseInvoiceId: '' })} placeholder="Select supplier" options={suppliers.map((s) => ({ label: s.name, value: s.id }))} />
          {form.supplierId && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted md:top-3" />
                <input className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm focus:border-primary focus:outline-none md:h-10" placeholder="Search posted invoices of this supplier" value={invoiceQuery} onChange={(e) => setInvoiceQuery(e.target.value)} />
              </div>
              {invoices.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line p-3 text-sm text-muted">This supplier has no posted purchase invoices.</p>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto overscroll-contain">
                  {filtered.map((i) => (
                    <li key={i.id}>
                      <button type="button" onClick={() => set({ purchaseInvoiceId: i.id })} className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left ${form.purchaseInvoiceId === i.id ? 'border-primary bg-primary-soft' : 'border-line bg-white hover:bg-surface'}`}>
                        <span className="min-w-0"><span className="block font-mono text-sm font-semibold text-ink">{i.supplierInvoiceNumber}</span><span className="block text-xs text-muted">{i.purchaseNumber} · {fmtDate(i.invoiceDate)}</span></span>
                        <span className="shrink-0 font-mono text-sm">{money(i.grandTotal, i.currency)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {invoice && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Original invoice (reference only)</p>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Supplier invoice">{invoice.supplierInvoiceNumber}</Field>
                <Field label="Purchase ref">{invoice.purchaseNumber}</Field>
                <Field label="Invoice date">{fmtDate(invoice.invoiceDate)}</Field>
                <Field label="Invoice total">{money(invoice.grandTotal, invoice.currency)}</Field>
                <Field label="Stock value received">{money(invoice.subtotal, invoice.currency)}</Field>
                <Field label="Items">{invoice.items.length} lines · {invoice.items.reduce((s: number, i: any) => s + i.quantity, 0)} units</Field>
                <Field label="Support already recorded">{money(alreadyRecorded, invoice.currency)}</Field>
                <Field label="Can still be recorded">{money(remaining, invoice.currency)}</Field>
              </dl>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2 · Support details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input id="ps-ref" label="Support reference number" required hint="Supplier credit note / support letter number. Must be unique per supplier." value={form.supportReference} onChange={(e) => set({ supportReference: e.target.value })} />
          <Input id="ps-date" label="Support date" type="date" required min={invoice ? isoDay(invoice.invoiceDate) : undefined} max={isoDay(new Date())} value={form.supportDate} onChange={(e) => set({ supportDate: e.target.value })} />
          <Input id="ps-amount" label={`Support amount${invoice ? ` (${invoice.currency})` : ''}`} type="number" required min={0.01} step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} hint={invoice ? `Up to ${money(remaining, invoice.currency)}` : undefined} />
          <Select label="Accounting head (credit)" required value={form.accountingHeadId} onChange={(e) => set({ accountingHeadId: e.target.value })} options={creditHeads.map((h) => ({ label: `${h.code} · ${h.name}`, value: h.id }))} />
          <Select label="Settled against (debit)" required value={form.settlementHeadId} onChange={(e) => set({ settlementHeadId: e.target.value })} options={settleHeads.map((h) => ({ label: `${h.code} · ${h.name}`, value: h.id }))} hint="Accounts Payable if the invoice is unpaid; Supplier Claims Receivable if it was already paid." />
          <Textarea id="ps-reason" label="Reason / remarks" required value={form.reason} onChange={(e) => set({ reason: e.target.value })} wrapperClassName="sm:col-span-2" />
          <label className="sm:col-span-2 flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-sm hover:bg-surface">
            <Paperclip className="h-4 w-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{file ? file.name : 'Attach supplier credit note / support document (PDF, JPG or PNG, optional)'}</span>
            <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={saving}>Cancel</Button>
        <Button type="submit" loading={saving} disabled={!form.purchaseInvoiceId}>Save draft</Button>
      </div>
    </form>
  );
}

export default function NewPriceSupportPage() {
  return <Suspense fallback={null}><SupportForm /></Suspense>;
}
