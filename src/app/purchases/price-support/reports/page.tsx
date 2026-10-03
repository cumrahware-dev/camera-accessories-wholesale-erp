'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmptyRow } from '@/components/ui/Table';
import { ErrorState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { downloadReportPdf } from '@/lib/report-pdf';
import { apiJson, fmtDate, money, SUPPORT_STATUS_LABEL, SupportStatusBadge } from '@/components/purchasing/parts';

const TABS = [
  { key: 'supplier', label: 'By supplier' },
  { key: 'invoice', label: 'By invoice' },
  { key: 'date', label: 'By date' },
  { key: 'status', label: 'By status' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export default function PriceSupportReportsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('supplier');
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [f, setF] = useState({ supplierId: '', status: '', from: '', to: '' });
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { apiJson<any>('/api/suppliers').then((s) => setSuppliers(Array.isArray(s) ? s : s.suppliers || [])).catch(() => {}); }, []);
  useEffect(() => {
    const sp = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    setData(null);
    apiJson<any>(`/api/price-support/reports?${sp}`).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, [f]);

  // amounts are shown in each entry's currency; totals assume one currency per filter (noted when mixed)
  const currency = data?.rows?.[0]?.currency || 'USD';
  const mixed = data ? new Set(data.rows.map((r: any) => r.currency)).size > 1 : false;
  const m = (n: number) => money(n, currency);
  const supplierName = f.supplierId ? suppliers.find((s) => s.id === f.supplierId)?.name : 'All suppliers';

  const exportPdf = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await downloadReportPdf({
        title: 'Supplier Price Support Report',
        subtitle: 'Post-purchase supplier discounts / rebates. Recorded separately; stock valuation and original invoices are unchanged.',
        filters: [`Supplier: ${supplierName}`, `Status: ${f.status ? SUPPORT_STATUS_LABEL[f.status] : 'All (rejected excluded from totals)'}`, `Period: ${f.from || 'start'} – ${f.to || 'today'}`, ...(mixed ? ['Mixed currencies: totals are not converted'] : [])],
        kpis: [
          { label: 'Posted (received)', value: m(data.totals.posted) },
          { label: 'Recorded (excl. rejected)', value: m(data.totals.all) },
          { label: 'Entries', value: String(data.totals.count) },
          ...data.statusSummary.filter((s: any) => s.status === 'PENDING_APPROVAL' || s.status === 'APPROVED').map((s: any) => ({ label: SUPPORT_STATUS_LABEL[s.status], value: m(s.amount) })),
        ],
        sections: [
          { title: 'Total support received by supplier', head: ['Supplier', 'Entries', 'Posted', 'Pending / approved', 'Total recorded'], rows: data.bySupplier.map((s: any) => [s.supplierName, s.count, m(s.posted), m(s.pending), m(s.total)]), right: [1, 2, 3, 4], foot: ['Total', data.totals.count, m(data.totals.posted), '', m(data.totals.all)] },
          { title: 'Invoice-wise price support history', head: ['Supplier invoice', 'Purchase ref', 'Supplier', 'Support', 'Reference', 'Date', 'Status', 'Amount'], rows: data.byInvoice.flatMap((i: any) => i.entries.map((e: any) => [i.originalInvoiceNumber, i.purchaseNumber, i.supplierName, e.supportNumber, e.supportReference, fmtDate(e.supportDate), SUPPORT_STATUS_LABEL[e.status], m(e.amount)])), right: [7] },
          { title: 'Date-wise price support', head: ['Date', 'Entries', 'Posted', 'Total recorded'], rows: data.byDate.map((d: any) => [fmtDate(d.date), d.count, m(d.posted), m(d.total)]), right: [1, 2, 3] },
          { title: 'Pending / approved / posted', head: ['Status', 'Entries', 'Amount'], rows: data.statusSummary.map((s: any) => [SUPPORT_STATUS_LABEL[s.status], s.count, m(s.amount)]), right: [1, 2] },
        ],
        landscape: true,
        filename: `price-support-report-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
    } catch (e) {
      console.error(e);
      toast({ title: 'Could not create the PDF', variant: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        breadcrumbs={[{ label: 'Supplier Price Support', href: '/purchases/price-support' }, { label: 'Reports' }]}
        title="Price Support Reports"
        description="Supplier-wise, invoice-wise and date-wise support, and what is still pending."
        actions={<Button iconLeft={<Download className="h-4 w-4" />} onClick={exportPdf} loading={exporting} disabled={!data || data.rows.length === 0}>Download PDF</Button>}
      />

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Select label="Supplier" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} options={[{ label: 'All suppliers', value: '' }, ...suppliers.map((s) => ({ label: s.name, value: s.id }))]} wrapperClassName="col-span-2 lg:col-span-1" />
          <Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ label: 'All statuses', value: '' }, ...Object.entries(SUPPORT_STATUS_LABEL).map(([value, label]) => ({ value, label }))]} wrapperClassName="col-span-2 lg:col-span-1" />
          <Input id="r-from" label="Support date from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          <Input id="r-to" label="To" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
      </Card>

      {error ? <ErrorState title="Could not load the report" description={error} /> : !data ? <SkeletonTable rows={5} cols={5} /> : (
        <>
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-surface lg:grid-cols-4">
            {[
              ['Posted (received)', m(data.totals.posted)],
              ['Recorded excl. rejected', m(data.totals.all)],
              ['Pending approval', m(data.statusSummary.find((s: any) => s.status === 'PENDING_APPROVAL')?.amount || 0)],
              ['Approved, not posted', m(data.statusSummary.find((s: any) => s.status === 'APPROVED')?.amount || 0)],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 border-line p-4 [&:not(:last-child)]:border-r">
                <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
                <div className="mt-1.5 break-words text-xl font-semibold text-ink">{value}</div>
              </div>
            ))}
          </div>
          {mixed && <p className="text-xs text-warning">Entries in more than one currency are included; totals are not converted. Filter by supplier for single-currency totals.</p>}

          <div role="tablist" className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`min-h-[44px] rounded-full border px-4 text-sm font-semibold md:min-h-9 ${tab === t.key ? 'border-primary bg-primary text-white' : 'border-line bg-white text-ink-secondary'}`}>{t.label}</button>
            ))}
          </div>

          {tab === 'supplier' && (
            <Table>
              <TableHeader><TableHead>Supplier</TableHead><TableHead align="right">Entries</TableHead><TableHead align="right">Posted</TableHead><TableHead align="right">Pending / approved</TableHead><TableHead align="right">Total recorded</TableHead></TableHeader>
              <TableBody>
                {data.bySupplier.length === 0 && <TableEmptyRow colSpan={5}><p className="p-6 text-center text-sm text-muted">No price support for these filters.</p></TableEmptyRow>}
                {data.bySupplier.map((s: any) => (
                  <TableRow key={s.supplierId}>
                    <TableCell className="font-semibold">{s.supplierName}</TableCell>
                    <TableCell align="right" className="font-mono">{s.count}</TableCell>
                    <TableCell align="right" className="font-mono font-semibold">{m(s.posted)}</TableCell>
                    <TableCell align="right" className="font-mono text-muted">{m(s.pending)}</TableCell>
                    <TableCell align="right" className="font-mono">{m(s.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {tab === 'invoice' && (
            <div className="space-y-4">
              {data.byInvoice.length === 0 && <p className="rounded-xl border border-line p-6 text-center text-sm text-muted">No price support for these filters.</p>}
              {data.byInvoice.map((i: any) => (
                <Card key={i.purchaseInvoiceId} className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div><Link href={`/purchases/${i.purchaseInvoiceId}`} className="font-mono font-semibold text-primary hover:underline">{i.originalInvoiceNumber}</Link><span className="ml-2 text-xs text-muted">{i.purchaseNumber} · {i.supplierName} · invoiced {fmtDate(i.invoiceDate)}</span></div>
                    <div className="text-sm">Posted support <span className="font-mono font-semibold">{m(i.posted)}</span></div>
                  </div>
                  <ul className="mt-3 divide-y divide-line-soft">
                    {i.entries.map((e: any) => (
                      <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span className="min-w-0"><Link href={`/purchases/price-support/${e.id}`} className="font-mono hover:underline">{e.supportNumber}</Link> <span className="text-muted">· {e.supportReference} · {fmtDate(e.supportDate)}</span></span>
                        <span className="flex items-center gap-3"><SupportStatusBadge status={e.status} /><span className="font-mono font-semibold">{m(e.amount)}</span></span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}

          {tab === 'date' && (
            <Table>
              <TableHeader><TableHead>Support date</TableHead><TableHead align="right">Entries</TableHead><TableHead align="right">Posted</TableHead><TableHead align="right">Total recorded</TableHead></TableHeader>
              <TableBody>
                {data.byDate.length === 0 && <TableEmptyRow colSpan={4}><p className="p-6 text-center text-sm text-muted">No price support for these filters.</p></TableEmptyRow>}
                {data.byDate.map((d: any) => (
                  <TableRow key={d.date}><TableCell>{fmtDate(d.date)}</TableCell><TableCell align="right" className="font-mono">{d.count}</TableCell><TableCell align="right" className="font-mono font-semibold">{m(d.posted)}</TableCell><TableCell align="right" className="font-mono">{m(d.total)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {tab === 'status' && (
            <Table>
              <TableHeader><TableHead>Status</TableHead><TableHead align="right">Entries</TableHead><TableHead align="right">Amount</TableHead></TableHeader>
              <TableBody>
                {data.statusSummary.map((s: any) => (
                  <TableRow key={s.status}><TableCell><SupportStatusBadge status={s.status} /></TableCell><TableCell align="right" className="font-mono">{s.count}</TableCell><TableCell align="right" className="font-mono font-semibold">{m(s.amount)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
