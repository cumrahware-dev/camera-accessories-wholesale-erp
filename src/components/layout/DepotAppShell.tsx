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
  X,
  ChevronRight,
  ShieldAlert,
  Warehouse,
} from 'lucide-react';
import { User } from '@/types/erp';
import { cn } from '@/lib/utils';
import { fetchCurrentUserCached, getCurrentUserCachedSync, fetchSettingsCached, invalidateCurrentUser } from '@/lib/client-cache';
import { Badge } from '@/components/ui/Badge';
import DepotBottomNav from '@/components/layout/DepotBottomNav';

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
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  useEffect(() => {
    setIsMounted(true);

    fetchCurrentUserCached().then((data) => {
      if (data?.authenticated && data.user) setCurrentUser(data.user);
    });

    fetchSettingsCached().then((data) => {
      if (data) setSettings(data);
    });
  }, []);

  useEffect(() => {
    setIsMoreOpen(false);
  }, [pathname]);

  const depotNavItems = [
    { name: 'Depot Dashboard', href: '/depot', icon: Smartphone },
    { name: 'Pick Orders', href: '/depot/pick', icon: Boxes },
    { name: 'Pack Orders', href: '/depot/pack', icon: Package },
    { name: 'Shipments', href: '/depot/ship', icon: Truck },
    { name: 'Inventory', href: '/depot/inventory', icon: Warehouse },
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
      <header className="bg-white border-b border-[#E5E7EB] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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

      {isMoreOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsMoreOpen(false)}
            aria-hidden="true"
          />
          <div className="relative bg-white rounded-t-3xl border-t border-[#E5E7EB] pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 px-4 animate-slide-up">
            <div className="mx-auto h-1 w-10 rounded-full bg-[#E5E7EB] mb-3" />
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-sm font-bold text-[#111827]">More</span>
              <button
                onClick={() => setIsMoreOpen(false)}
                className="p-2 -mr-2 rounded-full text-[#6B7280] hover:bg-[#F8FAFC]"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-1.5 pt-1">
              {depotNavItems
                .filter((item) => item.href === '/depot/pack')
                .map((item) => {
                  const Icon = item.icon;
                  const isActive = isItemActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={false}
                      onClick={() => setIsMoreOpen(false)}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold transition-colors',
                        isActive ? 'bg-[#111827] text-white' : 'text-[#4B5563] hover:text-[#111827] hover:bg-[#F8FAFC]'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      <span>{item.name}</span>
                      {isActive && <ChevronRight className="h-4 w-4 ml-auto" />}
                    </Link>
                  );
                })}

              {['SUPER_ADMIN', 'MANAGER', 'ERP_USER'].includes(currentUser.role) && (
                <Link
                  href="/dashboard"
                  prefetch={false}
                  onClick={() => setIsMoreOpen(false)}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold text-[#4B5563] hover:text-[#111827] hover:bg-[#F8FAFC] transition-colors"
                >
                  <ChevronRight className="h-5 w-5" />
                  <span>Switch to Main ERP</span>
                </Link>
              )}

              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-[#DC2626] hover:bg-[#DC2626]/10 text-sm font-medium"
              >
                <LogOut className="h-5 w-5" />
                <span>Logout</span>
              </button>
            </div>
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

        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6 md:pb-6 lg:p-8 bg-[#F8FAFC]">
          {children}
        </main>
      </div>

      <DepotBottomNav onMoreClick={() => setIsMoreOpen((v) => !v)} isMoreActive={isMoreOpen} />
    </div>
  );
}
