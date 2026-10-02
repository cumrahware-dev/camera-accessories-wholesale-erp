'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { BarChart3, Download } from 'lucide-react';
import { formatUSD, formatDate } from '@/lib/utils';
import { TaxInvoice, Depot } from '@/types/erp';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Select, Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { downloadReportPdf } from '@/lib/report-pdf';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';

export default function SalesReportsPage() {
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [selectedDepot, setSelectedDepot] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [invRes, depRes] = await Promise.all([fetch('/api/invoices'), fetch('/api/depots')]);
      const invData = invRes.ok ? await invRes.json() : [];
      const depData = depRes.ok ? await depRes.json() : [];
      setInvoices(Array.isArray(invData) ? invData : []);
      setDepots(Array.isArray(depData) ? depData : []);
    } catch {
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const { toast } = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [payment, setPayment] = useState('ALL');
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState(false);

  const setPreset = (preset: 'month' | '30' | 'ytd' | 'all') => {
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (preset === 'all') { setFrom(''); setTo(''); return; }
    setTo(iso(now));
    if (preset === 'month') setFrom(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
    if (preset === '30') setFrom(iso(new Date(now.getTime() - 29 * 86400000)));
    if (preset === 'ytd') setFrom(iso(new Date(now.getFullYear(), 0, 1)));
  };

  const filteredInvoices = invoices.filter((i) => {
    if (i.fulfilmentStatus === 'CANCELLED') return false;
    if (selectedDepot !== 'ALL' && i.depotId !== selectedDepot) return false;
    if (payment !== 'ALL' && i.paymentStatus !== payment) return false;
    const day = String(i.issueDate || '').slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    const q = query.trim().toLowerCase();
    if (q && !`${i.invoiceNumber} ${i.customerCompany} ${i.customerName}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const totalSales = filteredInvoices.reduce((sum, i) => sum + i.grandTotal, 0);
  const totalTax = filteredInvoices.reduce((sum, i) => sum + i.taxAmount, 0);
  const averageOrder = filteredInvoices.length > 0 ? totalSales / filteredInvoices.length : 0;
  const paidTotal = filteredInvoices.filter((i) => i.paymentStatus === 'PAID').reduce((sum, i) => sum + i.grandTotal, 0);
  const outstanding = totalSales - paidTotal;

  // breakdowns (all from the filtered, real invoices)
  const monthly = Object.values(
    filteredInvoices.reduce<Record<string, { key: string; label: string; count: number; total: number }>>((acc, i) => {
      const d = new Date(i.issueDate);
      if (isNaN(d.getTime())) return acc;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('en-GB', { month: 'short', year: 'numeric' });
      (acc[key] ||= { key, label, count: 0, total: 0 });
      acc[key].count += 1;
      acc[key].total += i.grandTotal;
      return acc;
    }, {})
  ).sort((a, b) => a.key.localeCompare(b.key));
  const maxMonth = Math.max(1, ...monthly.map((m) => m.total));

  const topCustomers = Object.values(
    filteredInvoices.reduce<Record<string, { name: string; count: number; total: number }>>((acc, i) => {
      const k = i.customerId || i.customerCompany;
      (acc[k] ||= { name: i.customerCompany || i.customerName, count: 0, total: 0 });
      acc[k].count += 1;
      acc[k].total += i.grandTotal;
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total).slice(0, 5);

  const topProducts = Object.values(
    filteredInvoices.reduce<Record<string, { sku: string; name: string; qty: number; total: number }>>((acc, i) => {
      for (const it of i.items || []) {
        (acc[it.productSku || it.productName] ||= { sku: it.productSku, name: it.productName, qty: 0, total: 0 });
        acc[it.productSku || it.productName].qty += it.quantity || 0;
        acc[it.productSku || it.productName].total += it.totalPrice || 0;
      }
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total).slice(0, 5);

  const depotName = selectedDepot === 'ALL' ? 'All depots' : depots.find((d) => d.id === selectedDepot)?.name || selectedDepot;
  const periodLabel = from || to ? `${from ? formatDate(from) : 'Start'} – ${to ? formatDate(to) : 'Today'}` : 'All time';
  const PAY_LABEL: Record<string, string> = { ALL: 'All payments', PAID: 'Paid', PARTIALLY_PAID: 'Partially paid', UNPAID: 'Unpaid' };

  const exportPdf = async () => {
    setExporting(true);
    try {
      await downloadReportPdf({
        title: 'Sales Report',
        subtitle: 'Invoiced revenue, tax collected and order volume (cancelled invoices excluded).',
        filters: [`Period: ${periodLabel}`, `Depot: ${depotName}`, `Payment: ${PAY_LABEL[payment]}`, ...(query ? [`Search: "${query}"`] : [])],
        kpis: [
          { label: 'Total sales', value: formatUSD(totalSales) },
          { label: 'Tax collected', value: formatUSD(totalTax) },
          { label: 'Invoices', value: String(filteredInvoices.length) },
          { label: 'Average order', value: formatUSD(averageOrder) },
          { label: 'Collected (paid)', value: formatUSD(paidTotal) },
          { label: 'Outstanding', value: formatUSD(outstanding) },
        ],
        sections: [
          { title: 'Sales by month', head: ['Month', 'Invoices', 'Sales'], rows: monthly.map((m) => [m.label, m.count, formatUSD(m.total)]), right: [1, 2] },
          { title: 'Top customers', head: ['Customer', 'Invoices', 'Sales'], rows: topCustomers.map((c) => [c.name, c.count, formatUSD(c.total)]), right: [1, 2] },
          { title: 'Top products', head: ['SKU', 'Product', 'Units', 'Sales'], rows: topProducts.map((p) => [p.sku, p.name, p.qty, formatUSD(p.total)]), right: [2, 3] },
          {
            title: 'Invoices',
            head: ['Invoice', 'Customer', 'Depot', 'Issued', 'Payment', 'Tax', 'Total'],
            rows: filteredInvoices.map((i) => [i.invoiceNumber, i.customerCompany, i.depotName, formatDate(i.issueDate), PAY_LABEL[i.paymentStatus] || i.paymentStatus, formatUSD(i.taxAmount), formatUSD(i.grandTotal)]),
            right: [5, 6],
            foot: ['Total', '', '', '', '', formatUSD(totalTax), formatUSD(totalSales)],
          },
        ],
        landscape: true,
        filename: `sales-report-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
    } catch (e) {
      console.error('PDF export failed', e);
      toast({ title: 'Could not create the PDF', description: 'Please try again.', variant: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Sales Reports"
        description="Invoiced revenue, tax collected, and order volume."
        actions={
          <Button iconLeft={<Download className="h-4 w-4" />} onClick={exportPdf} loading={exporting} disabled={loading || filteredInvoices.length === 0}>
            Download PDF
          </Button>
        }
      />

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Input id="sales-from" label="From" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          <Input id="sales-to" label="To" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          <Select
            label="Depot"
            options={[{ label: 'All depots', value: 'ALL' }, ...depots.map((d) => ({ label: d.name, value: d.id }))]}
            value={selectedDepot}
            onChange={(e) => setSelectedDepot(e.target.value)}
          />
          <Select
            label="Payment"
            options={Object.entries(PAY_LABEL).map(([value, label]) => ({ value, label }))}
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
          />
          <Input id="sales-search" wrapperClassName="col-span-2 lg:col-span-1" label="Search" placeholder="Invoice or customer" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {([['month', 'This month'], ['30', 'Last 30 days'], ['ytd', 'Year to date'], ['all', 'All time']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setPreset(k)} className="min-h-[44px] rounded-full border border-line bg-white px-4 text-xs font-semibold text-ink-secondary hover:bg-surface md:min-h-9">
              {label}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 border border-line rounded-2xl divide-x divide-y xl:divide-y-0 divide-line bg-surface overflow-hidden">
        {[
          ['Total Sales', formatUSD(totalSales), ''],
          ['Tax Collected', formatUSD(totalTax), ''],
          ['Invoices', String(filteredInvoices.length), ''],
          ['Average Order', formatUSD(averageOrder), ''],
          ['Collected', formatUSD(paidTotal), 'text-success'],
          ['Outstanding', formatUSD(outstanding), outstanding > 0 ? 'text-warning' : ''],
        ].map(([label, value, tone]) => (
          <div key={label} className="min-w-0 p-3.5 sm:p-4">
            <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
            <div className={`mt-1.5 break-words text-xl font-semibold text-ink sm:text-2xl ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      {!loading && filteredInvoices.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="p-4 lg:col-span-1">
            <h2 className="text-sm font-semibold text-ink">Sales by month</h2>
            <div className="mt-3 space-y-2.5">
              {monthly.map((m) => (
                <div key={m.key}>
                  <div className="flex items-center justify-between text-xs"><span className="text-ink-secondary">{m.label} <span className="text-muted">· {m.count}</span></span><span className="font-mono font-semibold text-ink">{formatUSD(m.total)}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-surface-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(3, (m.total / maxMonth) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-ink">Top customers</h2>
            <ol className="mt-3 divide-y divide-line-soft">
              {topCustomers.map((c, idx) => (
                <li key={c.name + idx} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-ink-secondary"><span className="mr-2 text-muted">{idx + 1}.</span>{c.name}</span>
                  <span className="shrink-0 font-mono font-semibold text-ink">{formatUSD(c.total)}</span>
                </li>
              ))}
            </ol>
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-ink">Top products</h2>
            <ol className="mt-3 divide-y divide-line-soft">
              {topProducts.length === 0 && <li className="py-2 text-xs text-muted">No line items on these invoices.</li>}
              {topProducts.map((p, idx) => (
                <li key={p.sku + idx} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-ink-secondary"><span className="mr-2 text-muted">{idx + 1}.</span>{p.name} <span className="text-muted">×{p.qty}</span></span>
                  <span className="shrink-0 font-mono font-semibold text-ink">{formatUSD(p.total)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : filteredInvoices.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title={invoices.length === 0 ? "No sales data yet" : "No invoices match these filters"}
          description={invoices.length === 0 ? "Sales figures appear here once proformas are converted into tax invoices." : "Widen the date range or clear the filters."}
        />
      ) : (
        <>
        <Card className="hidden md:block overflow-hidden p-0 border-0 rounded-none bg-transparent">
          <Table>
            <TableHeader>
              <TableHead>Invoice</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Depot</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead align="right">Tax</TableHead>
              <TableHead align="right">Total</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Status</TableHead>
            </TableHeader>
            <TableBody>
              {filteredInvoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link href={`/invoices/${inv.id}`} className="font-mono font-semibold text-primary hover:underline">
                      {inv.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{inv.customerCompany}</TableCell>
                  <TableCell className="text-muted">{inv.depotName}</TableCell>
                  <TableCell className="text-muted">{formatDate(inv.issueDate)}</TableCell>
                  <TableCell align="right" className="font-mono text-muted">{formatUSD(inv.taxAmount)}</TableCell>
                  <TableCell align="right" className="font-mono font-semibold">{formatUSD(inv.grandTotal)}</TableCell>
                  <TableCell className="text-xs text-muted">{PAY_LABEL[inv.paymentStatus] || inv.paymentStatus}</TableCell>
                  <TableCell>
                    <StatusBadge status={inv.fulfilmentStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="md:hidden space-y-3">
          {filteredInvoices.map((inv) => (
            <Card key={inv.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/invoices/${inv.id}`} className="font-mono font-semibold text-primary hover:underline text-sm">
                  {inv.invoiceNumber}
                </Link>
                <StatusBadge status={inv.fulfilmentStatus} />
              </div>
              <div className="text-xs text-ink-secondary">
                <div>{inv.customerCompany}</div>
                <div className="text-muted mt-0.5">{inv.depotName} · {formatDate(inv.issueDate)}</div>
              </div>
              <div className="flex items-center justify-between text-xs pt-1.5 border-t border-line-soft">
                <span className="text-muted">Tax: <span className="font-mono text-ink-secondary">{formatUSD(inv.taxAmount)}</span></span>
                <span className="font-mono font-semibold text-ink">{formatUSD(inv.grandTotal)}</span>
              </div>
            </Card>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
