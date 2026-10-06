'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, Search, Trash2, UserRound, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input, Textarea } from '@/components/ui/Input';
import { TermsFields, type TermsValue } from '@/components/documents/TermsFields';
import { defaultsFromCustomer, printableDelivery } from '@/lib/documents/terms';
import { useDebounce } from '@/hooks/useDebounce';
import { formatUSD } from '@/lib/utils';

interface Line {
  key: string;
  id?: string;
  productId: string;
  sku: string;
  name: string;
  brand: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  /** '' on a new line = the product's own tax rate */
  taxRate: string;
}

interface Preview {
  totals: { subtotal: number; discountPercent: number; discountAmount: number; taxAmount: number; shippingCost: number; otherCharges: number; grandTotal: number; freight: { chargeableWeightKg: number; freightCharge: number } };
  lines: Array<{ productId: string; taxRate: number; taxAmount: number; totalPrice: number }>;
  stock: Array<{ productId: string; needed: number; onHand: number; reserved: number; available: number; short: boolean }>;
  warnings: string[];
  changes: string[];
}

const field = 'h-10 w-full rounded-lg border border-line bg-white px-2.5 text-sm text-ink focus:border-primary focus:outline-none disabled:bg-surface-muted';
const toStr = (n: unknown) => (n === null || n === undefined ? '' : String(n));

/**
 * Review / edit a DRAFT tax invoice before it is issued: customer, dispatch depot, terms, products, discounts, tax,
 * freight, additional charges and notes. Every figure shown is calculated by the server (the same calculator the
 * proforma used), so the preview is exactly what will be saved. The source proforma is never changed.
 */
export default function DraftInvoiceEditor({ invoice, open, onClose, onSaved }: {
  invoice: any;
  open: boolean;
  onClose: () => void;
  onSaved: (invoice: any, changes: string[]) => void;
}) {
  const [customer, setCustomer] = useState<any>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [useNewCustomerTerms, setUseNewCustomerTerms] = useState(false);
  const termsBeforeCustomerChange = useRef<TermsValue | null>(null);

  const [depots, setDepots] = useState<any[]>([]);
  const [depotId, setDepotId] = useState('');
  const [terms, setTerms] = useState<TermsValue>({ paymentTerms: '', paymentMethod: '', incoterm: '', incotermPlace: '', deliveryTerms: '' });
  const [lines, setLines] = useState<Line[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [otherCharges, setOtherCharges] = useState('0');
  const [freightManual, setFreightManual] = useState(true);
  const [manualFreight, setManualFreight] = useState('0');
  const [freightRate, setFreightRate] = useState('0');
  const [additionalFreight, setAdditionalFreight] = useState('0');
  const [notes, setNotes] = useState('');

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load the draft into the form each time the editor opens.
  useEffect(() => {
    if (!open || !invoice) return;
    setSaveError(null);
    setPreview(null);
    setPreviewError(null);
    setCustomer(invoice.customer || { id: invoice.customerId, companyName: invoice.customerCompany, contactPerson: invoice.customerName, email: invoice.customerEmail });
    setPickingCustomer(false);
    setCustomerQuery('');
    setUseNewCustomerTerms(false);
    termsBeforeCustomerChange.current = null;
    setDepotId(invoice.depotId);
    setTerms({ paymentTerms: invoice.paymentTerms || '', paymentMethod: invoice.paymentMethod || '', incoterm: invoice.incoterm || '', incotermPlace: invoice.incotermPlace || '', deliveryTerms: printableDelivery(invoice.deliveryTerms) });
    setLines((invoice.items || []).map((it: any) => ({
      key: it.id, id: it.id, productId: it.productId, sku: it.productSku, name: it.productName, brand: it.brand,
      quantity: toStr(it.quantity), unitPrice: toStr(it.unitPrice), discountPercent: toStr(it.discountPercent || 0), taxRate: toStr(it.taxRate),
    })));
    setDiscountPercent(toStr(invoice.discountPercent || 0));
    setOtherCharges(toStr(invoice.otherCharges || 0));
    const manual = Boolean(invoice.freightIsManualOverride) || !(Number(invoice.freightRatePerKg) > 0);
    setFreightManual(manual);
    setManualFreight(toStr(invoice.shippingCost || 0));
    setFreightRate(toStr(invoice.freightRatePerKg || 0));
    setAdditionalFreight(toStr(invoice.additionalFreightCharges || 0));
    setNotes(invoice.notes || '');
    fetch('/api/depots?status=ACTIVE', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then((d) => setDepots(Array.isArray(d) ? d : [])).catch(() => setDepots([]));
    fetch('/api/products').then((r) => (r.ok ? r.json() : [])).then((p) => setProducts(Array.isArray(p) ? p : [])).catch(() => setProducts([]));
  }, [open, invoice]);

  // Customer search
  const debouncedCustomerQuery = useDebounce(customerQuery, 300);
  useEffect(() => {
    const q = debouncedCustomerQuery.trim();
    if (!q) { setCustomerResults([]); return; }
    let live = true;
    fetch(`/api/customers?q=${encodeURIComponent(q)}`).then((r) => (r.ok ? r.json() : [])).then((list) => { if (live) setCustomerResults(Array.isArray(list) ? list.slice(0, 8) : []); }).catch(() => {});
    return () => { live = false; };
  }, [debouncedCustomerQuery]);

  const customerChanged = !!customer && customer.id !== invoice?.customerId;
  const newCustomerDefaults = useMemo(() => (customerChanged ? defaultsFromCustomer(customer) : null), [customer, customerChanged]);

  const chooseCustomer = (c: any) => {
    if (!termsBeforeCustomerChange.current) termsBeforeCustomerChange.current = terms;
    setCustomer(c);
    setPickingCustomer(false);
    setCustomerQuery('');
    // Never overwrite what is on the invoice silently: the user decides below whether to take the new customer's terms.
    setUseNewCustomerTerms(false);
    if (termsBeforeCustomerChange.current) setTerms(termsBeforeCustomerChange.current);
  };
  const toggleNewCustomerTerms = (on: boolean) => {
    setUseNewCustomerTerms(on);
    const base = termsBeforeCustomerChange.current || terms;
    if (on && newCustomerDefaults) setTerms({ ...base, paymentTerms: newCustomerDefaults.paymentTerms, paymentMethod: newCustomerDefaults.paymentMethod });
    else setTerms(base);
  };

  // Product add
  const productMatches = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => p.status !== 'INACTIVE' && `${p.name} ${p.sku} ${p.brand}`.toLowerCase().includes(q)).slice(0, 8);
  }, [products, productQuery]);
  const addProduct = (p: any) => {
    setProductQuery('');
    setLines((ls) => {
      const dup = ls.find((l) => l.productId === p.id);
      if (dup) return ls.map((l) => (l === dup ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
      return [...ls, { key: `new-${p.id}-${Date.now()}`, productId: p.id, sku: p.sku, name: p.name, brand: p.brand, quantity: '1', unitPrice: String(p.wholesalePrice || p.sellingPrice || 0), discountPercent: '0', taxRate: '' }];
    });
  };
  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // The whole edit as the server expects it. Sent for the preview and for the save.
  const payload = useMemo(() => ({
    customerId: customer?.id,
    depotId,
    ...terms,
    discountPercent: Number(discountPercent) || 0,
    otherCharges: Number(otherCharges) || 0,
    freight: freightManual
      ? { isManualOverride: true, manualTotalFreight: Number(manualFreight) || 0 }
      : { isManualOverride: false, freightRatePerKg: Number(freightRate) || 0, additionalFreightCharges: Number(additionalFreight) || 0 },
    notes,
    items: lines.map((l) => ({
      id: l.id, productId: l.productId, quantity: Number(l.quantity), unitPrice: l.unitPrice === '' ? NaN : Number(l.unitPrice),
      discountPercent: Number(l.discountPercent) || 0, taxRate: l.taxRate === '' ? null : Number(l.taxRate),
    })),
  }), [customer, depotId, terms, discountPercent, otherCharges, freightManual, manualFreight, freightRate, additionalFreight, notes, lines]);

  // Live recalculation by the server.
  const payloadKey = JSON.stringify(payload);
  const debouncedKey = useDebounce(payloadKey, 350);
  useEffect(() => {
    if (!open || !invoice || !customer || !lines.length) { setPreview(null); return; }
    let live = true;
    setPreviewing(true);
    fetch(`/api/invoices/${invoice.id}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: debouncedKey })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) { setPreviewError(j.error || 'Could not recalculate.'); return; }
        setPreviewError(null);
        setPreview(j);
      })
      .catch(() => live && setPreviewError('Could not recalculate. Check your connection.'))
      .finally(() => live && setPreviewing(false));
    return () => { live = false; };
  }, [debouncedKey, open]);

  const stockByProduct = useMemo(() => new Map((preview?.stock || []).map((s) => [s.productId, s])), [preview]);
  const shortCount = (preview?.stock || []).filter((s) => s.short).length;
  const inputsValid = lines.length > 0 && lines.every((l) => Number.isInteger(Number(l.quantity)) && Number(l.quantity) >= 1 && l.unitPrice !== '' && Number(l.unitPrice) >= 0);
  const stale = payloadKey !== debouncedKey || previewing;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, expectedUpdatedAt: invoice.updatedAt }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setSaveError(j.error || 'Could not save the invoice.'); return; }
      onSaved(j.invoice, j.changes || []);
      onClose();
    } catch {
      setSaveError('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!invoice) return null;
  const currentDepotInactive = depots.length > 0 && !depots.some((d) => d.id === invoice.depotId);
  const t = preview?.totals;

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      size="3xl"
      title="Edit draft tax invoice"
      description={`Changes apply to this invoice only${invoice.proformaNumber ? `; proforma ${invoice.proformaNumber} stays as it was` : ''}. Totals are recalculated as you type.`}
      footer={
        <>
          <span className="mr-auto hidden text-xs text-muted sm:block">
            {preview?.changes?.length ? `${preview.changes.length} unsaved change${preview.changes.length === 1 ? '' : 's'}` : 'No changes yet'}
          </span>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!inputsValid || !!previewError || stale || !preview?.changes?.length}>Save changes</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {saveError && <div role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-3 text-xs text-danger">{saveError}</div>}

          {/* Customer */}
          <section className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted">Customer</h4>
            {!pickingCustomer ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <UserRound className="h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{customer?.companyName}</div>
                    <div className="truncate text-xs text-muted">{customer?.contactPerson} · {customer?.email}</div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {customerChanged && <Button size="sm" variant="ghost" onClick={() => chooseCustomer(invoice.customer || { id: invoice.customerId, companyName: invoice.customerCompany, contactPerson: invoice.customerName, email: invoice.customerEmail })}>Undo</Button>}
                  <Button size="sm" variant="outline" onClick={() => setPickingCustomer(true)}>Change</Button>
                </div>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
                <input autoFocus className={`${field} pl-9 pr-9`} placeholder="Search customers by company, contact, code or email" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} />
                <button type="button" aria-label="Cancel" onClick={() => setPickingCustomer(false)} className="absolute right-2 top-2 rounded p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
                {customerResults.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-popover">
                    {customerResults.map((c) => (
                      <li key={c.id}>
                        <button type="button" disabled={c.status === 'INACTIVE'} onClick={() => chooseCustomer(c)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface disabled:opacity-50">
                          <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{c.companyName}</span><span className="block truncate text-xs text-muted">{c.contactPerson} · {c.customerCode}</span></span>
                          {c.status !== 'ACTIVE' && <Badge tone={c.status === 'INACTIVE' ? 'danger' : 'warning'}>{c.status === 'INACTIVE' ? 'Inactive' : 'On hold'}</Badge>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {customerChanged && (
              <div className="space-y-2 rounded-lg border border-warning-border bg-warning-soft p-3 text-xs text-warning">
                <p className="flex items-start gap-1.5 font-semibold"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Changing the customer affects this invoice</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  <li>Name, email, phone, billing and shipping address are replaced with {customer.companyName}'s details.</li>
                  <li>The amount moves to {customer.companyName}'s balance when the invoice is issued.</li>
                  {newCustomerDefaults && (newCustomerDefaults.paymentTerms || newCustomerDefaults.paymentMethod) && (
                    <li>Their usual terms are <strong>{newCustomerDefaults.paymentTerms || 'Not specified'}</strong>{newCustomerDefaults.paymentMethod ? <> / <strong>{newCustomerDefaults.paymentMethod}</strong></> : null}. The invoice keeps its current terms unless you choose otherwise.</li>
                  )}
                </ul>
                {newCustomerDefaults && (newCustomerDefaults.paymentTerms || newCustomerDefaults.paymentMethod) && (
                  <label className="flex items-center gap-2 font-medium text-ink">
                    <input type="checkbox" checked={useNewCustomerTerms} onChange={(e) => toggleNewCustomerTerms(e.target.checked)} />
                    Use {customer.companyName}'s payment terms and method
                  </label>
                )}
              </div>
            )}
          </section>

          {/* Depot + terms */}
          <section className="space-y-3">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted">Dispatch & terms</h4>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-ink">Dispatch Depot</span>
              <select aria-label="Dispatch Depot" className={field} value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                {currentDepotInactive && <option value={invoice.depotId} disabled>{invoice.depotName} (inactive)</option>}
                {depots.map((d) => <option key={d.id} value={d.id}>{d.name}{d.code ? ` · ${d.code}` : ''}</option>)}
              </select>
              {depots.length === 0 && <span className="text-[11px] text-warning">No active depot is available. Activate or add one under Depot Management.</span>}
            </label>
            <TermsFields value={terms} onChange={(next) => setTerms(next)} />
          </section>

          {/* Items */}
          <section className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted">Products</h4>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
              <input className={`${field} pl-9`} placeholder="Add a product: search by name, SKU or brand" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} />
              {productMatches.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-popover">
                  {productMatches.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => addProduct(p)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface">
                        <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{p.name}</span><span className="block truncate font-mono text-xs text-muted">{p.sku} · {p.brand}</span></span>
                        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary"><Plus className="h-3.5 w-3.5" />Add</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {lines.length === 0 && <p className="rounded-lg border border-warning-border bg-warning-soft p-3 text-xs text-warning">An invoice needs at least one product. Add one above.</p>}
            <div className="space-y-2">
              {lines.map((l, i) => {
                const pl = preview?.lines?.[i];
                const st = stockByProduct.get(l.productId);
                return (
                  <div key={l.key} className={`rounded-lg border p-3 ${st?.short ? 'border-danger-border' : 'border-line'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-ink">{l.name}</div>
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted">
                          {l.sku} · {l.brand}
                          {!l.id && <Badge tone="primary">New</Badge>}
                          {st && (st.short
                            ? <Badge tone="danger">Only {st.available} available</Badge>
                            : <span className="font-sans text-[11px] text-success">{st.available} available</span>)}
                        </div>
                      </div>
                      <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-danger hover:bg-danger-soft">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <label className="text-[11px] font-medium text-ink">Qty
                        <input className={`${field} mt-1`} type="number" inputMode="numeric" min={1} step={1} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                      </label>
                      <label className="text-[11px] font-medium text-ink">Unit price
                        <input className={`${field} mt-1`} type="number" inputMode="decimal" min={0} step="0.01" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} />
                      </label>
                      <label className="text-[11px] font-medium text-ink">Disc. %
                        <input className={`${field} mt-1`} type="number" inputMode="decimal" min={0} max={100} step="0.01" value={l.discountPercent} onChange={(e) => setLine(l.key, { discountPercent: e.target.value })} />
                      </label>
                      <label className="text-[11px] font-medium text-ink">Tax %
                        <input className={`${field} mt-1`} type="number" inputMode="decimal" min={0} max={100} step="0.01" placeholder={pl ? String(pl.taxRate) : 'Product rate'} value={l.taxRate} onChange={(e) => setLine(l.key, { taxRate: e.target.value })} />
                      </label>
                      <div className="col-span-2 self-end text-right sm:col-span-1">
                        <div className="text-[10px] uppercase tracking-wider text-muted">Line total</div>
                        <div className="font-mono text-sm font-semibold text-ink">{pl ? formatUSD(pl.totalPrice) : '—'}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Charges & notes */}
          <section className="space-y-3">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted">Discount, freight & charges</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Invoice discount (%)" type="number" min={0} max={100} step="0.01" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} />
              <Input label="Additional charges (USD)" type="number" min={0} step="0.01" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} />
            </div>
            <div className="space-y-2 rounded-lg border border-line p-3">
              <div className="flex flex-wrap gap-4 text-xs">
                <label className="flex items-center gap-1.5"><input type="radio" checked={freightManual} onChange={() => setFreightManual(true)} /> Fixed freight amount</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={!freightManual} onChange={() => setFreightManual(false)} /> Rate × chargeable weight</label>
              </div>
              {freightManual ? (
                <Input label="Freight (USD)" type="number" min={0} step="0.01" value={manualFreight} onChange={(e) => setManualFreight(e.target.value)} />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input label="Rate per kg (USD)" type="number" min={0} step="0.01" value={freightRate} onChange={(e) => setFreightRate(e.target.value)}
                    hint={t ? `Chargeable weight ${t.freight.chargeableWeightKg.toFixed(2)} kg → ${formatUSD(t.freight.freightCharge)}` : undefined} />
                  <Input label="Additional freight (USD)" type="number" min={0} step="0.01" value={additionalFreight} onChange={(e) => setAdditionalFreight(e.target.value)} />
                </div>
              )}
            </div>
            <Textarea label="Notes / Terms & Conditions" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </section>
        </div>

        {/* Summary */}
        <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <div className="space-y-1.5 rounded-lg bg-surface p-3 font-mono text-xs">
            <div className="mb-1 flex items-center justify-between font-sans text-[11px] font-bold uppercase tracking-wider text-muted">
              Totals {stale && <span className="font-normal normal-case tracking-normal">recalculating…</span>}
            </div>
            {t ? (
              <>
                <Row k="Subtotal" v={formatUSD(t.subtotal)} />
                {t.discountAmount > 0 && <Row k="Discount" v={`−${formatUSD(t.discountAmount)}`} />}
                <Row k="Tax" v={formatUSD(t.taxAmount)} />
                <Row k="Freight" v={formatUSD(t.shippingCost)} />
                {t.otherCharges > 0 && <Row k="Additional charges" v={formatUSD(t.otherCharges)} />}
                <div className="flex justify-between border-t border-line pt-1.5 text-sm font-bold"><span>Grand total</span><span className="text-primary">{formatUSD(t.grandTotal)}</span></div>
                <div className="pt-1 font-sans text-[11px] text-muted">Was {formatUSD(invoice.grandTotal)}</div>
              </>
            ) : (
              <div className="font-sans text-muted">{lines.length ? 'Calculating…' : 'Add a product to see totals.'}</div>
            )}
          </div>
          {previewError && <div role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-3 text-xs text-danger">{previewError}</div>}
          {shortCount > 0 && (
            <div className="rounded-lg border border-danger-border bg-danger-soft p-3 text-xs text-danger">
              {shortCount} product{shortCount === 1 ? ' is' : 's are'} short at the selected depot. You can save the draft, but it cannot be issued until stock is available.
            </div>
          )}
          {(preview?.warnings || []).map((w) => (
            <div key={w} className="flex items-start gap-1.5 rounded-lg border border-warning-border bg-warning-soft p-3 text-xs text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</div>
          ))}
          {!!preview?.changes?.length && (
            <div className="rounded-lg border border-line p-3 text-xs">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">Changes to save</div>
              <ul className="list-disc space-y-0.5 pl-4 text-ink-secondary">{preview.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
        </aside>
      </div>
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-ink-secondary"><span>{k}</span><span className="text-ink">{v}</span></div>;
}
