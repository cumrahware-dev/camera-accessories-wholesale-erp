'use client';
import { QuantityInput } from '@/components/ui/QuantityInput';
import { useUnits } from '@/lib/hooks/useUnits';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useProductCatalogue } from '@/lib/hooks/useProductCatalogue';
import { apiJson, isoDay, money } from '@/components/purchasing/parts';
import { calcInvoice } from '@/lib/purchasing/calc';
import { PurchaseBreakdown } from '@/components/purchasing/PurchaseBreakdown';

interface Line { key: string; productId: string; sku: string; name: string; unit?: string; quantity: string; unitCost: string; taxRate: string; discount: string }

function PurchaseInvoiceForm() {
  const router = useRouter();
  const editId = useSearchParams().get('id');
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplierState, setSupplierState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [depots, setDepots] = useState<any[]>([]);
  const catalogue = useProductCatalogue<any>({ activeOnly: true });
  const { decimalsFor } = useUnits();
  const [form, setForm] = useState({ supplierId: '', supplierInvoiceNumber: '', invoiceDate: isoDay(new Date()), depotId: '', currency: '', notes: '', discountAmount: '', freightAmount: '', otherCharges: '', pricesIncludeTax: false, nonRecoverableVatPercent: '' });
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLookups = useCallback(() => {
    setSupplierState('loading');
    setSupplierError(null);
    // Each lookup loads on its own: a failing settings/depots call must not leave the supplier list empty (and vice versa).
    apiJson<any[]>('/api/purchase-invoices/suppliers')
      .then((s) => { setSuppliers(Array.isArray(s) ? s : []); setSupplierState('ready'); })
      .catch((e) => { setSupplierError(e.message); setSupplierState('error'); });
    apiJson<any[]>('/api/purchase-invoices/depots')
      .then((d) => { setDepots(d); setForm((f) => ({ ...f, depotId: f.depotId || d[0]?.id || '' })); })
      .catch((e) => setError(`Depots could not be loaded: ${e.message}`));
    apiJson<any>('/api/settings')
      .then((settings) => setForm((f) => ({ ...f, currency: f.currency || settings?.currency || 'USD' })))
      .catch(() => setForm((f) => ({ ...f, currency: f.currency || 'USD' })));
  }, []);
  useEffect(() => { loadLookups(); }, [loadLookups]);

  useEffect(() => {
    if (!editId) return;
    apiJson<any>(`/api/purchase-invoices/${editId}`).then((inv) => {
      if (inv.status !== 'DRAFT') { router.replace(`/purchases/${inv.id}`); return; }
      setForm({ supplierId: inv.supplierId, supplierInvoiceNumber: inv.supplierInvoiceNumber, invoiceDate: isoDay(inv.invoiceDate), depotId: inv.depotId, currency: inv.currency, notes: inv.notes || '', discountAmount: inv.discountAmount ? String(inv.discountAmount) : '', freightAmount: inv.freightAmount ? String(inv.freightAmount) : '', otherCharges: inv.otherCharges ? String(inv.otherCharges) : '', pricesIncludeTax: !!inv.pricesIncludeTax, nonRecoverableVatPercent: inv.nonRecoverableVatPercent ? String(inv.nonRecoverableVatPercent) : '' });
      setLines(inv.items.map((it: any) => ({ key: it.id, productId: it.productId, sku: it.productSku, name: it.productName, unit: it.unit, quantity: String(it.quantity), unitCost: String(it.unitCost), taxRate: String(it.taxRate), discount: it.discountAmount ? String(it.discountAmount) : '' })));
    }).catch((e) => setError(e.message));
  }, [editId, router]);

  // searched on the server across the whole catalogue
  useEffect(() => { catalogue.setQuery(query); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  const matches = query.trim() ? catalogue.results.slice(0, 20) : [];

  // the same calculation the server saves and posts with (lib/purchasing/calc)
  const summary = useMemo(() => calcInvoice(
    lines.map((l) => ({ quantity: l.quantity, unitCost: l.unitCost, taxRate: l.taxRate, discountAmount: l.discount })),
    { discountAmount: form.discountAmount, freightAmount: form.freightAmount, otherCharges: form.otherCharges, pricesIncludeTax: form.pricesIncludeTax, nonRecoverableVatPercent: form.nonRecoverableVatPercent },
  ), [lines, form.discountAmount, form.freightAmount, form.otherCharges, form.pricesIncludeTax, form.nonRecoverableVatPercent]);

  const addProduct = (p: any) => {
    setQuery('');
    setLines((ls) => [...ls, { key: `${p.id}-${Date.now()}`, productId: p.id, sku: p.sku, name: p.name, unit: p.unit, quantity: '1', unitCost: String(p.purchasePrice || ''), taxRate: String(Number(p.taxRate) || 0), discount: '' }]);
  };
  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({ ...form, discountAmount: Number(form.discountAmount) || 0, freightAmount: Number(form.freightAmount) || 0, otherCharges: Number(form.otherCharges) || 0, pricesIncludeTax: form.pricesIncludeTax, nonRecoverableVatPercent: Number(form.nonRecoverableVatPercent) || 0, items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost), taxRate: Number(l.taxRate) || 0, discountAmount: Number(l.discount) || 0 })) });
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
          <div className="flex flex-col gap-1">
            <Select label="Supplier" required value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} disabled={supplierState !== 'ready' && !form.supplierId} placeholder={supplierState === 'loading' ? 'Loading suppliers...' : supplierState === 'error' ? 'Suppliers could not be loaded' : suppliers.length ? 'Select supplier' : 'No suppliers yet'} options={suppliers.map((s) => ({ label: s.name, value: s.id }))} />
            {supplierState === 'error' && (
              <p role="alert" className="text-xs text-danger">{supplierError} <button type="button" className="font-medium underline" onClick={loadLookups}>Retry</button></p>
            )}
            {supplierState === 'ready' && suppliers.length === 0 && (
              <p className="text-xs text-muted">No suppliers are set up. <a href="/suppliers" className="font-medium text-primary underline">Add a supplier</a>, then return here.</p>
            )}
          </div>
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
                <label className="text-xs font-medium text-ink">Quantity<QuantityInput className={`${field} mt-1`} aria-label={`Quantity of ${l.name}`} value={l.quantity} decimals={decimalsFor(l.unit)} onChange={(n) => setLine(l.key, { quantity: String(n) })} />{l.unit && l.unit !== 'Pcs' && <span className="text-[10px] font-normal text-muted">{l.unit}</span>}</label>
                <label className="text-xs font-medium text-ink">Unit cost<input className={`${field} mt-1`} type="number" min={0} step="0.01" inputMode="decimal" required value={l.unitCost} onChange={(e) => setLine(l.key, { unitCost: e.target.value })} /></label>
                <label className="text-xs font-medium text-ink">Discount<input className={`${field} mt-1`} type="number" min={0} step="0.01" inputMode="decimal" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} /></label>
                <label className="text-xs font-medium text-ink">Tax %<input className={`${field} mt-1`} type="number" min={0} max={100} step="0.01" inputMode="decimal" value={l.taxRate} onChange={(e) => setLine(l.key, { taxRate: e.target.value })} /></label>
                <div className="self-end text-right"><div className="text-[11px] uppercase tracking-wider text-muted">Line (excl. tax)</div><div className="font-mono text-sm font-semibold">{money(calcInvoice([{ quantity: l.quantity, unitCost: l.unitCost, taxRate: l.taxRate, discountAmount: l.discount }], { pricesIncludeTax: form.pricesIncludeTax }).lines[0].net, form.currency || 'USD')}</div></div>
              </div>
            </div>
          ))}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input id="pi-discount" label="Invoice discount" type="number" min={0} step="0.01" value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: e.target.value })} hint="Discount on the whole supplier invoice" />
            <Input id="pi-freight" label="Freight" type="number" min={0} step="0.01" value={form.freightAmount} onChange={(e) => setForm({ ...form, freightAmount: e.target.value })} />
            <Input id="pi-other" label="Other charges" type="number" min={0} step="0.01" value={form.otherCharges} onChange={(e) => setForm({ ...form, otherCharges: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-2 rounded-xl border border-line p-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.pricesIncludeTax} onChange={(e) => setForm({ ...form, pricesIncludeTax: e.target.checked })} />
              <span><span className="font-medium text-ink">Unit costs include VAT</span><span className="block text-xs text-muted">The costs typed above are gross; the net amount and VAT are worked out from the line tax %.</span></span>
            </label>
            <Input id="pi-nonrec" label="Non-recoverable VAT %" type="number" min={0} max={100} step="0.01" value={form.nonRecoverableVatPercent} onChange={(e) => setForm({ ...form, nonRecoverableVatPercent: e.target.value })} hint="0 = all VAT is reclaimable (input VAT). The non-recoverable share is added to stock cost." />
          </div>
          <div className="rounded-xl bg-surface p-3"><PurchaseBreakdown s={summary.summary} currency={form.currency || 'USD'} includesTax={form.pricesIncludeTax} /></div>
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
