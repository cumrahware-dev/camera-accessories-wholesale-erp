'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatUSD } from '@/lib/utils';

interface Line { key: string; id?: string; productId: string; sku: string; name: string; brand: string; quantity: string; unitPrice: string; taxRate: number }

/** Edit line items (add / delete / quantity / price) of a tax invoice that has not entered picking yet. */
export default function EditInvoiceItemsModal({ invoice, open, onClose, onSaved }: {
  invoice: any; open: boolean; onClose: () => void; onSaved: (invoice: any) => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setQuery('');
    setLines((invoice.items || []).map((it: any) => ({
      key: it.id, id: it.id, productId: it.productId, sku: it.productSku, name: it.productName, brand: it.brand,
      quantity: String(it.quantity), unitPrice: String(it.unitPrice), taxRate: Number(it.taxRate) || 0,
    })));
    fetch('/api/products').then((r) => (r.ok ? r.json() : [])).then((p) => setProducts(Array.isArray(p) ? p : [])).catch(() => setProducts([]));
  }, [open, invoice]);

  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addProduct = (p: any) => {
    setQuery('');
    setLines((ls) => {
      const dup = ls.find((l) => l.productId === p.id);
      if (dup) return ls.map((l) => (l === dup ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
      return [...ls, { key: `new-${p.id}`, productId: p.id, sku: p.sku, name: p.name, brand: p.brand, quantity: '1', unitPrice: String(p.wholesalePrice || p.sellingPrice || 0), taxRate: Number(p.taxRate ?? 5) }];
    });
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => `${p.name} ${p.sku} ${p.brand}`.toLowerCase().includes(q)).slice(0, 8);
  }, [products, query]);

  const preview = useMemo(() => {
    const oldSub = Number(invoice.subtotal) || 0;
    const ratio = oldSub > 0 ? (Number(invoice.discountAmount) || 0) / oldSub : 0;
    let sub = 0, tax = 0;
    for (const l of lines) {
      const base = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
      const ex = (invoice.items || []).find((i: any) => i.id === l.id);
      const unchanged = ex && ex.quantity === Number(l.quantity) && Number(ex.unitPrice) === Number(l.unitPrice);
      sub += base;
      tax += unchanged ? Number(ex.taxAmount) : base * (l.taxRate / 100);
    }
    const disc = sub * ratio;
    const ship = (Number(invoice.shippingCost) || 0) + (Number(invoice.otherCharges) || 0);
    return { sub, tax, disc, ship, total: sub - disc + tax + ship };
  }, [lines, invoice]);

  const valid = lines.length > 0 && lines.every((l) => Number.isInteger(Number(l.quantity)) && Number(l.quantity) >= 1 && l.unitPrice !== '' && Number(l.unitPrice) >= 0);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: lines.map((l) => ({ id: l.id, productId: l.productId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Could not save the items.'); return; }
      onSaved(data.invoice);
      onClose();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const field = 'h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none md:h-10';

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      size="2xl"
      title={`Edit items · ${invoice.invoiceNumber}`}
      description="Add or remove products and change quantities or prices. Allowed until picking starts."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!valid}>Save changes</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-3 text-xs text-danger">{error}</div>}

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

        <div className="space-y-3">
          {lines.length === 0 && <p className="rounded-xl border border-warning-border bg-warning-soft p-3 text-xs text-warning">An invoice needs at least one item. Add a product above.</p>}
          {lines.map((l) => {
            const total = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
            return (
              <div key={l.key} className="rounded-xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{l.name}</div>
                    <div className="truncate font-mono text-xs text-muted">{l.sku} · {l.brand}{!l.id && <span className="ml-2 rounded bg-primary-soft px-1.5 py-0.5 font-sans text-[10px] font-semibold text-primary">NEW</span>}</div>
                  </div>
                  <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-danger hover:bg-danger-soft md:h-10 md:w-10">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <label className="text-xs font-medium text-ink">Quantity
                    <input className={`${field} mt-1`} type="number" inputMode="numeric" min={1} step={1} value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} />
                  </label>
                  <label className="text-xs font-medium text-ink">Unit price (USD)
                    <input className={`${field} mt-1`} type="number" inputMode="decimal" min={0} step="0.01" value={l.unitPrice} onChange={(e) => set(l.key, { unitPrice: e.target.value })} />
                  </label>
                  <div className="col-span-2 text-right sm:col-span-1 sm:self-end">
                    <div className="text-[11px] uppercase tracking-wider text-muted">Line (before tax)</div>
                    <div className="font-mono text-sm font-semibold text-ink">{formatUSD(total)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <dl className="space-y-1.5 rounded-xl bg-surface p-3 text-xs">
          <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="font-mono">{formatUSD(preview.sub)}</dd></div>
          {preview.disc > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="font-mono">−{formatUSD(preview.disc)}</dd></div>}
          <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="font-mono">{formatUSD(preview.tax)}</dd></div>
          {preview.ship > 0 && <div className="flex justify-between"><dt className="text-muted">Freight &amp; other charges</dt><dd className="font-mono">{formatUSD(preview.ship)}</dd></div>}
          <div className="flex justify-between border-t border-line pt-1.5 text-sm font-semibold"><dt>New total</dt><dd className="font-mono text-primary">{formatUSD(preview.total)}</dd></div>
          <div className="text-[11px] text-muted">Previous total: {formatUSD(invoice.grandTotal)}. The server recalculates everything when you save.</div>
        </dl>
      </div>
    </Modal>
  );
}
