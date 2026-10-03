'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { apiJson, fmtDate } from '@/components/purchasing/parts';

const n2 = (v: number) => (v ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const SOURCE_LINK: Record<string, (id: string) => string> = {
  PURCHASE_INVOICE: (id) => `/purchases/${id}`,
  SUPPLIER_PRICE_SUPPORT: (id) => `/purchases/price-support/${id}`,
};

export default function JournalPage() {
  const [source, setSource] = useState('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    apiJson<any>(`/api/accounting/journal${source ? `?sourceType=${source}` : ''}`).then(setData).catch((e) => setError(e.message));
  }, [source]);

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader title="Journal" description="Accounting entries created when purchase invoices and supplier price support are posted. Read-only and append-only." />
      <Card className="p-4">
        <Select label="Source" value={source} onChange={(e) => setSource(e.target.value)} options={[{ label: 'All', value: '' }, { label: 'Purchase invoices', value: 'PURCHASE_INVOICE' }, { label: 'Supplier price support', value: 'SUPPLIER_PRICE_SUPPORT' }]} wrapperClassName="sm:max-w-xs" />
      </Card>
      {error ? <ErrorState title="Could not load the journal" description={error} /> : !data ? <SkeletonTable rows={5} cols={5} /> : data.entries.length === 0 ? (
        <EmptyState icon={BookOpen} title="No journal entries yet" description="Entries appear when a purchase invoice or price support is posted." />
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-lg font-semibold text-ink">Account balances</h2>
            <Table>
              <TableHeader><TableHead>Account</TableHead><TableHead align="right">Debit</TableHead><TableHead align="right">Credit</TableHead><TableHead align="right">Net (Dr − Cr)</TableHead></TableHeader>
              <TableBody>
                {data.balances.map((b: any) => (
                  <TableRow key={b.code}><TableCell>{b.code} · {b.name}</TableCell><TableCell align="right" className="font-mono">{n2(b.debit)}</TableCell><TableCell align="right" className="font-mono">{n2(b.credit)}</TableCell><TableCell align="right" className="font-mono font-semibold">{(b.debit - b.credit).toLocaleString('en-US', { minimumFractionDigits: 2 })}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-ink">Entries</h2>
            {data.entries.map((e: any) => (
              <Card key={e.id} className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div><span className="font-mono font-semibold">{e.entryNumber}</span><span className="ml-2 text-xs text-muted">{fmtDate(e.entryDate)} · by {e.createdByName}</span></div>
                  <Link href={(SOURCE_LINK[e.sourceType] || (() => '#'))(e.sourceId)} className="font-mono text-sm text-primary hover:underline">{e.sourceRef}</Link>
                </div>
                <p className="mt-1 text-xs text-ink-secondary">{e.narration}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <tbody>
                      {e.lines.map((l: any) => (
                        <tr key={l.id} className="border-t border-line-soft"><td className={`py-1.5 ${l.credit ? 'pl-6' : ''}`}>{l.accountCode} {l.accountName}</td><td className="py-1.5 text-right font-mono">{n2(l.debit)}</td><td className="py-1.5 text-right font-mono">{n2(l.credit)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
