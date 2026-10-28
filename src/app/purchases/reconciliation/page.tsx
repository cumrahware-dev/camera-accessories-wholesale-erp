'use client';
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { ErrorState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { apiJson, fmtDateTime } from '@/components/purchasing/parts';
import { formatMoney } from '@/lib/utils';
import { formatQty } from '@/lib/quantity';

const STATUS_TONE: Record<string, any> = { OK: 'success', MISSING: 'danger', QTY_MISMATCH: 'warning', WRONG_DEPOT: 'warning', NO_PRODUCT: 'danger' };
const ISSUE_TEXT: Record<string, string> = {
  NO_JOURNAL: 'Posted without its accounting entry',
  FOREIGN_NO_RATE: 'Posted in a foreign currency before exchange rates existed: its stock cost was booked unconverted',
  LINE_MISSING: 'Some lines never reached stock (repairable)',
  LINE_QTY_MISMATCH: 'Movements do not add up to the posted quantity (review manually)',
  LINE_WRONG_DEPOT: 'Stock went to another depot (review manually)',
  LINE_NO_PRODUCT: 'A product on the invoice no longer exists',
  TOTAL_STALE: 'Product total differs from its depot rows (repairable)',
  NO_COST: 'In stock with a purchase cost of 0',
  NO_WHOLESALE_PRICE: 'No wholesale price set (wholesale value shows as 0)',
};

/** Posted purchase invoices against the stock they produced. Read-only until "Repair" is confirmed for one invoice. */
export default function PurchaseReconciliationPage() {
  const { toast } = useToast();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [repairing, setRepairing] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { setError(null); apiJson<any>(`/api/purchase-invoices/reconciliation?days=${days}`).then(setData).catch((e) => setError(e.message)); }, [days]);
  useEffect(() => { load(); }, [load]);

  const repair = async () => {
    setBusy(true);
    try {
      const r = await apiJson<any>('/api/purchase-invoices/reconciliation/repair', { method: 'POST', body: JSON.stringify({ invoiceId: repairing.id, confirm: true }) });
      toast({ title: `${r.purchaseNumber} reconciled`, description: `${r.repaired.length} missing movement(s) created, ${r.totals.length} product total(s) re-derived.`, variant: 'success' });
      setRepairing(null); load();
    } catch (e: any) { toast({ title: 'Repair failed', description: e.message, variant: 'error' }); } finally { setBusy(false); }
  };

  if (error) return <ErrorState title="Reconciliation could not be loaded" description={error} />;
  const cur = data?.baseCurrency || 'USD';
  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        breadcrumbs={[{ label: 'Purchase Invoices', href: '/purchases' }, { label: 'Stock reconciliation' }]}
        title="Purchase stock reconciliation"
        description="Every posted purchase invoice line compared with the stock movement it created, the depot balance and the product's cost. Nothing changes until you confirm a repair."
        actions={<select aria-label="Period" className="h-10 rounded-lg border border-line bg-white px-3 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[3, 7, 30, 90, 365].map((d) => <option key={d} value={d}>Posted in the last {d} days</option>)}</select>}
      />
      {!data ? <p className="text-sm text-muted">Checking…</p> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="recon-summary">
            {[['Posted invoices', data.summary.invoices], ['With issues', data.summary.withIssues], ['Lines missing in stock', data.summary.missingLines], ['Stale product totals', data.summary.staleTotals]].map(([k, v]) => (
              <Card key={k as string} className="p-4"><div className="text-xs uppercase tracking-wider text-muted">{k}</div><div className={`text-2xl font-semibold mt-1 ${Number(v) > 0 && k !== 'Posted invoices' ? 'text-danger' : 'text-ink'}`}>{v}</div></Card>
            ))}
          </div>
          {data.invoices.map((inv: any) => (
            <Card key={inv.id} className="p-4 space-y-3" data-testid="recon-invoice">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/purchases/${inv.id}`} className="font-mono font-semibold text-primary hover:underline">{inv.purchaseNumber}</Link>
                  <span className="ml-2 text-sm text-ink">{inv.supplierName} · {inv.supplierInvoiceNumber}</span>
                  <div className="text-xs text-muted">Depot {inv.depotName} · {inv.currency}{inv.exchangeRate && inv.currency !== cur ? ` @ ${inv.exchangeRate}` : ''} · posted {inv.postedAt ? fmtDateTime(inv.postedAt) : '—'}</div>
                </div>
                <div className="flex items-center gap-2">
                  {inv.issues.length === 0 ? <Badge tone="success">Reconciled</Badge> : inv.issues.map((i: string) => <Badge key={i} tone={i === 'FOREIGN_NO_RATE' ? 'warning' : 'danger'}>{i}</Badge>)}
                  {inv.repairable && <Button size="sm" onClick={() => setRepairing(inv)}>Repair missing stock</Button>}
                </div>
              </div>
              {inv.issues.length > 0 && <ul className="list-disc pl-5 text-xs text-ink-secondary">{inv.issues.map((i: string) => <li key={i}>{ISSUE_TEXT[i] || i}</li>)}</ul>}
              <Table>
                <TableHeader><TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead align="right">Posted</TableHead><TableHead align="right">Received (movements)</TableHead><TableHead align="right">Depot now</TableHead><TableHead>Status</TableHead></TableHeader>
                <TableBody>
                  {inv.lines.map((l: any) => (
                    <TableRow key={l.lineId}>
                      <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                      <TableCell>{l.name}</TableCell>
                      <TableCell align="right" className="font-mono">{formatQty(l.postedQty)} {l.unit}</TableCell>
                      <TableCell align="right" className="font-mono">{formatQty(l.movedQty)} {l.unit} ({l.movements})</TableCell>
                      <TableCell align="right" className="font-mono">{l.depotQtyNow == null ? '—' : `${formatQty(l.depotQtyNow)} ${l.unit}`}</TableCell>
                      <TableCell><Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ))}
          {data.products.some((p: any) => p.issues.length) && (
            <Card className="p-4 space-y-2" data-testid="recon-products">
              <h3 className="text-sm font-semibold text-ink">Products on these invoices</h3>
              <Table>
                <TableHeader><TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead align="right">In depots</TableHead><TableHead align="right">Stored total</TableHead><TableHead align="right">Cost</TableHead><TableHead align="right">Stock value ({cur})</TableHead><TableHead>Notes</TableHead></TableHeader>
                <TableBody>
                  {data.products.filter((p: any) => p.issues.length).map((p: any) => (
                    <TableRow key={p.productId}>
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      <TableCell>{p.name}</TableCell>
                      <TableCell align="right" className="font-mono">{formatQty(p.depotTotal)} {p.unit}</TableCell>
                      <TableCell align="right" className="font-mono">{formatQty(p.storedTotal)}</TableCell>
                      <TableCell align="right" className="font-mono">{formatMoney(p.purchasePrice, cur)}</TableCell>
                      <TableCell align="right" className="font-mono">{formatMoney(p.costValue, cur)}</TableCell>
                      <TableCell className="text-xs">{p.issues.map((i: string) => ISSUE_TEXT[i] || i).join('; ')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!repairing}
        onClose={() => setRepairing(null)}
        onConfirm={repair}
        loading={busy}
        title={`Repair ${repairing?.purchaseNumber}?`}
        description="Creates the stock movements that are missing for this posted invoice (and re-derives stale product totals). The invoice, its amounts and its accounting entry are not changed. Recorded in the audit log; running it again does nothing."
        confirmLabel="Repair"
      />
    </div>
  );
}
