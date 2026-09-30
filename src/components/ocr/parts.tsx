'use client';

import React from 'react';
import { CheckCircle2, Clock, XCircle, AlertTriangle, Circle, Loader2, FileCheck2 } from 'lucide-react';
import { Badge, BadgeTone } from '@/components/ui/Badge';
import { displayStatus, docTypeLabel } from '@/lib/ocr/doc-types';

export const fmtMoney = (n: number | null | undefined, currency?: string) =>
  `${currency ? currency + ' ' : ''}${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

const TONES: Record<string, { tone: BadgeTone; icon: React.ReactNode }> = {
  UPLOADED: { tone: 'neutral', icon: <Circle className="h-3 w-3" /> },
  PROCESSING: { tone: 'warning', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  PROCESSED: { tone: 'info', icon: <CheckCircle2 className="h-3 w-3" /> },
  NEEDS_REVIEW: { tone: 'warning', icon: <AlertTriangle className="h-3 w-3" /> },
  CONFIRMED: { tone: 'success', icon: <CheckCircle2 className="h-3 w-3" /> },
  CONVERTED: { tone: 'primary', icon: <FileCheck2 className="h-3 w-3" /> },
  FAILED: { tone: 'danger', icon: <XCircle className="h-3 w-3" /> },
};

export function OcrStatusBadge({ processing, conversion }: { processing: string; conversion: string }) {
  const s = displayStatus(processing, conversion);
  const t = TONES[s.key] ?? TONES.UPLOADED;
  return <Badge tone={t.tone} icon={t.icon}>{s.label}</Badge>;
}

export function TypeLabel({ type }: { type: string }) {
  return <span className="text-sm text-ink">{docTypeLabel(type)}</span>;
}

export function ConfidenceBadge({ value }: { value?: number | null }) {
  if (value === undefined || value === null) return null;
  const pct = Math.round(value * 100);
  return <Badge tone={pct >= 85 ? 'success' : pct >= 60 ? 'warning' : 'danger'}>{pct}%</Badge>;
}

const EVENT_LABEL: Record<string, string> = {
  UPLOADED: 'Uploaded', OCR_STARTED: 'OCR started', OCR_COMPLETED: 'OCR completed', OCR_FAILED: 'OCR failed',
  TYPE_DETECTED: 'Type detected', DATA_EDITED: 'Data edited', CUSTOMER_MATCHED: 'Customer matched', SUPPLIER_MATCHED: 'Supplier matched',
  PRODUCT_MATCHED: 'Product matched', CONFIRMED: 'Data confirmed', CONVERSION_STARTED: 'Conversion started',
  CONVERSION_COMPLETED: 'Conversion completed', CONVERSION_FAILED: 'Conversion failed',
};

export function HistoryTimeline({ events }: { events: { id: string; type: string; message: string; userName?: string | null; createdAt: string }[] }) {
  if (!events.length) return <p className="text-xs text-muted">No history yet.</p>;
  return (
    <ol className="relative border-l border-line ml-2 space-y-4">
      {[...events].reverse().map((e) => {
        const bad = e.type.endsWith('FAILED');
        const good = e.type === 'CONVERSION_COMPLETED' || e.type === 'CONFIRMED';
        return (
          <li key={e.id} className="ml-4">
            <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border border-white ${bad ? 'bg-danger' : good ? 'bg-success' : 'bg-primary'}`} />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs font-semibold text-ink">{EVENT_LABEL[e.type] ?? e.type}</span>
              <span className="text-[11px] text-muted">{fmtDateTime(e.createdAt)}{e.userName ? ` · ${e.userName}` : ''}</span>
            </div>
            <p className="text-xs text-ink-secondary mt-0.5 break-words">{e.message}</p>
          </li>
        );
      })}
    </ol>
  );
}

export function useCan() {
  const [role, setRole] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    import('@/lib/client-cache').then(({ fetchCurrentUserCached }) =>
      fetchCurrentUserCached().then((d) => alive && setRole(d?.user?.role ?? null))
    );
    return () => { alive = false; };
  }, []);
  return role;
}
