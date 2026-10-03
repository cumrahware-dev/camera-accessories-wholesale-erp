'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, ShoppingBag, BadgePercent } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmptyRow } from '@/components/ui/Table';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { hasPermission } from '@/lib/rbac';
import { apiJson, fmtDate, money, PurchaseStatusBadge, useCan } from '@/components/purchasing/parts';

export default function PurchaseInvoicesPage() {
  const role = useCan();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set('q', q.trim());
      if (status) sp.set('status', status);
      apiJson<any[]>(`/api/purchase-invoices?${sp}`).then((r) => { setRows(r); setError(null); }).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, status]);

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Purchase Invoices"
        description="Supplier invoices received into stock. A posted invoice is locked: later supplier discounts are recorded as Supplier Price Support."
        actions={
          <>
            {hasPermission(role, 'price_support.read') && (
              <LinkButton href="/purchases/price-support" variant="outline" iconLeft={<BadgePercent className="h-4 w-4" />}>Price Support</LinkButton>
            )}
            {hasPermission(role, 'purchases.write') && (
              <LinkButton href="/purchases/new" iconLeft={<Plus className="h-4 w-4" />}>New Purchase Invoice</LinkButton>
            )}
          </>
        }
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input id="pi-search" label="Search" placeholder="PB number, supplier invoice no. or supplier" value={q} onChange={(e) => setQ(e.target.value)} wrapperClassName="sm:col-span-2" />
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ label: 'All', value: '' }, { label: 'Draft', value: 'DRAFT' }, { label: 'Posted', value: 'POSTED' }]} />
        </div>
      </Card>

      {error ? (
        <ErrorState title="Could not load purchase invoices" description={error} />
      ) : rows === null ? (
        <SkeletonTable rows={5} cols={6} />
      ) : rows.length === 0 && !q && !status ? (
        <EmptyState icon={ShoppingBag} title="No purchase invoices yet" description="Record a supplier invoice to receive stock at its purchase cost." />
      ) : (
        <Table>
          <TableHeader>
            <TableHead>Reference</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Supplier Invoice</TableHead>
            <TableHead>Date</TableHead>
            <TableHead align="right">Invoice Total</TableHead>
            <TableHead align="right">Price Support</TableHead>
            <TableHead>Status</TableHead>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableEmptyRow colSpan={7}><p className="p-6 text-center text-sm text-muted">No invoices match these filters.</p></TableEmptyRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><Link href={`/purchases/${r.id}`} className="font-mono font-semibold text-primary hover:underline">{r.purchaseNumber}</Link></TableCell>
                <TableCell>{r.supplierName}</TableCell>
                <TableCell className="font-mono text-xs">{r.supplierInvoiceNumber}</TableCell>
                <TableCell className="text-muted">{fmtDate(r.invoiceDate)}</TableCell>
                <TableCell align="right" className="font-mono font-semibold">{money(r.grandTotal, r.currency)}</TableCell>
                <TableCell align="right" className="font-mono text-muted">{r.supportCount ? `${money(r.supportPosted, r.currency)} (${r.supportCount})` : '—'}</TableCell>
                <TableCell><PurchaseStatusBadge status={r.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
