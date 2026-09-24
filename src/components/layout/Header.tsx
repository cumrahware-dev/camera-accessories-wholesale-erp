'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Search,
  Bell,
  Camera,
  Building2,
  PlusCircle,
  FileText,
  Globe,
  Smartphone,
  LogOut,
  KeyRound,
  Eye,
  EyeOff,
  ChevronRight,
  Menu,
} from 'lucide-react';
import { User, Notification } from '@/types/erp';
import { formatDateTime } from '@/lib/utils';
import dataStore from '@/lib/data-store';
import { fetchCurrentUserCached, getCurrentUserCachedSync, fetchSettingsCached, invalidateCurrentUser, invalidateSettings } from '@/lib/client-cache';
import GlobalSearchModal from '@/components/search/GlobalSearchModal';
import CloudinaryUploadModal from '@/components/documents/CloudinaryUploadModal';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { useToast } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';

// Helper to determine breadcrumb section label from current path
function getSectionFromPath(pathname: string) {
  if (pathname === '/dashboard') return { section: 'Sales & Orders', page: 'Dashboard' };
  if (pathname.startsWith('/proformas')) return { section: 'Sales & Orders', page: 'Proformas' };
  if (pathname.startsWith('/invoices')) return { section: 'Sales & Orders', page: 'Tax Invoices' };
  if (pathname.startsWith('/orders')) return { section: 'Sales & Orders', page: 'Order Pipeline' };
  if (pathname.startsWith('/customers')) return { section: 'Sales & Orders', page: 'Customers' };
  if (pathname.startsWith('/products')) return { section: 'Inventory', page: 'Product Catalog' };
  if (pathname.startsWith('/inventory/serials')) return { section: 'Inventory', page: 'Serial Numbers' };
  if (pathname.startsWith('/inventory/transfers')) return { section: 'Inventory', page: 'Stock Transfers' };
  if (pathname.startsWith('/inventory/adjustments')) return { section: 'Inventory', page: 'Stock Adjustments' };
  if (pathname.startsWith('/inventory')) return { section: 'Inventory', page: 'Inventory' };
  if (pathname.startsWith('/depot-mobile')) return { section: 'Depot & Fulfilment', page: 'Depot Operations' };
  if (pathname.startsWith('/depot')) return { section: 'Depot & Fulfilment', page: 'Depot Operations' };
  if (pathname.startsWith('/depots')) return { section: 'Depot & Fulfilment', page: 'Depots' };
  if (pathname.startsWith('/shipments')) return { section: 'Depot & Fulfilment', page: 'Shipments & AWBs' };
  if (pathname.startsWith('/documents')) return { section: 'Documents', page: 'Documents' };
  if (pathname.startsWith('/reports/profit')) return { section: 'Analytics', page: 'Profitability' };
  if (pathname.startsWith('/reports/sales')) return { section: 'Analytics', page: 'Sales Reports' };
  if (pathname.startsWith('/reports/inventory')) return { section: 'Analytics', page: 'Inventory Reports' };
  if (pathname.startsWith('/reports')) return { section: 'Analytics', page: 'Reports' };
  if (pathname.startsWith('/audit-logs')) return { section: 'Analytics', page: 'Audit Logs' };
  if (pathname.startsWith('/users')) return { section: 'Administration', page: 'Users & Permissions' };
  if (pathname.startsWith('/settings')) return { section: 'Administration', page: 'Settings' };
  return { section: 'ERP System', page: 'Overview' };
}

export default function Header({ onOpenMobileNav }: { onOpenMobileNav?: () => void } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState<User>(() => dataStore.getCurrentUser());
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  const [settings, setSettings] = useState<any>(null);

  const reloadData = async (force = false) => {
    try {
      const [data, setJson] = await Promise.all([fetchCurrentUserCached(force), fetchSettingsCached(force)]);

      if (data?.authenticated && data.user) {
        setCurrentUser(data.user);
        dataStore.setCurrentUser(data.user.id);
      } else if (!data) {
        setCurrentUser(dataStore.getCurrentUser());
      }

      if (setJson) setSettings(setJson);
    } catch {
      setCurrentUser(dataStore.getCurrentUser());
    }
    setNotifications(dataStore.getNotifications(currentUser.role, currentUser.assignedDepotId));
  };

  useEffect(() => {
    setIsMounted(true);
    const syncUser = getCurrentUserCachedSync()?.user;
    if (syncUser) setCurrentUser(syncUser);
    reloadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    invalidateCurrentUser();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('erp_current_user');
    }
    router.push('/login');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    setIsSubmittingPassword(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');

      toast({ title: 'Password updated', description: 'Your password has been changed successfully.', variant: 'success' });
      setIsChangePasswordOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to update password.');
    } finally {
      setIsSubmittingPassword(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkAllRead = () => {
    dataStore.markAllNotificationsAsRead();
    reloadData();
  };

  const breadcrumb = getSectionFromPath(pathname);

  return (
    <>
      <header className="shrink-0 z-30 flex h-16 w-full items-center justify-between border-b border-line bg-white px-3 sm:px-6 no-print print:hidden">
        {/* Left: Mobile Menu Toggle + Section Breadcrumb */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onOpenMobileNav}
            className="md:hidden -ml-1 flex h-11 w-11 items-center justify-center shrink-0 rounded-full text-ink-secondary hover:text-ink hover:bg-surface transition-colors"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-xs text-muted font-medium hidden sm:inline">{breadcrumb.section}</span>
          <ChevronRight className="h-3.5 w-3.5 text-line hidden sm:inline" />
          <span className="text-sm font-semibold text-ink truncate">{breadcrumb.page}</span>

          {isMounted && currentUser.assignedDepotName && (
            <span className="ml-2 hidden lg:inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-0.5 text-[11px] font-medium text-warning border border-warning-border">
              <Building2 className="h-3 w-3" />
              Depot: {currentUser.assignedDepotName}
            </span>
          )}
        </div>

        {/* Center: Global Search Bar */}
        <div className="flex-1 max-w-md mx-4 hidden md:block">
          <button
            onClick={() => setIsSearchOpen(true)}
            className="flex w-full items-center justify-between rounded-full border border-line bg-surface/60 px-4 py-2 text-xs text-muted hover:border-ink/15 hover:bg-surface transition-colors"
          >
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-muted" />
              <span>Search invoices, proformas, SKUs, serials, AWBs...</span>
            </div>
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-mono text-muted border border-line">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right: Quick Actions & Profile */}
        <div className="flex items-center gap-2">
          <IconButton label="Search" onClick={() => setIsSearchOpen(true)} className="md:hidden text-ink-secondary">
            <Search className="h-4 w-4" />
          </IconButton>

          {currentUser.role !== 'DEPOT_USER' && (
            <Button
              size="sm"
              iconLeft={<PlusCircle className="h-3.5 w-3.5" />}
              className="hidden sm:inline-flex"
              onClick={() => router.push('/proformas/new')}
            >
              New Proforma
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            iconLeft={<FileText className="h-3.5 w-3.5 text-primary" />}
            className="hidden lg:inline-flex"
            onClick={() => setIsUploadOpen(true)}
            title="Upload document or photo to Cloudinary"
          >
            Upload
          </Button>

          {/* Notifications Popover */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="relative p-2.5 text-ink-secondary hover:text-ink rounded-full hover:bg-surface transition-colors" aria-label="Notifications">
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-2 right-2 flex h-2 w-2 rounded-full bg-danger" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-80 sm:w-96 p-0 bg-white border border-line rounded-2xl overflow-hidden shadow-popover">
              <div className="flex items-center justify-between px-4 py-3 border-b border-line-soft bg-surface">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold text-ink">Notifications</span>
                  <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-ink-secondary">{notifications.length}</span>
                </div>
                {unreadCount > 0 && (
                  <button onClick={handleMarkAllRead} className="text-xs text-primary font-medium hover:underline">
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto p-2 space-y-1">
                {notifications.length === 0 ? (
                  <EmptyState icon={Bell} title="No notifications" compact />
                ) : (
                  notifications.map((n) => (
                    <Link
                      key={n.id}
                      href={n.link}
                      prefetch={false}
                      onClick={() => {
                        dataStore.markNotificationAsRead(n.id);
                        reloadData();
                      }}
                      className={`block p-2.5 rounded-xl border transition-colors ${
                        n.read ? 'border-transparent hover:bg-surface' : 'border-primary/15 bg-primary-soft/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-ink line-clamp-1">{n.title}</span>
                        {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 mt-1" />}
                      </div>
                      <p className="text-xs text-muted mt-1 line-clamp-2">{n.message}</p>
                      <span className="text-[10px] font-mono text-muted mt-1.5 block">{formatDateTime(n.createdAt)}</span>
                    </Link>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Profile Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2 rounded-full border border-line bg-white p-1 sm:pl-1.5 sm:pr-3 sm:py-1 hover:bg-surface transition-colors"
                suppressHydrationWarning
              >
                <Avatar name={isMounted ? currentUser.name : ''} src={isMounted ? currentUser.avatar : undefined} size="sm" />
                <div className="text-left hidden md:block" suppressHydrationWarning>
                  <div className="text-xs font-semibold text-ink line-clamp-1">
                    {isMounted ? currentUser.name : <span className="inline-block w-16 h-3 bg-surface-muted rounded" />}
                  </div>
                  <div className="text-[10px] text-muted leading-tight">
                    {isMounted ? currentUser.role.replace('_', ' ') : ''}
                  </div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60 bg-white border border-line rounded-2xl overflow-hidden shadow-popover">
              <div className="px-3 py-2.5 rounded-xl bg-surface mb-1 border border-line-soft" suppressHydrationWarning>
                <div className="font-semibold text-xs text-ink line-clamp-1">{currentUser.name}</div>
                <div className="text-[11px] text-muted truncate">{currentUser.email}</div>
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <Badge tone="primary">{currentUser.role.replace('_', ' ')}</Badge>
                  {currentUser.assignedDepotName && <Badge tone="info">{currentUser.assignedDepotName}</Badge>}
                </div>
              </div>
              <DropdownMenuItem onSelect={() => setIsChangePasswordOpen(true)} className="text-xs text-ink-secondary hover:bg-surface">
                <KeyRound className="h-3.5 w-3.5 text-muted" />
                Change Password
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={handleLogout} className="text-xs text-danger hover:bg-danger-soft">
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {isSearchOpen && <GlobalSearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />}
      {isUploadOpen && <CloudinaryUploadModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} onUploaded={() => reloadData()} />}

      <Modal
        open={isChangePasswordOpen}
        onClose={() => {
          setIsChangePasswordOpen(false);
          setPasswordError('');
        }}
        title="Change Password"
      >
        <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
          {passwordError && (
            <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs">{passwordError}</div>
          )}
          <div className="relative">
            <Input
              label="Current Password"
              type={showPassword ? 'text' : 'password'}
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-[30px] text-muted hover:text-ink-secondary"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <Input
            label="New Password"
            hint="Minimum 6 characters"
            type={showPassword ? 'text' : 'password'}
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password"
          />
          <Input
            label="Confirm New Password"
            type={showPassword ? 'text' : 'password'}
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-type new password"
          />
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line-soft">
            <Button type="button" variant="outline" onClick={() => setIsChangePasswordOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmittingPassword}>
              Update Password
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
