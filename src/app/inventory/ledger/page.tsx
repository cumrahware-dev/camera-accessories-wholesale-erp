'use client';
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { formatMoney } from '@/lib/utils';
import { formatQty } from '@/lib/quantity';
import { useBaseCurrency } from '@/lib/hooks/useBaseCurrency';
import { fetchAllProducts } from '@/lib/fetch-all-products';
import { fetchCurrentUserCached } from '@/lib/client-cache';
import { hasPermission } from '@/lib/rbac';

const TYPE_LABEL: Record<string, string> = { STOCK_IN: 'Purchase / stock in', SALE_DISPATCH: 'Sale dispatch', STOCK_TRANSFER: 'Transfer', STOCK_ADJUSTMENT: 'Adjustment', RETURN: 'Return' };
const TYPE_TONE: Record<string, any> = { STOCK_IN: 'success', SALE_DISPATCH: 'info', STOCK_TRANSFER: 'neutral', STOCK_ADJUSTMENT: 'warning', RETURN: 'success' };
const sel = 'h-10 rounded-lg border border-line bg-white px-3 text-sm';

function LedgerInner() {
  const sp = useSearchParams();
  const { toast } = useToast();
  const currency = useBaseCurrency();
  const [products, setProducts] = useState<any[]>([]);
  const [depots, setDepots] = useState<any[]>([]);
  const [role, setRole] = useState('');
  const [f, setF] = useState({ productId: sp.get('productId') || '', depotId: sp.get('depotId') || '', type: '', from: '', to: '', q: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [check, setCheck] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpening, setConfirmOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const LIMIT = 100;

  useEffect(() => {
    fetchAllProducts().then(setProducts).catch(() => {});
    fetch('/api/depots', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then((d) => setDepots(Array.isArray(d) ? d : [])).catch(() => {});
    fetchCurrentUserCached().then((u: any) => setRole(u?.user?.role || '')).catch(() => {});
  }, []);
  const load = useCallback(() => {
    setError(null); setData(null);
    const p = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    Object.entries(f).forEach(([k, v]) => v && p.set(k, v));
    fetch(`/api/inventory/ledger?${p}`, { cache: 'no-store' }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed'); setData(j); }).catch((e) => setError(e.message));
  }, [f, page]);
  useEffect(() => { load(); }, [load]);
  const loadCheck = useCallback(() => { fetch('/api/inventory/ledger?check=1', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then(setCheck).catch(() => {}); }, []);
  useEffect(() => { loadCheck(); }, [loadCheck]);

  const product = useMemo(() => products.find((p) => p.id === f.productId), [products, f.productId]);
  const set = (k: keyof typeof f, v: string) => { setPage(1); setF({ ...f, [k]: v }); };
  const money = (n: number) => formatMoney(n, currency);
  const qty = (n: number, unit?: string) => `${formatQty(n)}${unit ? ` ${unit}` : ''}`;

  const recordOpening = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/inventory/ledger/opening-balances', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      toast({ title: 'Ledger opening balances recorded', description: `${j.created} balance(s); no stock quantity changed.`, variant: 'success' });
      setConfirmOpening(false); loadCheck(); load();
    } catch (e: any) { toast({ title: 'Not recorded', description: e.message, variant: 'error' }); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Stock ledger' }]} title="Stock ledger" description="Every stock movement: purchases, dispatches, transfers, adjustments and returns, with the depot, user and value. Choose a product for its running balance." />

      {check && (
        <Card className="p-4 text-sm" data-testid="ledger-check">
          {check.differences.length === 0 ? (
            <div className="flex items-center gap-2"><Badge tone="success">Reconciled</Badge><span className="text-ink-secondary">All {check.checked} product/depot balances are explained by the ledger.</span></div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><Badge tone="warning">{check.differences.length} balance(s) not fully in the ledger</Badge> <span className="text-ink-secondary">Stock on hand that has no recorded movement (stock entered before every movement was logged).</span></div>
                {hasPermission(role as any, 'inventory.adjust') && <Button size="sm" variant="outline" onClick={() => setConfirmOpening(true)}>Record ledger opening balances</Button>}
              </div>
              <div className="max-h-48 overflow-auto text-xs">
                {check.differences.slice(0, 50).map((d: any) => <div key={`${d.productId}-${d.depotId}`} className="flex justify-between gap-3 border-b border-line-soft py-1"><span className="font-mono">{d.sku}</span><span className="text-muted">{d.depotName}</span><span>on hand {formatQty(d.balance)} · ledger {formatQty(d.ledger)} · not recorded {formatQty(d.unrecorded)}</span></div>)}
              </div>
            </div>
          )}
        </Card>
      )}

      <div className="flex flex-wrap gap-2" data-testid="ledger-filters">
        <select aria-label="Product" className={`${sel} min-w-64`} value={f.productId} onChange={(e) => set('productId', e.target.value)}>
          <option value="">All products</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
        </select>
        <select aria-label="Depot" className={sel} value={f.depotId} onChange={(e) => set('depotId', e.target.value)}>
          <option value="">All depots</option>
          {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select aria-label="Type" className={sel} value={f.type} onChange={(e) => set('type', e.target.value)}>
          <option value="">All movement types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input aria-label="From" type="date" className={sel} value={f.from} onChange={(e) => set('from', e.target.value)} />
        <input aria-label="To" type="date" className={sel} value={f.to} onChange={(e) => set('to', e.target.value)} />
        <input aria-label="Search reference or SKU" placeholder="Reference or SKU" className={sel} value={f.q} onChange={(e) => set('q', e.target.value)} />
      </div>

      {product && data?.opening && (
        <Card className="p-4 text-sm" data-testid="ledger-balance">
          <span className="font-semibold">{product.sku}</span> {f.depotId ? `in ${depots.find((d) => d.id === f.depotId)?.name || 'depot'}` : 'in all depots'}: on hand <span className="font-mono font-semibold">{qty(data.opening.currentBalance, product.unit)}</span>
          {data.opening.unrecorded !== 0 && <span className="text-warning"> · {qty(data.opening.unrecorded, product.unit)} not in the ledger (opening line)</span>}
        </Card>
      )}

      {error ? <ErrorState description={error} action={<Button onClick={load}>Try again</Button>} /> : !data ? <SkeletonTable rows={8} cols={8} /> : data.rows.length === 0 ? (
        <EmptyState title="No movements" description="Nothing matches these filters." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableHead>Date</TableHead><TableHead>Reference</TableHead><TableHead>Type</TableHead><TableHead>Product</TableHead><TableHead>From → To</TableHead>
              <TableHead align="right">In</TableHead><TableHead align="right">Out</TableHead>{product && !f.type && <TableHead align="right">Balance</TableHead>}
              <TableHead align="right">Unit cost</TableHead><TableHead align="right">Value</TableHead><TableHead>By</TableHead>
            </TableHeader>
            <TableBody>
              {data.rows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(r.date).toLocaleString('en-GB')}</TableCell>
                  <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                  <TableCell><Badge tone={TYPE_TONE[r.type]}>{TYPE_LABEL[r.type] || r.type}</Badge></TableCell>
                  <TableCell><div className="font-mono text-xs">{r.sku}</div><div className="text-xs text-muted">{r.name}</div></TableCell>
                  <TableCell className="text-xs">{r.fromDepot || '—'} → {r.toDepot || '—'}</TableCell>
                  <TableCell align="right" className="font-mono text-success">{r.qtyIn ? formatQty(r.qtyIn) : ''}</TableCell>
                  <TableCell align="right" className="font-mono text-danger">{r.qtyOut ? formatQty(r.qtyOut) : ''}</TableCell>
                  {product && !f.type && <TableCell align="right" className="font-mono font-semibold">{r.balance == null ? '—' : formatQty(r.balance)}</TableCell>}
                  <TableCell align="right" className="font-mono text-xs">{money(r.unitCost)}</TableCell>
                  <TableCell align="right" className={`font-mono text-xs ${r.valueImpact < 0 ? 'text-danger' : ''}`}>{r.valueImpact ? money(r.valueImpact) : ''}</TableCell>
                  <TableCell className="text-xs"><span title={r.notes}>{r.user}</span></TableCell>
                </TableRow>
              ))}
              {product && !f.type && data.opening && data.opening.unrecorded !== 0 && page * LIMIT >= data.total && (
                <TableRow><TableCell className="text-xs text-muted" colSpan={5}>Opening: stock on hand not in the ledger</TableCell><TableCell align="right" className="font-mono">{data.opening.unrecorded > 0 ? formatQty(data.opening.unrecorded) : ''}</TableCell><TableCell align="right" className="font-mono">{data.opening.unrecorded < 0 ? formatQty(-data.opening.unrecorded) : ''}</TableCell><TableCell align="right" className="font-mono font-semibold">{formatQty(data.opening.unrecorded)}</TableCell><TableCell colSpan={3}>{null}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
      {data && data.total > LIMIT && (
        <div className="flex items-center justify-end gap-2 text-sm"><span className="text-muted">{(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, data.total)} of {data.total}</span><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page * LIMIT >= data.total} onClick={() => setPage(page + 1)}>Next</Button></div>
      )}
      <ConfirmDialog open={confirmOpening} onClose={() => setConfirmOpening(false)} onConfirm={recordOpening} loading={busy} title="Record ledger opening balances?" description="Adds one labelled 'ledger opening balance' line for each balance listed above, so the ledger explains the stock on hand. No stock quantity changes. Recorded in the audit log." confirmLabel="Record" />
    </div>
  );
}

export default function StockLedgerPage() {
  return <Suspense fallback={<SkeletonTable rows={8} cols={8} />}><LedgerInner /></Suspense>;
}
