import React from 'react';
import { CheckCircle2, Clock, XCircle, AlertTriangle, Circle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-muted border-line',
  success: 'bg-success-soft text-success border-success-border',
  warning: 'bg-warning-soft text-warning border-warning-border',
  danger: 'bg-danger-soft text-danger border-danger-border',
  info: 'bg-info-soft text-info border-info-border',
  primary: 'bg-primary-soft text-primary border-info-border',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: React.ReactNode;
}

export function Badge({ tone = 'neutral', icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap',
        toneClasses[tone],
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * Maps ERP domain statuses (Proforma/Invoice/Shipment/Serial/Customer/etc.) to a
 * consistent tone + icon + human label, so the same status always reads the same
 * way anywhere in the product. Extend STATUS_MAP as new statuses appear — never
 * invent a one-off badge treatment on a page.
 */
const STATUS_MAP: Record<string, { tone: BadgeTone; label?: string; icon: React.ComponentType<{ className?: string }> }> = {
  DRAFT: { tone: 'neutral', icon: Circle },
  SENT: { tone: 'info', icon: Clock },
  CONFIRMED: { tone: 'success', icon: CheckCircle2 },
  CONVERTED: { tone: 'primary', icon: CheckCircle2 },
  PROCESSING: { tone: 'warning', icon: Clock },
  READY_FOR_PACKING: { tone: 'warning', label: 'Ready for Packing', icon: Clock },
  PACKED: { tone: 'info', icon: CheckCircle2 },
  SHIPPED: { tone: 'info', icon: CheckCircle2 },
  DISPATCHED: { tone: 'info', icon: CheckCircle2 },
  IN_TRANSIT: { tone: 'info', label: 'In Transit', icon: Clock },
  OUT_FOR_DELIVERY: { tone: 'info', label: 'Out for Delivery', icon: Clock },
  DELIVERED: { tone: 'success', icon: CheckCircle2 },
  CANCELLED: { tone: 'danger', icon: XCircle },
  PAID: { tone: 'success', icon: CheckCircle2 },
  PARTIALLY_PAID: { tone: 'warning', label: 'Partially Paid', icon: AlertTriangle },
  UNPAID: { tone: 'danger', icon: XCircle },
  ACTIVE: { tone: 'success', icon: CheckCircle2 },
  INACTIVE: { tone: 'neutral', icon: Circle },
  ON_HOLD: { tone: 'warning', label: 'On Hold', icon: AlertTriangle },
  IN_STOCK: { tone: 'success', label: 'In Stock', icon: CheckCircle2 },
  ALLOCATED: { tone: 'warning', icon: Clock },
  RETURNED: { tone: 'neutral', icon: Info },
  DEFECTIVE: { tone: 'danger', icon: XCircle },
  PENDING: { tone: 'warning', icon: Clock },
  SENDING: { tone: 'info', icon: Clock },
  FAILED: { tone: 'danger', icon: XCircle },
  ISSUED: { tone: 'primary', icon: CheckCircle2 },
  COMPLETED: { tone: 'success', icon: CheckCircle2 },
  READY: { tone: 'info', icon: Clock },
};

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return <Badge className={className}>—</Badge>;
  const key = status.toUpperCase();
  const meta = STATUS_MAP[key] ?? { tone: 'neutral' as BadgeTone, icon: Info };
  const Icon = meta.icon;
  const label = meta.label ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Badge tone={meta.tone} icon={<Icon className="h-3 w-3" />} className={className}>
      {label}
    </Badge>
  );
}

/** Margin-health indicator for product/customer/category/depot profitability views. */
export function MarginBadge({ marginPercent }: { marginPercent: number }) {
  if (marginPercent < 0) {
    return (
      <Badge tone="danger" icon={<AlertTriangle className="h-3 w-3" />}>
        Critical · {marginPercent.toFixed(1)}%
      </Badge>
    );
  }
  if (marginPercent < 15) {
    return (
      <Badge tone="warning" icon={<AlertTriangle className="h-3 w-3" />}>
        Needs attention · {marginPercent.toFixed(1)}%
      </Badge>
    );
  }
  return (
    <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>
      Healthy · {marginPercent.toFixed(1)}%
    </Badge>
  );
}
