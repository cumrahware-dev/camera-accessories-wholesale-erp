'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ClipboardList, Truck, Warehouse, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DepotBottomNavProps {
  onMoreClick: () => void;
  isMoreActive: boolean;
}

const TABS = [
  { name: 'Home', href: '/depot', icon: Home, match: (p: string) => p === '/depot' },
  { name: 'Orders', href: '/depot/pick', icon: ClipboardList, match: (p: string) => p === '/depot/pick' || p === '/depot/pack' },
  { name: 'Ship', href: '/depot/ship', icon: Truck, match: (p: string) => p.startsWith('/depot/ship') },
  { name: 'Inventory', href: '/depot/inventory', icon: Warehouse, match: (p: string) => p.startsWith('/depot/inventory') },
];

export default function DepotBottomNav({ onMoreClick, isMoreActive }: DepotBottomNavProps) {
  const pathname = usePathname();

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-line pb-[env(safe-area-inset-bottom)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Depot navigation"
    >
      <div className="grid grid-cols-5 h-16">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = !isMoreActive && tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch={false}
              className={cn(
                'flex flex-col items-center justify-center gap-1 min-w-0 transition-colors active:bg-surface',
                isActive ? 'text-primary' : 'text-muted'
              )}
            >
              <Icon className={cn('h-6 w-6', isActive && 'stroke-[2.25]')} />
              <span className={cn('text-[10px] leading-none', isActive ? 'font-bold' : 'font-medium')}>
                {tab.name}
              </span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onMoreClick}
          className={cn(
            'flex flex-col items-center justify-center gap-1 min-w-0 transition-colors active:bg-surface',
            isMoreActive ? 'text-primary' : 'text-muted'
          )}
          aria-label="More depot options"
        >
          <MoreHorizontal className={cn('h-6 w-6', isMoreActive && 'stroke-[2.25]')} />
          <span className={cn('text-[10px] leading-none', isMoreActive ? 'font-bold' : 'font-medium')}>More</span>
        </button>
      </div>
    </nav>
  );
}
