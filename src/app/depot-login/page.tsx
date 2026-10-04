'use client';

/**
 * Depot Login.
 *
 * The access code field is ALWAYS empty on load: nothing is read from storage, nothing is remembered, no sample or
 * demo code appears anywhere on this page, and the code is never written to localStorage / sessionStorage / cookies.
 * The code is sent once to the server over HTTPS and validated there.
 */
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';

export default function DepotLoginPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Defence against browsers / password managers restoring or injecting a value after load.
  useEffect(() => {
    setCode('');
    if (inputRef.current) inputRef.current.value = '';
    try { window.localStorage.removeItem('erp_remembered_access_code'); } catch {} // left behind by the old login page
    // Also drop the page from the bfcache so "Back" never shows a restored form.
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) { setCode(''); setError(''); } };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!code.trim()) { setError('Enter your access code.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/depot-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ accessCode: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Invalid access code. Please check your access code and try again.');
        setCode('');
        setBusy(false);
        return;
      }
      setCode('');
      window.location.assign(data.redirect || '/depot');
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
          <p className="text-sm font-medium text-ink-secondary">Depot Login</p>
        </div>

        <form
          onSubmit={submit}
          autoComplete="off"
          className="rounded-2xl border border-line bg-white p-6 shadow-sm space-y-4"
        >
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger-border bg-danger-soft p-3 text-xs text-danger">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="depot-access-code" className="block text-xs font-semibold text-ink-secondary">Access Code</label>
            <input
              ref={inputRef}
              id="depot-access-code"
              name="depot-access-code-field"
              type="text"
              inputMode="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter Access Code"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              maxLength={40}
              className="w-full h-12 rounded-xl border border-line bg-surface px-4 text-base font-mono tracking-wider text-ink placeholder:font-sans placeholder:tracking-normal placeholder:text-muted focus:border-primary focus:bg-white focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full h-12 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{busy ? 'Checking…' : 'Login'}</span>
            {!busy && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>

        <p className="text-center text-xs text-muted">
          Office staff? <Link href="/login" className="text-primary font-medium hover:underline">Sign in with email</Link>
        </p>
      </div>
    </main>
  );
}
