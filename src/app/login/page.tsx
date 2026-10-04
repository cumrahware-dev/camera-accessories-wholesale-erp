'use client';

/**
 * Staff sign-in (email + password) for Super Admins, Managers, ERP users and named depot accounts.
 * Always starts empty: no values are read from storage, nothing is remembered, there are no demo credentials.
 */
import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { homePathForRole } from '@/lib/rbac';

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEmail('');
    setPassword('');
    try { window.localStorage.removeItem('erp_remembered_access_code'); } catch {} // left behind by the old login page
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) { setPassword(''); setError(''); } };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Invalid email or password.');
        setPassword('');
        setBusy(false);
        return;
      }
      setPassword('');
      const next = params.get('next');
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
      window.location.assign(safeNext || homePathForRole(data.user?.role));
    } catch {
      setError('Could not reach the server. Please check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-surface text-ink flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pdflogo.png" alt="ARIB GLOBAL" className="h-14 w-auto object-contain mx-auto" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
          <h1 className="text-xl font-bold tracking-tight text-ink">ARIB GLOBAL</h1>
          <p className="text-sm font-medium text-ink-secondary">Staff Sign In</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-line bg-white p-6 shadow-sm space-y-4">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger-border bg-danger-soft p-3 text-xs text-danger">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="staff-email" className="block text-xs font-semibold text-ink-secondary">Email</label>
            <input
              id="staff-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus maxLength={200}
              className="w-full h-12 rounded-xl border border-line bg-surface px-4 text-base text-ink focus:border-primary focus:bg-white focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="staff-password" className="block text-xs font-semibold text-ink-secondary">Password</label>
            <input
              id="staff-password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" maxLength={200}
              className="w-full h-12 rounded-xl border border-line bg-surface px-4 text-base text-ink focus:border-primary focus:bg-white focus:outline-none"
            />
          </div>
          <button type="submit" disabled={busy}
            className="w-full h-12 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{busy ? 'Signing in…' : 'Sign In'}</span>
            {!busy && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>

        <p className="text-center text-xs text-muted">
          Warehouse team? <Link href="/depot-login" className="text-primary font-medium hover:underline">Depot login with access code</Link>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
