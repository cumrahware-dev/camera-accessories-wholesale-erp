'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BadgeCheck, CheckCircle2, ExternalLink, Lock, Paperclip, Pencil, Send, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button, LinkButton } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { hasPermission } from '@/lib/rbac';
import { apiJson, Field, fmtDate, fmtDateTime, money, SUPPORT_STATUS_LABEL, SupportStatusBadge, useCan } from '@/components/purchasing/parts';

export default function PriceSupportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const role = useCan();
  const [s, setS] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | 'submit' | 'approve' | 'post'>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => apiJson<any>(`/api/price-support/${id}`).then(setS).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState title="Could not load this price support entry" description={error} />;
  if (!s) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /></div>;

  const canWrite = hasPermission(role, 'price_support.write');
  const canApprove = hasPermission(role, 'price_support.approve');
  const c = s.currency;

  const act = async (action: string, n = '') => {
    setBusy(true);
    try {
      await apiJson(`/api/price-support/${id}/action`, { method: 'POST', body: JSON.stringify({ action, note: n }) });
      toast({ title: `Price support ${action === 'submit' ? 'submitted for approval' : action === 'post' ? 'posted' : action + 'd'}`, variant: 'success' });
      setPending(null);
      setRejectOpen(false);
      setNote('');
      load();
    } catch (e: any) {
      toast({ title: 'Action failed', description: e.message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      await apiJson(`/api/price-support/${id}/attachment`, { method: 'POST', body: fd });
      toast({ title: 'Document attached', variant: 'success' });
      load();
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e.message, variant: 'error' });
    }
  };

  const confirmText: Record<string, { title: string; desc: string; label: string }> = {
    submit: { title: 'Submit for approval?', desc: 'The entry can no longer be edited unless an approver rejects it.', label: 'Submit' },
    approve: { title: `Approve ${s.supportNumber}?`, desc: `Approves ${money(s.amount, c)} of support from ${s.supplierName}. It still needs to be posted to reach the accounts.`, label: 'Approve' },
    post: { title: `Post ${s.supportNumber}?`, desc: `Creates the journal entry Dr ${s.settlementHead.code} ${s.settlementHead.name} / Cr ${s.accountingHead.code} ${s.accountingHead.name} for ${money(s.amount, c)}. The original invoice, product cost and stock valuation stay unchanged. Posted entries are permanent.`, label: 'Post to accounts' },
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        breadcrumbs={[{ label: 'Supplier Price Support', href: '/purchases/price-support' }, { label: s.supportNumber }]}
        title={s.supportNumber}
        description={`${s.supplierName} · ${money(s.amount, c)} against invoice ${s.originalInvoiceNumber}`}
        actions={
          <>
            <SupportStatusBadge status={s.status} />
            {canWrite && (s.status === 'DRAFT' || s.status === 'REJECTED') && <LinkButton href={`/purchases/price-support/new?id=${s.id}`} variant="outline" iconLeft={<Pencil className="h-4 w-4" />}>Edit</LinkButton>}
            {canWrite && s.status === 'DRAFT' && <Button iconLeft={<Send className="h-4 w-4" />} onClick={() => setPending('submit')}>Submit for approval</Button>}
            {canApprove && (s.status === 'PENDING_APPROVAL' || s.status === 'APPROVED') && <Button variant="outline" iconLeft={<XCircle className="h-4 w-4 text-danger" />} onClick={() => setRejectOpen(true)}>Reject</Button>}
            {canApprove && s.status === 'PENDING_APPROVAL' && <Button iconLeft={<BadgeCheck className="h-4 w-4" />} onClick={() => setPending('approve')}>Approve</Button>}
            {canApprove && s.status === 'APPROVED' && <Button iconLeft={<CheckCircle2 className="h-4 w-4" />} onClick={() => setPending('post')}>Post</Button>}
          </>
        }
      />

      {s.status === 'REJECTED' && s.rejectionReason && (
        <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-3 text-sm text-danger"><strong>Rejected</strong> by {s.rejectedByName} on {fmtDateTime(s.rejectedAt)}: {s.rejectionReason}. Edit the entry to correct it and submit again.</div>
      )}
      {s.status === 'POSTED' && (
        <div className="flex items-start gap-3 rounded-xl border border-success-border bg-success-soft p-3 text-sm text-ink-secondary"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-success" /><p>Posted {fmtDateTime(s.postedAt)} by {s.postedByName}. This entry is permanent. Inventory and the original invoice were not changed.</p></div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Support</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Supplier">{s.supplierName}</Field>
                <Field label="Support reference">{s.supportReference}</Field>
                <Field label="Support date">{fmtDate(s.supportDate)}</Field>
                <Field label="Amount"><span className="font-mono font-semibold">{money(s.amount, c)}</span></Field>
                <Field label="Accounting head">{s.accountingHead.code} · {s.accountingHead.name}</Field>
                <Field label="Settled against">{s.settlementHead.code} · {s.settlementHead.name}</Field>
                <Field label="Created by">{s.createdByName} · {fmtDateTime(s.createdAt)}</Field>
                <Field label="Approved by">{s.approvedByName ? `${s.approvedByName} · ${fmtDateTime(s.approvedAt)}` : '—'}</Field>
                <Field label="Status">{SUPPORT_STATUS_LABEL[s.status]}</Field>
              </dl>
              <div className="mt-4 rounded-lg bg-surface p-3"><div className="text-[11px] font-medium uppercase tracking-wider text-muted">Reason / remarks</div><p className="mt-1 whitespace-pre-line text-sm text-ink">{s.reason}</p></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Original supplier invoice</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Supplier invoice"><Link href={`/purchases/${s.purchaseInvoice.id}`} className="font-mono font-semibold text-primary hover:underline">{s.originalInvoiceNumber}</Link></Field>
                <Field label="Purchase ref">{s.purchaseNumber}</Field>
                <Field label="Invoice date">{fmtDate(s.invoiceDate)}</Field>
                <Field label="Invoice total">{money(s.purchaseInvoice.grandTotal, c)}</Field>
                <Field label="Stock value received">{money(s.purchaseInvoice.subtotal, c)}</Field>
                <Field label="Received into">{s.purchaseInvoice.depotName}</Field>
              </dl>
              <p className="mt-3 text-[11px] text-muted">Unchanged by this support entry.</p>
            </CardContent>
          </Card>

          {s.journal && (
            <Card>
              <CardHeader><CardTitle>Accounting entry · {s.journal.entryNumber}</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                {s.journal.lines.map((l: any) => (
                  <div key={l.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{l.accountCode} {l.accountName}</span><span className="shrink-0 font-mono">{l.debit ? `Dr ${money(l.debit, c)}` : `Cr ${money(l.credit, c)}`}</span></div>
                ))}
                <p className="pt-2 text-xs text-muted">{s.journal.narration}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Supporting document</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {s.attachmentKey ? (
                <a href={`/api/price-support/${s.id}/attachment`} target="_blank" rel="noreferrer" className="flex min-h-[48px] items-center gap-2 rounded-xl border border-line px-3 text-sm font-medium text-primary hover:bg-surface">
                  <Paperclip className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{s.attachmentName}</span><ExternalLink className="h-4 w-4 shrink-0" />
                </a>
              ) : <p className="text-sm text-muted">No document attached.</p>}
              {canWrite && s.status !== 'POSTED' && (
                <>
                  <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                  <Button variant="outline" className="w-full" iconLeft={<Paperclip className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>{s.attachmentKey ? 'Replace document' : 'Attach document'}</Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Status history</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {s.events.map((e: any) => (
                  <li key={e.id} className="border-l-2 border-line pl-3">
                    <div className="text-sm font-medium text-ink">{e.action.charAt(0) + e.action.slice(1).toLowerCase()}{e.toStatus && e.fromStatus !== e.toStatus ? ` → ${SUPPORT_STATUS_LABEL[e.toStatus] || e.toStatus}` : ''}</div>
                    <div className="text-xs text-muted">{e.userName} · {fmtDateTime(e.createdAt)}</div>
                    {e.note && <div className="mt-0.5 text-xs text-ink-secondary">{e.note}</div>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      {pending && (
        <ConfirmDialog open onClose={() => setPending(null)} onConfirm={() => act(pending)} loading={busy} title={confirmText[pending].title} description={confirmText[pending].desc} confirmLabel={confirmText[pending].label} />
      )}
      <Modal
        open={rejectOpen}
        onClose={() => !busy && setRejectOpen(false)}
        title={`Reject ${s.supportNumber}`}
        description="The creator can correct the entry and submit it again."
        footer={<><Button variant="outline" onClick={() => setRejectOpen(false)} disabled={busy}>Cancel</Button><Button variant="destructive" loading={busy} disabled={note.trim().length < 3} onClick={() => act('reject', note)}>Reject</Button></>}
      >
        <Textarea id="reject-note" label="Reason for rejection" required value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </div>
  );
}
