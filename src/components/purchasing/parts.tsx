'use client';

import React from 'react';
import { CheckCircle2, Clock, XCircle, Circle, BadgeCheck, FileCheck2 } from 'lucide-react';
import { Badge, BadgeTone } from '@/components/ui/Badge';

export { useCan } from '@/components/ocr/parts';

/** Amount in the document's own currency (INR uses Indian digit grouping, e.g. 10,00,000.00). */
export function money(n: number | null | undefined, currency = 'USD') {
  const v = Number(n ?? 0);
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

export const fmtDate = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
export const fmtDateTime = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const isoDay = (d?: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export const SUPPORT_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Pending approval', APPROVED: 'Approved', REJECTED: 'Rejected', POSTED: 'Posted',
};
const SUPPORT_TONE: Record<string, { tone: BadgeTone; icon: React.ComponentType<{ className?: string }> }> = {
  DRAFT: { tone: 'neutral', icon: Circle },
  PENDING_APPROVAL: { tone: 'warning', icon: Clock },
  APPROVED: { tone: 'info', icon: BadgeCheck },
  REJECTED: { tone: 'danger', icon: XCircle },
  POSTED: { tone: 'success', icon: CheckCircle2 },
};

export function SupportStatusBadge({ status }: { status: string }) {
  const s = SUPPORT_TONE[status] || SUPPORT_TONE.DRAFT;
  const Icon = s.icon;
  return <Badge tone={s.tone}><Icon className="h-3 w-3" />{SUPPORT_STATUS_LABEL[status] || status}</Badge>;
}

export function PurchaseStatusBadge({ status }: { status: string }) {
  return status === 'POSTED'
    ? <Badge tone="success"><FileCheck2 className="h-3 w-3" />Posted · locked</Badge>
    : <Badge tone="neutral"><Circle className="h-3 w-3" />Draft</Badge>;
}

export async function apiJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init, headers: { ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status, data });
  return data as T;
}

/** Definition list row used on detail pages. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}
