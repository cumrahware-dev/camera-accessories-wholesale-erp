import React from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type KPITone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface KPITrend {
  direction: 'up' | 'down' | 'flat';
  value: string;
  label?: string;
  positiveIsGood?: boolean;
}

export interface KPICardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: KPITone;
  trend?: KPITrend;
  helperText?: string;
  restricted?: boolean;
  className?: string;
}

export function KPICard({ label, value, icon: Icon, tone = 'neutral', trend, helperText, restricted, className }: KPICardProps) {
  const isUp = trend?.direction === 'up';
  const isDown = trend?.direction === 'down';
  const trendGood = trend ? (trend.positiveIsGood === false ? isDown : isUp) : null;
  const TrendIcon = isUp ? ArrowUp : isDown ? ArrowDown : Minus;

  return (
    <div className={cn('min-w-0 rounded-2xl border border-line bg-white p-3.5 sm:p-4 transition-colors hover:border-ink/15', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {Icon && (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-muted">
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      <div className="mt-2">
        <div className="text-xl sm:text-2xl font-semibold tracking-tight text-ink tabular-nums break-words">
          {restricted ? <span className="text-muted text-sm font-medium">Restricted</span> : value}
        </div>
        {!restricted && trend && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs font-medium">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                trendGood ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
              )}
            >
              <TrendIcon className="h-3 w-3" />
              <span>{trend.value}</span>
            </span>
            {trend.label && <span className="text-muted font-normal text-[11px]">{trend.label}</span>}
          </div>
        )}
        {!restricted && !trend && helperText && <div className="mt-2 text-xs text-muted">{helperText}</div>}
      </div>
    </div>
  );
}
