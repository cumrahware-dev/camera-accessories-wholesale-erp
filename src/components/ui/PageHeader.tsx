import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  actions?: React.ReactNode;
  divider?: boolean;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, breadcrumbs, actions, divider = false, className }: PageHeaderProps) {
  return (
    <div className={cn(className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav className="flex flex-wrap items-center gap-x-1 text-xs text-muted mb-1 md:mb-2">
              {breadcrumbs.map((crumb, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
                  {crumb.href ? (
                    <Link href={crumb.href} className="inline-flex min-h-[44px] items-center hover:text-ink transition-colors md:min-h-0">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-ink font-medium">{crumb.label}</span>
                  )}
                </React.Fragment>
              ))}
            </nav>
          )}
          {eyebrow && (
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary mb-2">
              {eyebrow}
            </div>
          )}
          <h1 className="text-[28px] leading-[1.15] sm:text-[34px] font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="text-sm sm:text-[15px] text-muted mt-2.5 max-w-2xl leading-relaxed">{description}</p>}
        </div>
        {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end [&>.flex]:flex-wrap">{actions}</div>}
      </div>
      {divider && <div className="mt-6 border-t border-line" />}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="text-sm text-muted mt-1">{description}</p>}
      </div>
      {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end [&>.flex]:flex-wrap">{actions}</div>}
    </div>
  );
}
