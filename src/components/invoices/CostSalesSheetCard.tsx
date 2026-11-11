'use client';
import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

const n = (v: number | null | undefined, dp = 2) => (v === null || v === undefined ? null : v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }));

/** Internal Cost & Sales Sheet of this invoice: on-screen view and Excel download. Only rendered for users who may see costs. */
export function CostSalesSheetCard({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = async () => {
    setOpen(true); setLoading(true); setError(null); setSheet(null);
    try {
      const r = await fetch(`/api/invoices/${invoiceId}/cost-sheet`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.error || 'The report could not be generated.'); else setSheet(j);
    } catch (e: any) { setError(e?.message || 'Network error'); } finally { setLoading(false); }
  };
  const download = async () => {
    try {
      const r = await fetch(`/api/invoices/${invoiceId}/cost-sheet?format=xlsx`);
      if (!r.ok) { const j = await r.json().catch(() => ({})); toast({ title: 'Not downloaded', description: j.error || 'The report could not be generated.', variant: 'error' } as any); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = url; a.download = `Cost_Sales_Sheet_${invoiceNumber.replace(/[^A-Za-z0-9_-]+/g, '_')}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) { toast({ title: 'Not downloaded', description: e?.message || 'Network error', variant: 'error' } as any); }
  };
  const costCur = sheet ? (sheet.costCurrencies.length ? sheet.costCurrencies.join('/') : sheet.baseCurrency) : '';

  return (
    <Card className="p-5 space-y-3 text-xs" data-testid="cost-sheet-card">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Cost &amp; Sales Sheet</h3>
      <p className="text-muted">Internal report: actual dispatched cost, supplier, depot and selling price of every product on this invoice.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={view} data-testid="cost-sheet-view">View Report</Button>
        <Button size="sm" variant="outline" onClick={download} data-testid="cost-sheet-download">Download Excel</Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={`Cost & Sales Sheet - ${invoiceNumber}`} size="xl" footer={<Button size="sm" onClick={download}>Download Excel</Button>}>
        {loading && <p className="text-muted">Loading…</p>}
        {error && <div role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-2.5 text-danger">{error}</div>}
        {sheet && (
          <div className="space-y-3 text-xs" data-testid="cost-sheet-report">
            <p><b>Invoice Number:</b> {sheet.invoiceNumber} &nbsp; <b>Customer Name:</b> {sheet.customerName}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead><tr className="bg-surface-muted">{['Sl. No', 'SKU', 'Product Desc', 'Qty', `Cost ${costCur}`, 'Supplier', 'Depot', `Sell ${sheet.sellCurrency}`].map((h) => <th key={h} className="border border-line-soft px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {sheet.rows.map((r: any) => (
                    <tr key={r.slNo} data-testid="cost-row">
                      <td className="border border-line-soft px-2 py-1">{r.slNo}</td>
                      <td className="border border-line-soft px-2 py-1">{r.sku}</td>
                      <td className="border border-line-soft px-2 py-1">{r.description}</td>
                      <td className="border border-line-soft px-2 py-1 text-right">{r.qty}</td>
                      <td className="border border-line-soft px-2 py-1 text-right">{r.unitCost === null ? <b className="text-danger">MISSING</b> : n(r.unitCost, 4)}</td>
                      <td className="border border-line-soft px-2 py-1">{r.supplier || <b className="text-danger">MISSING</b>}</td>
                      <td className="border border-line-soft px-2 py-1">{r.depot || <b className="text-danger">MISSING</b>}</td>
                      <td className="border border-line-soft px-2 py-1 text-right">{n(r.unitSell)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg border border-line-soft p-2.5 space-y-0.5" data-testid="cost-summary">
              <p className="font-bold uppercase tracking-wider text-muted">Summary (additional information)</p>
              <p>Total Quantity: <b>{sheet.summary.totalQty}</b></p>
              <p>Total Cost ({costCur}): <b>{sheet.summary.totalCost === null ? 'INCOMPLETE' : n(sheet.summary.totalCost)}</b></p>
              <p>Total Sales ({sheet.sellCurrency}): <b>{n(sheet.summary.totalSales)}</b></p>
              <p>Gross Profit: <b>{sheet.summary.grossProfit === null ? 'n/a' : `${sheet.sellCurrency} ${n(sheet.summary.grossProfit)}`}</b></p>
              <p>Gross Profit Margin: <b>{sheet.summary.marginPercent === null ? 'n/a' : `${sheet.summary.marginPercent}%`}</b></p>
              {sheet.summary.profitNote && <p className="text-danger font-semibold">{sheet.summary.profitNote}</p>}
            </div>
            <ul className="list-disc pl-4 text-muted space-y-0.5">{sheet.notes.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
      </Modal>
    </Card>
  );
}
