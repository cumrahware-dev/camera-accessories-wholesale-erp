'use client';

/**
 * Send a document to the customer: preview -> (optional edit) -> send -> follow the real delivery status.
 * "Sent" is only shown once the server's email log says the mail server accepted the message.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, Mail, Pencil, RefreshCw, Send, XCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button, LinkButton } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';

export type EmailDocType = 'PROFORMA' | 'TAX_INVOICE' | 'SERVICE_INVOICE';

interface Prepared {
  documentNumber: string;
  customerId: string;
  customerName: string;
  to: string;
  missingEmail: boolean;
  invalidEmail: boolean;
  blockedReason: string | null;
  emailConfigured: boolean;
  subject: string;
  body: string;
  attachmentName: string;
  canOverride: boolean;
}

type Phase = 'loading' | 'error' | 'preview' | 'edit' | 'sending' | 'sent' | 'failed' | 'slow';

const POLL_MS = 1500;
const POLL_LIMIT_MS = 95_000;

export function SendEmailModal({
  open,
  onClose,
  documentType,
  documentId,
  onDelivered,
}: {
  open: boolean;
  onClose: () => void;
  documentType: EmailDocType;
  documentId: string;
  /** Called after the email reached SENT or FAILED, so the page can refresh status and history. */
  onDelivered?: (status: 'SENT' | 'FAILED') => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [logId, setLogId] = useState<string | null>(null);
  const [result, setResult] = useState<{ to?: string; failureReason?: string | null; providerMessageId?: string | null }>({});
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const stopPolling = () => { if (pollRef.current) clearTimeout(pollRef.current); pollRef.current = null; };

  const load = useCallback(async () => {
    setPhase('loading'); setError(''); setLogId(null); setResult({});
    try {
      const res = await fetch(`/api/email/prepare?type=${documentType}&id=${encodeURIComponent(documentId)}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || 'Could not prepare the email.'); setPhase('error'); return; }
      setPrepared(j); setTo(j.to || ''); setCc(''); setBcc(''); setSubject(j.subject); setBody(j.body);
      setPhase('preview');
    } catch {
      setError('Network error. Please try again.'); setPhase('error');
    }
  }, [documentType, documentId]);

  useEffect(() => {
    alive.current = true;
    if (open) load();
    return () => { alive.current = false; stopPolling(); };
  }, [open, load]);

  const follow = useCallback((id: string) => {
    const started = Date.now();
    const tick = async () => {
      if (!alive.current) return;
      try {
        const res = await fetch(`/api/email/logs?logId=${id}`, { cache: 'no-store' });
        const j = await res.json().catch(() => ({}));
        if (res.ok && (j.status === 'SENT' || j.status === 'FAILED')) {
          setResult({ to: j.to, failureReason: j.failureReason, providerMessageId: j.providerMessageId });
          setPhase(j.status === 'SENT' ? 'sent' : 'failed');
          onDelivered?.(j.status);
          return;
        }
      } catch {}
      if (Date.now() - started > POLL_LIMIT_MS) { setPhase('slow'); return; }
      pollRef.current = setTimeout(tick, POLL_MS);
    };
    pollRef.current = setTimeout(tick, 800);
  }, [onDelivered]);

  const send = async () => {
    if (!prepared) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType, documentId, to, cc, bcc: prepared.canOverride ? bcc : '', subject, body }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || 'The email could not be queued.'); return; }
      setLogId(j.logId); setPhase('sending'); follow(j.logId);
    } catch {
      setError('Network error. The email was not queued.');
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!logId) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/email/logs/${logId}/retry`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || 'Retry failed.'); return; }
      setPhase('sending'); follow(logId);
    } finally {
      setBusy(false);
    }
  };

  const close = () => { stopPolling(); onClose(); };
  const p = prepared;
  const cantSend = !p || !!p.blockedReason || !p.emailConfigured || (!to.trim()) || ((p.missingEmail || p.invalidEmail) && !p.canOverride);

  // ── footers per phase ─────────────────────────────────────────────────────
  let footer: React.ReactNode = null;
  if (phase === 'preview') {
    footer = (
      <>
        <Button variant="outline" onClick={close}>Cancel</Button>
        {!cantSend && <Button variant="outline" iconLeft={<Pencil className="h-3.5 w-3.5" />} onClick={() => setPhase('edit')}>Edit</Button>}
        <Button iconLeft={<Send className="h-3.5 w-3.5" />} onClick={send} loading={busy} disabled={cantSend}>Send Email</Button>
      </>
    );
  } else if (phase === 'edit') {
    footer = (
      <>
        <Button variant="outline" onClick={close}>Cancel</Button>
        <Button onClick={() => setPhase('preview')} disabled={!subject.trim() || !body.trim() || !to.trim()}>Preview</Button>
      </>
    );
  } else if (phase === 'failed') {
    footer = (
      <>
        <Button variant="outline" onClick={close}>Close</Button>
        <Button iconLeft={<RefreshCw className="h-3.5 w-3.5" />} onClick={retry} loading={busy}>Retry</Button>
      </>
    );
  } else if (phase === 'sent' || phase === 'slow' || phase === 'error') {
    footer = <Button onClick={close}>Close</Button>;
  } else if (phase === 'sending') {
    footer = <Button variant="outline" onClick={close}>Close (keeps sending)</Button>;
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="xl"
      title={p ? `Email ${p.documentNumber}` : 'Send email'}
      description={p ? `To ${p.customerName}` : undefined}
      footer={footer}
    >
      {phase === 'loading' && (
        <div className="flex items-center gap-2 py-10 justify-center text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Preparing email…</div>
      )}

      {phase === 'error' && <Notice tone="danger" title="Email could not be prepared">{error}</Notice>}

      {(phase === 'preview' || phase === 'edit') && p && (
        <div className="space-y-4">
          {p.blockedReason && <Notice tone="warning" title="This document cannot be emailed">{p.blockedReason}</Notice>}
          {!p.blockedReason && (p.missingEmail || p.invalidEmail) && (
            <Notice tone="danger" title={p.missingEmail ? 'Customer email address is missing.' : `The customer email "${p.to}" is not valid.`}>
              <p>Update the customer record, then send again.{p.canOverride ? ' As a manager you can also type a different address below.' : ''}</p>
              <div className="flex gap-2 mt-2">
                <LinkButton href={`/customers/${p.customerId}`} size="sm" variant="outline">Update Customer</LinkButton>
                <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
              </div>
            </Notice>
          )}
          {!p.blockedReason && !p.emailConfigured && (
            <Notice tone="warning" title="Email is not configured on the server">
              SMTP settings are missing, so nothing can be sent. Ask an administrator to set the SMTP environment variables.
            </Notice>
          )}
          {error && <Notice tone="danger" title="Not sent">{error}</Notice>}

          {phase === 'edit' ? (
            <div className="space-y-3">
              <Input label="To" value={to} onChange={(e) => setTo(e.target.value)} disabled={!p.canOverride}
                hint={p.canOverride ? undefined : "Documents are sent to the customer's email in the ERP."} />
              <Input label="CC" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="name@company.com, other@company.com" />
              {p.canOverride && <Input label="BCC" value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="optional" />}
              <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              <Textarea label="Message" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[220px] font-sans" />
            </div>
          ) : (
            <div className="rounded-lg border border-line overflow-hidden">
              <dl className="divide-y divide-line-soft text-sm">
                <Row k="To">{to || <span className="text-danger">—</span>}</Row>
                {cc.trim() && <Row k="CC">{cc}</Row>}
                {bcc.trim() && p.canOverride && <Row k="BCC">{bcc}</Row>}
                <Row k="Subject"><span className="font-semibold">{subject}</span></Row>
              </dl>
              <div className="border-t border-line bg-surface-muted/40 px-4 py-4 text-sm text-ink whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">{body}</div>
              <div className="border-t border-line px-4 py-3 flex items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 text-ink-secondary min-w-0">
                  <FileText className="h-4 w-4 text-danger shrink-0" /> <span className="truncate font-mono">{p.attachmentName}</span>
                </span>
                <a href={`/api/document-pdf/${documentType}/${encodeURIComponent(documentId)}?inline=1`} target="_blank" rel="noreferrer" className="text-primary font-medium hover:underline shrink-0">
                  Open PDF
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'sending' && (
        <div className="flex flex-col items-center text-center gap-3 py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div className="text-sm font-semibold text-ink">Sending email…</div>
          <p className="text-xs text-muted max-w-sm">The PDF is being attached and handed to the mail server. You can close this window; the result will appear in Email History.</p>
        </div>
      )}

      {phase === 'sent' && (
        <div className="flex flex-col items-center text-center gap-2 py-8">
          <div className="h-12 w-12 rounded-full bg-success-soft flex items-center justify-center"><CheckCircle2 className="h-6 w-6 text-success" /></div>
          <div className="text-base font-semibold text-ink">Email sent</div>
          <p className="text-xs text-muted">The mail server accepted the email to <strong className="text-ink">{result.to}</strong>.</p>
          {result.providerMessageId && <p className="text-[11px] text-muted font-mono break-all">Message ID: {result.providerMessageId}</p>}
        </div>
      )}

      {phase === 'failed' && (
        <div className="space-y-3 py-2">
          <div className="flex flex-col items-center text-center gap-2 py-4">
            <div className="h-12 w-12 rounded-full bg-danger-soft flex items-center justify-center"><XCircle className="h-6 w-6 text-danger" /></div>
            <div className="text-base font-semibold text-ink">Email failed to send.</div>
          </div>
          <Notice tone="danger" title="Reason">{result.failureReason || 'Unknown error.'}</Notice>
          {error && <Notice tone="danger" title="Retry">{error}</Notice>}
          <p className="text-xs text-muted text-center">The document itself is unchanged. Retry only re-sends this email.</p>
        </div>
      )}

      {phase === 'slow' && (
        <Notice tone="warning" title="Still sending">
          The mail server has not answered yet. This is not a confirmation that the email was sent. Check Email History in a moment.
        </Notice>
      )}
    </Modal>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-2.5">
      <dt className="w-16 shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: 'danger' | 'warning'; title: string; children: React.ReactNode }) {
  const cls = tone === 'danger' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-warning-border bg-warning-soft text-warning';
  const Icon = tone === 'danger' ? XCircle : AlertTriangle;
  return (
    <div className={`flex gap-2.5 rounded-lg border p-3 text-xs ${cls}`}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="min-w-0 space-y-0.5"><div className="font-semibold">{title}</div><div className="text-ink-secondary">{children}</div></div>
    </div>
  );
}

export const EmailIcon = Mail;
