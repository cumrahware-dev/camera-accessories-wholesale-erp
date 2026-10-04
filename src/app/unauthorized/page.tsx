'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldAlert, ArrowLeft, Home, LogOut, Lock, UserCheck } from 'lucide-react';
import { getCurrentUserCachedSync, fetchCurrentUserCached, invalidateCurrentUser } from '@/lib/client-cache';
import { homePathForRole, isDepotRole } from '@/lib/rbac';
import { User } from '@/types/erp';

export default function UnauthorizedPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(() => getCurrentUserCachedSync()?.user || null);

  useEffect(() => {
    fetchCurrentUserCached().then((data) => {
      if (data?.authenticated && data.user) {
        setCurrentUser(data.user);
      }
    });
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

  const homePath = currentUser ? homePathForRole(currentUser.role) : '/login';

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-line rounded-2xl shadow-xl overflow-hidden text-center p-6 sm:p-8 animate-fade-in">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 mb-5">
          <ShieldAlert className="h-8 w-8" />
        </div>

        <span className="text-[11px] font-bold font-mono uppercase tracking-wider text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 inline-block mb-3">
          403 Access Restricted
        </span>

        <h1 className="text-xl sm:text-2xl font-bold text-ink tracking-tight">
          Permission Required
        </h1>

        <p className="text-xs sm:text-sm text-muted mt-2 leading-relaxed">
          Your account role does not have authorization to view this section or perform this action in the ERP.
        </p>

        {currentUser && (
          <div className="mt-5 p-3.5 rounded-xl bg-surface border border-line-soft text-left text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-muted">Signed in as:</span>
              <span className="font-semibold text-ink">{currentUser.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Assigned Role:</span>
              <span className="font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded text-[10px]">
                {currentUser.role.replace(/_/g, ' ')}
              </span>
            </div>
            {currentUser.assignedDepotName && (
              <div className="flex items-center justify-between">
                <span className="text-muted">Depot Scope:</span>
                <span className="font-medium text-ink-secondary">{currentUser.assignedDepotName}</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-col sm:flex-row items-center gap-2.5">
          <Link
            href={homePath}
            prefetch={false}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold shadow-xs transition-colors"
          >
            <Home className="h-4 w-4" />
            <span>Return to {isDepotRole(currentUser?.role) ? 'Depot Hub' : 'Dashboard'}</span>
          </Link>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-line bg-white hover:bg-surface text-ink-secondary text-xs font-medium transition-colors"
          >
            <LogOut className="h-4 w-4 text-muted" />
            <span>Switch Account</span>
          </button>
        </div>
      </div>
    </div>
  );
}
