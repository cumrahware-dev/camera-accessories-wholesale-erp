'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgePercent, BarChart3, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmptyRow } from '@/components/ui/Table';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { hasPermission } from '@/lib/rbac';
import { apiJson, fmtDate, money, SUPPORT_STATUS_LABEL, SupportStatusBadge, useCan } from '@/components/purchasing/parts';

export default function PriceSupportListPage() {
  const role = useCan();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [f, setF] = useState({ q: '', status: '', supplierId: '', from: '', to: '' });

  useEffect(() => { apiJson<any>('/api/suppliers').then((s) => setSuppliers(Array.isArray(s) ? s : s.suppliers || [])).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
      apiJson<any[]>(`/api/price-support?${sp}`).then((r) => { setRows(r); setError(null); }).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [f]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows || []) m[r.status] = (m[r.status] || 0) + 1;
    return m;
  }, [rows]);

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        breadcrumbs={[{ label: 'Purchase Invoices', href: '/purchases' }, { label: 'Supplier Price Support' }]}
        title="Supplier Price Support"
        description="Discounts, rebates and price protection received from suppliers after an invoice was posted. Recorded separately and linked to the original invoice — stock valuation is never changed."
        actions={
          <>
            <LinkButton href="/purchases/price-support/reports" variant="outline" iconLeft={<BarChart3 className="h-4 w-4" />}>Reports</LinkButton>
            {hasPermission(role, 'price_support.write') && <LinkButton href="/purchases/price-support/new" iconLeft={<Plus className="h-4 w-4" />}>New Price Support</LinkButton>}
          </>
        }
      />

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Input id="ps-q" label="Search" placeholder="SPS / reference / invoice no." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} wrapperClassName="col-span-2 lg:col-span-1" />
          <Select label="Supplier" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} options={[{ label: 'All suppliers', value: '' }, ...suppliers.map((s) => ({ label: s.name, value: s.id }))]} wrapperClassName="col-span-2 lg:col-span-1" />
          <Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ label: 'All statuses', value: '' }, ...Object.entries(SUPPORT_STATUS_LABEL).map(([value, label]) => ({ value, label }))]} wrapperClassName="col-span-2 lg:col-span-1" />
          <Input id="ps-from" label="Support date from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          <Input id="ps-to" label="To" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
        {rows && rows.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {Object.entries(SUPPORT_STATUS_LABEL).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setF({ ...f, status: f.status === k ? '' : k })} className={`min-h-[36px] rounded-full border px-3 font-semibold ${f.status === k ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-white text-ink-secondary'}`}>
                {label} · {counts[k] || 0}
              </button>
            ))}
          </div>
        )}
      </Card>

      {error ? (
        <ErrorState title="Could not load price support" description={error} />
      ) : rows === null ? (
        <SkeletonTable rows={5} cols={7} />
      ) : rows.length === 0 && !Object.values(f).some(Boolean) ? (
        <EmptyState icon={BadgePercent} title="No price support recorded" description="Open a posted purchase invoice and choose “Record price support”, or start here." />
      ) : (
        <Table>
          <TableHeader>
            <TableHead>Support</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead>Original invoice</TableHead>
            <TableHead>Support date</TableHead>
            <TableHead align="right">Amount</TableHead>
            <TableHead>Status</TableHead>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableEmptyRow colSpan={7}><p className="p-6 text-center text-sm text-muted">Nothing matches these filters.</p></TableEmptyRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><Link href={`/purchases/price-support/${r.id}`} className="font-mono font-semibold text-primary hover:underline">{r.supportNumber}</Link></TableCell>
                <TableCell>{r.supplierName}</TableCell>
                <TableCell className="font-mono text-xs">{r.supportReference}</TableCell>
                <TableCell><Link href={`/purchases/${r.purchaseInvoiceId}`} className="font-mono text-xs hover:underline">{r.originalInvoiceNumber}</Link><div className="text-[11px] text-muted">{r.purchaseNumber}</div></TableCell>
                <TableCell className="text-muted">{fmtDate(r.supportDate)}</TableCell>
                <TableCell align="right" className="font-mono font-semibold">{money(r.amount, r.currency)}</TableCell>
                <TableCell><SupportStatusBadge status={r.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
