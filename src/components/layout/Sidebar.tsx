'use client';

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileCheck2,
  Receipt,
  FileText,
  ShoppingCart,
  Users,
  Package,
  Boxes,
  Barcode,
  ArrowLeftRight,
  SlidersHorizontal,
  Building2,
  Truck,
  FolderLock,
  TrendingUp,
  BarChart3,
  ScrollText,
  Settings,
  Smartphone,
  ShieldAlert,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';
import { User } from '@/types/erp';
import { hasPermission, isDepotScoped, NAV_SECTIONS } from '@/lib/rbac';
import { fetchCurrentUserCached, getCurrentUserCachedSync } from '@/lib/client-cache';
import { cn } from '@/lib/utils';

const iconMap: Record<string, any> = {
  LayoutDashboard,
  FileCheck2,
  Receipt,
  FileText,
  ShoppingCart,
  Users,
  Package,
  Boxes,
  Barcode,
  ArrowLeftRight,
  SlidersHorizontal,
  Building2,
  Truck,
  FolderLock,
  TrendingUp,
  BarChart3,
  ScrollText,
  Settings,
  Smartphone,
  ShieldAlert,
};

const COLLAPSE_KEY = 'erp_sidebar_collapsed';

export default function Sidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
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
  const [isMounted, setIsMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const syncUser = getCurrentUserCachedSync()?.user;
    if (syncUser) setCurrentUser(syncUser);

    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {}

    fetchCurrentUserCached().then((data) => {
      if (data?.authenticated && data.user) {
        setCurrentUser(data.user);
      }
    });
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  const isDepotUser = isMounted && isDepotScoped({
    userId: currentUser.id,
    email: currentUser.email,
    role: currentUser.role as any,
    assignedDepotId: currentUser.assignedDepotId,
  });

  const navSections = NAV_SECTIONS.map((section) => ({
    title: section.title,
    items: section.items
      .filter((item) => hasPermission(currentUser?.role, item.permission))
      .map((item) => ({
        name: item.name,
        href: item.href,
        icon: iconMap[item.icon] || LayoutDashboard,
        highlight: item.highlight,
      })),
  })).filter((section) => section.items.length > 0);

  const allHrefs = navSections.flatMap((s) => s.items.map((i) => i.href));

  const isItemActive = (href: string) => {
    if (pathname === href) return true;
    if (pathname.startsWith(href + '/')) {
      const hasMoreSpecificMatch = allHrefs.some(
        (otherHref) =>
          otherHref !== href &&
          otherHref.length > href.length &&
          (pathname === otherHref || pathname.startsWith(otherHref + '/'))
      );
      return !hasMoreSpecificMatch;
    }
    return false;
  };

  return (
    <>
    <aside
      className={cn(
        'shrink-0 border-r border-line bg-white flex flex-col justify-between hidden md:flex h-full min-h-0 overflow-hidden select-none transition-[width] duration-150 no-print print:hidden',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Brand Header */}
      {!collapsed && (
        <div className="px-5 py-4 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pdflogo.png"
              alt="ARIB GLOBAL"
              className="h-8 w-auto object-contain shrink-0 max-h-9"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] text-muted font-medium truncate">Camera & Cine OS</span>
            </div>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary-soft text-primary uppercase shrink-0">
            ERP
          </span>
        </div>
      )}

      {isDepotUser && !collapsed && (
        <div className="shrink-0 mx-3 mb-2 p-3 rounded-2xl border border-warning-border bg-warning-soft text-warning text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-xs">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>Sandboxed View</span>
          </div>
          <p className="text-[11px] mt-1 leading-normal opacity-90">
            Scoped strictly to {currentUser.assignedDepotName}.
          </p>
        </div>
      )}

      {/* Nav List */}
      <div className="flex-1 min-h-0 overflow-y-auto py-2 px-3 space-y-5">
        {navSections.map((section, idx) => (
          <div key={idx}>
            {!collapsed && (
              <div className="px-3 text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                {section.title}
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = isItemActive(item.href);
                const Icon = item.icon;

                return (
                  <Link
                    key={`${item.href}-${item.name}`}
                    href={item.href}
                    prefetch={false}
                    title={collapsed ? item.name : undefined}
                    className={cn(
                      'group flex items-center gap-3 px-3 py-2.5 rounded-full text-sm font-medium transition-colors relative',
                      collapsed && 'justify-center px-0 py-3',
                      isActive
                        ? 'bg-ink text-white font-semibold'
                        : item.highlight
                          ? 'text-success hover:bg-success-soft'
                          : 'text-ink-secondary hover:text-ink hover:bg-surface'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4.5 w-4.5 shrink-0',
                        isActive ? 'text-white' : item.highlight ? 'text-success' : 'text-muted group-hover:text-ink'
                      )}
                    />
                    {!collapsed && (
                      <>
                        <span className="truncate">{item.name}</span>
                        {item.highlight && (
                          <span className="ml-auto rounded-full bg-success-soft px-1.5 py-0.5 text-[9px] font-bold text-success uppercase shrink-0">
                            Depot UI
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Collapse Button */}
      <div className="shrink-0 p-3 border-t border-line-soft bg-white">
        <button
          onClick={toggleCollapsed}
          className={cn(
            'flex items-center gap-2.5 w-full px-3 py-2.5 rounded-full text-sm font-medium text-muted hover:text-ink hover:bg-surface transition-colors',
            collapsed && 'justify-center px-0'
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="h-4.5 w-4.5" /> : <PanelLeftClose className="h-4.5 w-4.5" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>

    {/* Mobile off-canvas navigation drawer */}
    <Dialog.Root
      open={!!mobileOpen}
      onOpenChange={(o) => {
        if (!o) onMobileClose?.();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] md:hidden" />
        <Dialog.Content
          className="fixed left-0 top-0 z-50 h-full h-[100dvh] w-[82%] max-w-[300px] border-r border-line bg-white shadow-popover flex flex-col focus:outline-none md:hidden"
          aria-describedby={undefined}
        >
          <div className="shrink-0 px-4 py-4 flex items-center justify-between gap-2.5 border-b border-line-soft">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/pdflogo.png"
                alt="ARIB GLOBAL"
                className="h-8 w-auto object-contain shrink-0 max-h-9"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <div className="flex flex-col min-w-0">
                <Dialog.Title className="sr-only">Navigation Menu</Dialog.Title>
                <span className="text-[11px] text-muted font-medium truncate">Camera & Cine OS</span>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                className="p-2.5 -mr-1 rounded-full text-muted hover:text-ink hover:bg-surface shrink-0"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          {isDepotUser && (
            <div className="shrink-0 mx-3 mt-3 p-3 rounded-2xl border border-warning-border bg-warning-soft text-warning text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-xs">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>Sandboxed View</span>
              </div>
              <p className="text-[11px] mt-1 leading-normal opacity-90">
                Scoped strictly to {currentUser.assignedDepotName}.
              </p>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto py-3 px-3 space-y-5">
            {navSections.map((section, idx) => (
              <div key={idx}>
                <div className="px-3 text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                  {section.title}
                </div>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = isItemActive(item.href);
                    const Icon = item.icon;

                    return (
                      <Link
                        key={`mobile-${item.href}-${item.name}`}
                        href={item.href}
                        prefetch={false}
                        onClick={() => onMobileClose?.()}
                        className={cn(
                          'group flex min-h-11 items-center gap-3 px-3 py-2.5 rounded-full text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-ink text-white font-semibold'
                            : item.highlight
                              ? 'text-success hover:bg-success-soft'
                              : 'text-ink-secondary hover:text-ink hover:bg-surface'
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-5 w-5 shrink-0',
                            isActive ? 'text-white' : item.highlight ? 'text-success' : 'text-muted group-hover:text-ink'
                          )}
                        />
                        <span className="truncate">{item.name}</span>
                        {item.highlight && (
                          <span className="ml-auto rounded-full bg-success-soft px-1.5 py-0.5 text-[9px] font-bold text-success uppercase shrink-0">
                            Depot UI
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    </>
  );
}
