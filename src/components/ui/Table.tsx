import React from 'react';
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('overflow-x-auto overscroll-x-contain rounded-2xl border border-line bg-white', className)}>
      {/* Phones: keep a readable minimum width and scroll inside the card; first column stays pinned. */}
      <table
        className={cn(
          'w-full border-collapse text-sm max-md:min-w-[40rem]',
          'max-md:[&_th:first-child]:sticky max-md:[&_th:first-child]:left-0 max-md:[&_th:first-child]:z-[1] max-md:[&_th:first-child]:bg-inherit',
          'max-md:[&_td:first-child:not([colspan])]:sticky max-md:[&_td:first-child:not([colspan])]:left-0 max-md:[&_td:first-child:not([colspan])]:z-[1] max-md:[&_td:first-child:not([colspan])]:bg-inherit',
          'max-md:[&_td:first-child:not([colspan])]:shadow-[1px_0_0_var(--line-soft)] max-md:[&_th:first-child]:shadow-[1px_0_0_var(--line-soft)]'
        )}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children, sticky }: { children: React.ReactNode; sticky?: boolean }) {
  return (
    <thead className={cn('bg-white border-b border-line', sticky && 'sticky top-0 z-10')}>
      <tr>{children}</tr>
    </thead>
  );
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-line-soft bg-white">{children}</tbody>;
}

export function TableRow({
  className,
  children,
  onClick,
}: {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'bg-white transition-colors',
        onClick && 'cursor-pointer hover:bg-surface',
        !onClick && 'hover:bg-surface/70',
        className
      )}
    >
      {children}
    </tr>
  );
}

export type SortDirection = 'asc' | 'desc' | null;

export interface TableHeadProps {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  sortDirection?: SortDirection;
  onSort?: () => void;
  className?: string;
}

export function TableHead({ children, align = 'left', sortable, sortDirection, onSort, className }: TableHeadProps) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  if (!sortable) {
    return (
      <th className={cn('px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted', alignClass, className)}>
        {children}
      </th>
    );
  }
  const Icon = sortDirection === 'asc' ? ArrowUp : sortDirection === 'desc' ? ArrowDown : ChevronsUpDown;
  return (
    <th className={cn('px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted', alignClass, className)}>
      <button
        type="button"
        onClick={onSort}
        className={cn(
          'inline-flex items-center gap-1 hover:text-ink transition-colors',
          align === 'right' && 'flex-row-reverse'
        )}
      >
        {children}
        <Icon className="h-3 w-3 text-muted" />
      </button>
    </th>
  );
}

export function TableCell({
  children,
  align = 'left',
  colSpan,
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
  className?: string;
}) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return <td colSpan={colSpan} className={cn('px-4 py-4 text-ink align-middle text-sm', alignClass, className)}>{children}</td>;
}

export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        {/* on phones the table is wider than the screen: keep the message within the visible area */}
        <div className="max-md:sticky max-md:left-0 max-md:w-[calc(100vw-2.5rem)]">{children}</div>
      </td>
    </tr>
  );
}
