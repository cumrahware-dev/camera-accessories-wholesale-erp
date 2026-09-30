'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Smartphone,
  Boxes,
  Package,
  Truck,
  LogOut,
  Menu,
  X,
  ChevronRight,
  ShieldAlert,
  Warehouse,
  Home,
  MoreHorizontal,
} from 'lucide-react';
import { User } from '@/types/erp';
import { cn } from '@/lib/utils';
import { fetchCurrentUserCached, getCurrentUserCachedSync, fetchSettingsCached, invalidateCurrentUser } from '@/lib/client-cache';
import { Badge } from '@/components/ui/Badge';

export default function DepotAppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<User>(
    () => (getCurrentUserCachedSync()?.user as User) || ({
      id: 'usr-admin',
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      email: 'admin@arib.com',
      status: 'ACTIVE',
    } as User)
  );
  const [settings, setSettings] = useState<any>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setIsMounted(true);

    fetchCurrentUserCached().then((data) => {
      if (data?.authenticated && data.user) setCurrentUser(data.user);
    });

    fetchSettingsCached().then((data) => {
      if (data) setSettings(data);
    });
  }, []);

  const depotNavItems = [
    { name: 'Depot Dashboard', href: '/depot', icon: Smartphone },
    { name: 'Pick Orders', href: '/depot/pick', icon: Boxes },
    { name: 'Pack Orders', href: '/depot/pack', icon: Package },
    { name: 'Shipments', href: '/depot/ship', icon: Truck },
    { name: 'Inventory', href: '/depot/inventory', icon: Warehouse },
  ];

  const bottomNavItems = [
    { key: 'home', name: 'Home', href: '/depot', icon: Home, match: (p: string) => p === '/depot' },
    { key: 'orders', name: 'Orders', href: '/depot/pick', icon: Boxes, match: (p: string) => p.startsWith('/depot/pick') || p.startsWith('/depot/pack') },
    { key: 'ship', name: 'Ship', href: '/depot/ship', icon: Truck, match: (p: string) => p.startsWith('/depot/ship') },
    { key: 'inventory', name: 'Inventory', href: '/depot/inventory', icon: Warehouse, match: (p: string) => p.startsWith('/depot/inventory') },
    { key: 'more', name: 'More', href: '#', icon: MoreHorizontal, match: () => false },
  ];

  const isItemActive = (href: string) =>
    href === '/depot' ? pathname === '/depot' : pathname === href || pathname.startsWith(href + '/');

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      invalidateCurrentUser();
      router.push('/login');
    }
  };

  const brandName = settings?.tradingName || settings?.companyName || 'ARIB GLOBAL';
  const logoUrl = settings?.logoUrl;

  return (
    <div className="min-h-screen h-[100dvh] flex flex-col overflow-hidden bg-white text-[#111827]">
      <header className="bg-white border-b border-[#E5E7EB] sticky top-0 z-50 pt-safe">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pl-safe pr-safe">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3 min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/pdflogo.png"
                alt="ARIB GLOBAL"
                className="h-8 w-auto object-contain shrink-0 max-h-9"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#005E82]/10 text-[#005E82] border border-[#005E82]/20 uppercase shrink-0">
                    DEPOT
                  </span>
                  <p className="text-xs text-[#005E82] font-semibold truncate">{currentUser.assignedDepotName || 'Central Logistics Hub'}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="hidden sm:block">
                <Badge tone="warning">{currentUser.assignedDepotName || 'Depot Scope'}</Badge>
              </div>

              {['SUPER_ADMIN', 'MANAGER', 'ERP_USER'].includes(currentUser.role) && (
                <Link
                  href="/dashboard"
                  prefetch={false}
                  className="hidden md:flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#F8FAFC] hover:bg-[#E5E7EB] text-[#111827] text-xs font-semibold transition-colors border border-[#E5E7EB]"
                  title="Switch to Management ERP Dashboard"
                >
                  <span>Main ERP</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              )}

              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden flex h-11 w-11 items-center justify-center rounded-full text-[#6B7280] hover:text-[#111827] hover:bg-[#F8FAFC]"
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>

              <button
                onClick={handleLogout}
                className="hidden md:flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#F8FAFC] hover:bg-[#E5E7EB] text-[#111827] text-xs font-medium border border-[#E5E7EB] transition-colors"
              >
                <LogOut className="h-4 w-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-x-0 bottom-0 top-[calc(4rem+env(safe-area-inset-top))] z-40 bg-white overflow-y-auto overscroll-contain">
          <div className="pt-4 px-4 pb-bottom-nav space-y-1.5">
            {depotNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = isItemActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-4 min-h-[48px] rounded-full text-sm font-semibold transition-colors',
                    isActive ? 'bg-[#111827] text-white' : 'text-[#4B5563] hover:text-[#111827] hover:bg-[#F8FAFC]'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.name}</span>
                  {isActive && <ChevronRight className="h-4 w-4 ml-auto" />}
                </Link>
              );
            })}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-full text-[#DC2626] hover:bg-[#DC2626]/10 text-sm font-medium"
            >
              <LogOut className="h-5 w-5" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden bg-[#F8FAFC]">
        <aside className="hidden md:flex w-64 flex-col border-r border-[#E5E7EB] bg-white">
          <nav className="flex-1 px-3 py-4 space-y-1">
            {depotNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = isItemActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  className={cn(
                    'flex items-center gap-3 px-3.5 py-2.5 rounded-full text-sm font-medium transition-colors',
                    isActive ? 'bg-[#111827] text-white font-semibold' : 'text-[#4B5563] hover:text-[#111827] hover:bg-[#F8FAFC]'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.name}</span>
                  {isActive && <ChevronRight className="h-4 w-4 ml-auto" />}
                </Link>
              );
            })}
          </nav>

          <div className="p-3 border-t border-[#E5E7EB]">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-[#F8FAFC] hover:bg-[#E5E7EB] text-[#4B5563] hover:text-[#111827] text-sm font-medium transition-colors border border-[#E5E7EB]"
            >
              <LogOut className="h-4 w-4 text-[#DC2626]" />
              <span>Logout</span>
            </button>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 md:p-6 lg:p-8 max-md:pb-bottom-nav bg-[#F8FAFC]">{children}</main>
      </div>
      {/* Mobile bottom navigation (phones): Home · Orders · Ship · Inventory · More */}
      <nav
        aria-label="Depot navigation"
        className="md:hidden fixed inset-x-0 bottom-0 z-[45] border-t border-[#E5E7EB] bg-white/95 backdrop-blur pb-safe pl-safe pr-safe"
      >
        <ul className="grid grid-cols-5">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const active = item.key === 'more' ? mobileMenuOpen : !mobileMenuOpen && item.match(pathname || '');
            const cls = cn(
              'flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors',
              active ? 'text-[#005E82]' : 'text-[#6B7280] active:bg-[#F8FAFC]'
            );
            const inner = (
              <>
                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full', active && 'bg-[#005E82]/10')}>
                  <Icon className="h-5 w-5" />
                </span>
                <span>{item.name}</span>
              </>
            );
            return (
              <li key={item.key}>
                {item.key === 'more' ? (
                  <button type="button" onClick={() => setMobileMenuOpen((v) => !v)} aria-expanded={mobileMenuOpen} className={cls}>
                    {inner}
                  </button>
                ) : (
                  <Link href={item.href} prefetch={false} onClick={() => setMobileMenuOpen(false)} aria-current={active ? 'page' : undefined} className={cls}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}