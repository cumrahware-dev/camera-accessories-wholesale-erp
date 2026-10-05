'use client';

/** Email history of one document: who it was sent to, when, and whether the mail server accepted it. */
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Mail, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import type { EmailDocType } from './SendEmailModal';

interface LogRow {
  id: string; to: string; cc: string[]; bcc: string[]; subject: string; body?: string | null; attachmentName?: string | null;
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED'; failureReason?: string | null; providerMessageId?: string | null;
  retryCount: number; sentAt?: string | null; createdAt: string; sentByName?: string | null;
}

const when = (d?: string | null) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export function EmailHistory({
  documentType, documentId, refreshKey = 0, canSend, onChanged,
}: {
  documentType: EmailDocType; documentId: string; refreshKey?: number; canSend: boolean; onChanged?: () => void;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/email/logs?type=${documentType}&id=${encodeURIComponent(documentId)}`, { cache: 'no-store' });
      const j = await res.json().catch(() => []);
      if (!res.ok) { setError(j.error || 'Could not load email history.'); return; }
      setRows(j); setError('');
    } catch { setError('Could not load email history.'); }
  }, [documentType, documentId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // keep following anything still in flight
  const busy = rows?.some((r) => r.status === 'PENDING' || r.status === 'SENDING');
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => { if (!document.hidden) void load(); }, 3000);
    return () => clearInterval(t);
  }, [busy, load]);
  const prevBusy = React.useRef(false);
  useEffect(() => { if (prevBusy.current && !busy) onChanged?.(); prevBusy.current = !!busy; }, [busy, onChanged]);

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      const res = await fetch(`/api/email/logs/${id}/retry`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) toast({ title: 'Retry failed', description: j.error, variant: 'error' });
      else toast({ title: 'Retrying email', description: 'The result will appear here shortly.', variant: 'info' });
      await load();
    } finally { setRetrying(null); }
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-line-soft bg-surface flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email History</h3>
        <button onClick={load} className="text-xs text-primary hover:underline">Refresh</button>
      </div>
      {error && <p className="p-4 text-xs text-danger">{error}</p>}
      {!error && rows === null && <p className="p-4 text-xs text-muted">Loading…</p>}
      {!error && rows?.length === 0 && <p className="p-4 text-xs text-muted">Not emailed yet.</p>}
      <ul className="divide-y divide-line-soft">
        {rows?.map((r) => (
          <li key={r.id} className="p-4 text-xs space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-ink truncate">{r.to}</div>
                <div className="text-muted truncate">{r.subject}</div>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-muted">
              <span>{r.status === 'SENT' ? `Sent ${when(r.sentAt)}` : `Queued ${when(r.createdAt)}`}{r.sentByName ? ` · by ${r.sentByName}` : ''}{r.retryCount ? ` · ${r.retryCount} retr${r.retryCount === 1 ? 'y' : 'ies'}` : ''}</span>
              <span className="flex items-center gap-2">
                {r.status === 'FAILED' && canSend && (
                  <Button size="sm" variant="outline" iconLeft={<RefreshCw className="h-3 w-3" />} loading={retrying === r.id} onClick={() => retry(r.id)}>Retry</Button>
                )}
                <button onClick={() => setOpen(open === r.id ? null : r.id)} className="inline-flex items-center gap-0.5 text-primary hover:underline min-h-[32px]">
                  Details {open === r.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              </span>
            </div>
            {r.status === 'FAILED' && r.failureReason && <div className="rounded-md bg-danger-soft text-danger px-2.5 py-1.5">{r.failureReason}</div>}
            {open === r.id && (
              <dl className="mt-1 grid grid-cols-[80px_1fr] gap-x-2 gap-y-1 rounded-md bg-surface-muted/50 p-2.5">
                {r.cc.length > 0 && <><dt className="text-muted">CC</dt><dd className="break-all">{r.cc.join(', ')}</dd></>}
                {r.bcc.length > 0 && <><dt className="text-muted">BCC</dt><dd className="break-all">{r.bcc.join(', ')}</dd></>}
                <dt className="text-muted">Attachment</dt><dd className="break-all font-mono">{r.attachmentName || '—'}</dd>
                {r.providerMessageId && <><dt className="text-muted">Message ID</dt><dd className="break-all font-mono">{r.providerMessageId}</dd></>}
                {r.body && <><dt className="text-muted">Message</dt><dd className="whitespace-pre-wrap text-ink-secondary">{r.body}</dd></>}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
