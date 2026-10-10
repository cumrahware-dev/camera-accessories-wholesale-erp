'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { apiJson, isoDay, money } from '@/components/purchasing/parts';
import { dec, round2, taxOn } from '@/lib/money-client';

interface Line { key: string; productId: string; sku: string; name: string; quantity: string; unitCost: string; taxRate: string; discount: string }

function PurchaseInvoiceForm() {
  const router = useRouter();
  const editId = useSearchParams().get('id');
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [depots, setDepots] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({ supplierId: '', supplierInvoiceNumber: '', invoiceDate: isoDay(new Date()), depotId: '', currency: '', notes: '', discountAmount: '', freightAmount: '', otherCharges: '' });
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiJson<any>('/api/suppliers'), apiJson<any[]>('/api/depots'), apiJson<any[]>('/api/products'), apiJson<any>('/api/settings').catch(() => ({}))])
      .then(([s, d, p, settings]) => {
        setSuppliers(Array.isArray(s) ? s : s.suppliers || []);
        setDepots(d);
        setProducts(p);
        setForm((f) => ({ ...f, currency: f.currency || settings?.currency || 'USD', depotId: f.depotId || d[0]?.id || '' }));
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!editId) return;
    apiJson<any>(`/api/purchase-invoices/${editId}`).then((inv) => {
      if (inv.status !== 'DRAFT') { router.replace(`/purchases/${inv.id}`); return; }
      setForm({ supplierId: inv.supplierId, supplierInvoiceNumber: inv.supplierInvoiceNumber, invoiceDate: isoDay(inv.invoiceDate), depotId: inv.depotId, currency: inv.currency, notes: inv.notes || '', discountAmount: inv.discountAmount ? String(inv.discountAmount) : '', freightAmount: inv.freightAmount ? String(inv.freightAmount) : '', otherCharges: inv.otherCharges ? String(inv.otherCharges) : '' });
      setLines(inv.items.map((it: any) => ({ key: it.id, productId: it.productId, sku: it.productSku, name: it.productName, quantity: String(it.quantity), unitCost: String(it.unitCost), taxRate: String(it.taxRate), discount: it.discountAmount ? String(it.discountAmount) : '' })));
    }).catch((e) => setError(e.message));
  }, [editId, router]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? products.filter((p) => `${p.name} ${p.sku} ${p.brand}`.toLowerCase().includes(q)).slice(0, 8) : [];
  }, [products, query]);

  const totals = useMemo(() => {
    let sub = 0, tax = 0;
    for (const l of lines) {
      const base = round2(dec((Number(l.quantity) || 0)).times(Number(l.unitCost) || 0).minus(Number(l.discount) || 0));
      sub = round2(sub + base);
      tax = round2(tax + taxOn(base, Number(l.taxRate) || 0));
    }
    const disc = Number(form.discountAmount) || 0, freight = Number(form.freightAmount) || 0, other = Number(form.otherCharges) || 0;
    return { sub, tax, disc, freight, other, total: round2(dec(sub).minus(disc).plus(tax).plus(freight).plus(other)) };
  }, [lines, form.discountAmount, form.freightAmount, form.otherCharges]);

  const addProduct = (p: any) => {
    setQuery('');
    setLines((ls) => [...ls, { key: `${p.id}-${Date.now()}`, productId: p.id, sku: p.sku, name: p.name, quantity: '1', unitCost: String(p.purchasePrice || ''), taxRate: '0', discount: '' }]);
  };
  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({ ...form, discountAmount: Number(form.discountAmount) || 0, freightAmount: Number(form.freightAmount) || 0, otherCharges: Number(form.otherCharges) || 0, items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost), taxRate: Number(l.taxRate) || 0, discountAmount: Number(l.discount) || 0 })) });
      const inv = await apiJson<any>(editId ? `/api/purchase-invoices/${editId}` : '/api/purchase-invoices', { method: editId ? 'PUT' : 'POST', body });
      toast({ title: editId ? 'Draft updated' : 'Draft purchase invoice saved', description: `${inv.purchaseNumber}. Review it and post to receive the stock.`, variant: 'success' });
      router.push(`/purchases/${inv.id}`);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  const field = 'h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none md:h-10';

  return (
    <form onSubmit={save} className="flex flex-col gap-6 pb-16">
      <PageHeader
        breadcrumbs={[{ label: 'Purchase Invoices', href: '/purchases' }, { label: editId ? 'Edit draft' : 'New' }]}
        title={editId ? 'Edit Purchase Invoice' : 'New Purchase Invoice'}
        description="Saved as a draft first. Posting receives the stock at these costs and locks the invoice."
      />
      {error && <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-3 text-sm text-danger">{error}</div>}

      <Card>
        <CardHeader><CardTitle>Supplier invoice</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select label="Supplier" required value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} placeholder="Select supplier" options={suppliers.map((s) => ({ label: s.name, value: s.id }))} />
          <Input id="pi-number" label="Supplier invoice number" required value={form.supplierInvoiceNumber} onChange={(e) => setForm({ ...form, supplierInvoiceNumber: e.target.value })} />
          <Input id="pi-date" label="Invoice date" type="date" required value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} />
          <Select label="Receiving depot" required value={form.depotId} onChange={(e) => setForm({ ...form, depotId: e.target.value })} options={depots.map((d) => ({ label: d.name, value: d.id }))} />
          <Input id="pi-currency" label="Currency" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} hint="ISO code, e.g. INR, USD, AED" />
          <Textarea id="pi-notes" label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} wrapperClassName="sm:col-span-2 lg:col-span-1" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Items received</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted md:top-3" />
            <input className={`${field} pl-9`} placeholder="Add a product: search by name, SKU or brand" value={query} onChange={(e) => setQuery(e.target.value)} />
            {matches.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-white shadow-popover">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => addProduct(p)} className="flex min-h-[48px] w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface">
                      <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{p.name}</span><span className="block truncate font-mono text-xs text-muted">{p.sku} · {p.brand}</span></span>
                      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary"><Plus className="h-3.5 w-3.5" />Add</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {lines.length === 0 && <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">No items yet. Search for a product above.</p>}
          {lines.map((l) => (
            <div key={l.key} className="rounded-xl border border-line p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="truncate text-sm font-semibold text-ink">{l.name}</div><div className="font-mono text-xs text-muted">{l.sku}</div></div>
                <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-danger hover:bg-danger-soft md:h-10 md:w-10"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <label className="text-xs font-medium text-ink">Quantity<input className={`${field} mt-1`} type="number" min={1} step={1} inputMode="numeric" required value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} /></label>
                <label className="text-xs font-medium text-ink">Unit cost<input className={`${field} mt-1`} type="number" min={0} step="0.01" inputMode="decimal" required value={l.unitCost} onChange={(e) => setLine(l.key, { unitCost: e.target.value })} /></label>
                <label className="text-xs font-medium text-ink">Discount<input className={`${field} mt-1`} type="number" min={0} step="0.01" inputMode="decimal" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} /></label>
                <label className="text-xs font-medium text-ink">Tax %<input className={`${field} mt-1`} type="number" min={0} max={100} step="0.01" inputMode="decimal" value={l.taxRate} onChange={(e) => setLine(l.key, { taxRate: e.target.value })} /></label>
                <div className="self-end text-right"><div className="text-[11px] uppercase tracking-wider text-muted">Line (excl. tax)</div><div className="font-mono text-sm font-semibold">{money(round2(dec(Number(l.quantity) || 0).times(Number(l.unitCost) || 0).minus(Number(l.discount) || 0)), form.currency || 'USD')}</div></div>
              </div>
            </div>
          ))}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input id="pi-discount" label="Invoice discount" type="number" min={0} step="0.01" value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: e.target.value })} hint="Discount on the whole supplier invoice" />
            <Input id="pi-freight" label="Freight" type="number" min={0} step="0.01" value={form.freightAmount} onChange={(e) => setForm({ ...form, freightAmount: e.target.value })} />
            <Input id="pi-other" label="Other charges" type="number" min={0} step="0.01" value={form.otherCharges} onChange={(e) => setForm({ ...form, otherCharges: e.target.value })} />
          </div>
          <dl className="space-y-1 rounded-xl bg-surface p-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal (lines, after line discounts)</dt><dd className="font-mono">{money(totals.sub, form.currency || 'USD')}</dd></div>
            {totals.disc > 0 && <div className="flex justify-between"><dt className="text-muted">Invoice discount</dt><dd className="font-mono">-{money(totals.disc, form.currency || 'USD')}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="font-mono">{money(totals.tax, form.currency || 'USD')}</dd></div>
            {totals.freight > 0 && <div className="flex justify-between"><dt className="text-muted">Freight</dt><dd className="font-mono">{money(totals.freight, form.currency || 'USD')}</dd></div>}
            {totals.other > 0 && <div className="flex justify-between"><dt className="text-muted">Other charges</dt><dd className="font-mono">{money(totals.other, form.currency || 'USD')}</dd></div>}
            <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Invoice total</dt><dd className="font-mono text-primary">{money(totals.total, form.currency || 'USD')}</dd></div>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={saving}>Cancel</Button>
        <Button type="submit" loading={saving} disabled={lines.length === 0}>Save draft</Button>
      </div>
    </form>
  );
}

export default function NewPurchaseInvoicePage() {
  return <Suspense fallback={null}><PurchaseInvoiceForm /></Suspense>;
}
