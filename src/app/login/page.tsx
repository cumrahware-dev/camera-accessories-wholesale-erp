'use client';

/**
 * ARIB GLOBAL — ERP Access
 * Access-code-only authentication for ERP users and administrators.
 * Always initializes with an empty access code input. Zero demo credentials or pre-fills.
 */
import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';

function ErpLoginForm() {
  const params = useSearchParams();
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAccessCode('');
    if (inputRef.current) inputRef.current.value = '';
    try {
      window.localStorage.removeItem('erp_remembered_access_code');
      window.sessionStorage.clear();
    } catch {}

    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        setAccessCode('');
        setError('');
      }
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');

    const trimmed = accessCode.trim();
    if (!trimmed) {
      setError('Please enter your access code.');
      inputRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ accessCode: trimmed }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Invalid access code. Please try again.');
        setAccessCode('');
        if (inputRef.current) inputRef.current.value = '';
        setBusy(false);
        return;
      }

      setAccessCode('');
      const next = params.get('next');
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
      window.location.assign(safeNext || data.redirect || '/dashboard');
    } catch {
      setError('Unable to connect. Please try again.');
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pdflogo.png"
            alt="ARIB GLOBAL"
            className="h-14 w-auto object-contain mx-auto"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          <h1 className="text-xl font-bold tracking-tight text-slate-900">ARIB GLOBAL</h1>
          <p className="text-sm font-medium text-slate-500">ERP Access</p>
        </div>

        <form
          onSubmit={submit}
          autoComplete="off"
          className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-5"
        >
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
              <span className="font-medium leading-relaxed">{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="erp-access-code" className="block text-xs font-semibold text-slate-700">
              Access Code
            </label>
            <input
              ref={inputRef}
              id="erp-access-code"
              name="erp-access-code"
              type="password"
              inputMode="text"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              placeholder="Enter access code"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              maxLength={60}
              className="w-full h-12 rounded-xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors shadow-sm cursor-pointer"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{busy ? 'Authenticating…' : 'Continue'}</span>
            {!busy && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500">
          Warehouse or Depot team?{' '}
          <Link href="/depot/login" className="text-blue-600 font-medium hover:underline">
            Depot Access →
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <ErpLoginForm />
    </Suspense>
  );
}
