'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { BadgePercent, CheckCircle2, Lock, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button, LinkButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { hasPermission } from '@/lib/rbac';
import { apiJson, Field, fmtDate, fmtDateTime, money, PurchaseStatusBadge, SupportStatusBadge, useCan } from '@/components/purchasing/parts';

export default function PurchaseInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const role = useCan();
  const [inv, setInv] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => apiJson<any>(`/api/purchase-invoices/${id}`).then(setInv).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState title="Could not load the purchase invoice" description={error} />;
  if (!inv) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /></div>;

  const c = inv.currency;
  const isDraft = inv.status === 'DRAFT';
  const ps = inv.priceSupport;

  const post = async () => {
    setBusy(true);
    try {
      await apiJson(`/api/purchase-invoices/${id}/post`, { method: 'POST' });
      toast({ title: 'Invoice posted', description: 'Stock received and the invoice is now locked.', variant: 'success' });
      setConfirmPost(false);
      load();
    } catch (e: any) {
      toast({ title: 'Could not post', description: e.message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await apiJson(`/api/purchase-invoices/${id}`, { method: 'DELETE' });
      router.push('/purchases');
    } catch (e: any) {
      toast({ title: 'Could not delete', description: e.message, variant: 'error' });
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        breadcrumbs={[{ label: 'Purchase Invoices', href: '/purchases' }, { label: inv.purchaseNumber }]}
        title={inv.purchaseNumber}
        description={`${inv.supplierName} · supplier invoice ${inv.supplierInvoiceNumber}`}
        actions={
          <>
            <PurchaseStatusBadge status={inv.status} />
            {isDraft && hasPermission(role, 'purchases.write') && (
              <>
                <LinkButton href={`/purchases/new?id=${inv.id}`} variant="outline" iconLeft={<Pencil className="h-4 w-4" />}>Edit</LinkButton>
                <Button variant="outline" iconLeft={<Trash2 className="h-4 w-4 text-danger" />} onClick={() => setConfirmDelete(true)}>Delete</Button>
              </>
            )}
            {isDraft && hasPermission(role, 'purchases.post') && (
              <Button iconLeft={<CheckCircle2 className="h-4 w-4" />} onClick={() => setConfirmPost(true)}>Post &amp; receive stock</Button>
            )}
            {!isDraft && hasPermission(role, 'price_support.write') && (
              <LinkButton href={`/purchases/price-support/new?invoice=${inv.id}`} iconLeft={<BadgePercent className="h-4 w-4" />}>Record price support</LinkButton>
            )}
          </>
        }
      />

      {!isDraft && (
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3 text-sm text-ink-secondary">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <p>Posted {fmtDateTime(inv.postedAt)} by {inv.postedByName}. This invoice, its received quantities and costs are locked. A later supplier discount does not change it: record it as <strong>Supplier Price Support</strong>.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Invoice details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Supplier">{inv.supplierName}</Field>
                <Field label="Supplier invoice no.">{inv.supplierInvoiceNumber}</Field>
                <Field label="Invoice date">{fmtDate(inv.invoiceDate)}</Field>
                <Field label="Received into">{inv.depotName}</Field>
                <Field label="Currency">{c}</Field>
                <Field label="Created by">{inv.createdByName}</Field>
                {inv.ocrDocumentId && <Field label="Source document"><a className="text-primary underline" href={`/ocr/${inv.ocrDocumentId}`}>Scanned supplier invoice (OCR)</a></Field>}
              </dl>
              {inv.notes && <p className="mt-4 whitespace-pre-line rounded-lg bg-surface p-3 text-sm text-ink-secondary">{inv.notes}</p>}
            </CardContent>
          </Card>

          <Table>
            <TableHeader>
              <TableHead>SKU</TableHead>
              <TableHead>Product</TableHead>
              <TableHead align="right">Qty</TableHead>
              <TableHead align="right">Unit cost</TableHead>
              <TableHead align="right">Discount</TableHead>
              <TableHead align="right">Tax</TableHead>
              <TableHead align="right">Line total</TableHead>
            </TableHeader>
            <TableBody>
              {inv.items.map((it: any) => (
                <TableRow key={it.id}>
                  <TableCell className="font-mono text-xs">{it.productSku}</TableCell>
                  <TableCell>{it.productName}</TableCell>
                  <TableCell align="right" className="font-mono">{it.quantity}</TableCell>
                  <TableCell align="right" className="font-mono">{money(it.unitCost, c)}</TableCell>
                  <TableCell align="right" className="font-mono text-muted">{it.discountAmount > 0 ? `-${money(it.discountAmount, c)}` : '—'}</TableCell>
                  <TableCell align="right" className="font-mono text-muted">{money(it.taxAmount, c)}</TableCell>
                  <TableCell align="right" className="font-mono font-semibold">{money(it.lineTotal, c)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {inv.journal && (
            <Card>
              <CardHeader><CardTitle>Accounting entry · {inv.journal.entryNumber}</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                {inv.journal.lines.map((l: any) => (
                  <div key={l.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{l.accountCode} {l.accountName}</span><span className="shrink-0 font-mono">{l.debit ? `Dr ${money(l.debit, c)}` : `Cr ${money(l.credit, c)}`}</span></div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Totals</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Subtotal (lines)</dt><dd className="font-mono">{money(inv.subtotal, c)}</dd></div>
                {inv.discountAmount > 0 && <div className="flex justify-between"><dt className="text-muted">Invoice discount</dt><dd className="font-mono">-{money(inv.discountAmount, c)}</dd></div>}
                <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="font-mono">{money(inv.taxAmount, c)}</dd></div>
                {inv.freightAmount > 0 && <div className="flex justify-between"><dt className="text-muted">Freight</dt><dd className="font-mono">{money(inv.freightAmount, c)}</dd></div>}
                {inv.otherCharges > 0 && <div className="flex justify-between"><dt className="text-muted">Other charges</dt><dd className="font-mono">{money(inv.otherCharges, c)}</dd></div>}
                <div className="flex justify-between border-t border-line pt-1.5 font-semibold"><dt>Invoice total</dt><dd className="font-mono text-primary">{money(inv.grandTotal, c)}</dd></div>
              </dl>
            </CardContent>
          </Card>

          {/* Read-only Supplier Price Support section */}
          <Card>
            <CardHeader><CardTitle>Supplier Price Support</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-success-soft p-3"><div className="text-[11px] uppercase tracking-wider text-success">Total received</div><div className="mt-1 font-mono text-lg font-semibold text-ink">{money(ps.totalReceived, c)}</div></div>
                <div className="rounded-xl bg-surface p-3"><div className="text-[11px] uppercase tracking-wider text-muted">Entries</div><div className="mt-1 text-lg font-semibold text-ink">{ps.count}</div></div>
              </div>
              {ps.totalPendingOrApproved > 0 && <p className="text-xs text-warning">{money(ps.totalPendingOrApproved, c)} more is in draft / awaiting approval or posting.</p>}
              {ps.entries.length === 0 ? (
                <p className="text-sm text-muted">No price support recorded against this invoice.</p>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {ps.entries.map((e: any) => (
                    <li key={e.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <Link href={`/purchases/price-support/${e.id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{e.supportNumber}</Link>
                        <div className="truncate text-xs text-muted">Ref {e.supportReference} · {fmtDate(e.supportDate)}</div>
                        <div className="mt-1"><SupportStatusBadge status={e.status} /></div>
                      </div>
                      <span className="shrink-0 font-mono text-sm font-semibold">{money(e.amount, e.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] leading-relaxed text-muted">Shown for reference only. Price support never changes this invoice, the received stock or its valuation.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmPost}
        onClose={() => setConfirmPost(false)}
        onConfirm={post}
        loading={busy}
        title={`Post ${inv.purchaseNumber}?`}
        description={`Receives ${inv.items.reduce((s: number, i: any) => s + i.quantity, 0)} units into ${inv.depotName} at the invoice costs (${money(inv.subtotal, c)}) and books the purchase. After posting the invoice can no longer be edited or deleted.`}
        confirmLabel="Post invoice"
      />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={remove} loading={busy} destructive title={`Delete draft ${inv.purchaseNumber}?`} confirmLabel="Delete draft" />
    </div>
  );
}
