'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Camera,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ShieldCheck,
  ArrowRight,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  X,
  Server,
  Zap,
  UserCheck,
} from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedEmail = localStorage.getItem('erp_remembered_email');
      if (savedEmail) setEmail(savedEmail);
    }

    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setSettings(data);
      })
      .catch(() => {});
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.getModifierState) {
      setCapsLockOn(e.getModifierState('CapsLock'));
    }
  };

  const executeLogin = async (loginEmail: string, loginPass: string) => {
    setErrorMessage('');
    setSuccessMessage('');

    const cleanEmail = loginEmail.trim();
    if (!cleanEmail) {
      setErrorMessage('Please enter your corporate email address.');
      return;
    }
    if (!loginPass) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password: loginPass }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed. Please check your credentials.');
      }

      setSuccessMessage(`Authenticated as ${data.user.name} (${data.user.role}). Redirecting...`);

      if (typeof window !== 'undefined') {
        localStorage.setItem('erp_current_user', JSON.stringify(data.user));
        if (rememberMe) {
          localStorage.setItem('erp_remembered_email', cleanEmail);
        } else {
          localStorage.removeItem('erp_remembered_email');
        }
      }

      setTimeout(() => {
        if (data.user.role === 'DEPOT_USER') {
          router.push('/depot');
        } else {
          router.push('/dashboard');
        }
      }, 400);
    } catch (err: any) {
      setErrorMessage(err.message || 'Invalid email or password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await executeLogin(email, password);
  };

  const handleQuickAccess = async (quickEmail: string, quickPass: string) => {
    setEmail(quickEmail);
    setPassword(quickPass);
    await executeLogin(quickEmail, quickPass);
  };

  const demoAccounts = [
    {
      name: 'System Administrator',
      role: 'SUPER_ADMIN',
      badge: 'Super Admin',
      email: 'admin@aribglobal.com',
      pass: 'Admin@Arib2026!',
    },
    {
      name: 'Depot Manager',
      role: 'DEPOT_USER',
      badge: 'Central Depot',
      email: 'depot@aribglobal.com',
      pass: 'Depot@Arib2026!',
    },
  ];

  const brandName = settings?.tradingName || settings?.companyName || 'ARIB GLOBAL';

  return (
    <div className="min-h-screen bg-surface text-ink flex flex-col justify-center items-center p-4 sm:p-6 select-none">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pdflogo.png"
              alt="ARIB GLOBAL"
              className="h-16 w-auto object-contain max-h-20"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-primary-soft text-primary">
              Enterprise ERP
            </span>
          </div>
          <p className="text-xs text-muted max-w-xs mx-auto">
            Camera & Cine Optical Accessories Wholesale System
          </p>
        </div>

        {/* White Enterprise Sign-In Card */}
        <div className="rounded-2xl border border-line bg-white p-6 sm:p-8 shadow-sm space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-line-soft">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold text-ink">Sign In to Account</h2>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-muted text-ink-secondary text-[10px] font-mono font-medium">
              <ShieldCheck className="h-3 w-3 text-success" />
              <span>TLS Encrypted</span>
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 rounded-2xl bg-danger-soft border border-danger-border text-danger text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-2xl bg-success-soft border border-success-border text-success text-xs flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              <span>{successMessage}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="block text-ink-secondary font-semibold">Work Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted" />
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. sarah.admin@lenscore.com"
                  className="w-full rounded-full border border-line bg-surface pl-9 pr-3 py-2.5 text-xs text-ink placeholder-muted focus:bg-white focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-ink-secondary font-semibold">Password</label>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(true)}
                  className="text-[11px] text-primary font-medium hover:underline"
                >
                  Forgot Password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onKeyUp={handleKeyDown}
                  placeholder="Enter password"
                  className="w-full rounded-full border border-line bg-surface pl-9 pr-9 py-2.5 text-xs text-ink placeholder-muted focus:bg-white focus:border-primary focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-muted hover:text-ink-secondary"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {capsLockOn && (
                <div className="text-[11px] text-warning font-medium">Caps Lock is ON</div>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-muted">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-line text-primary focus:ring-0"
                />
                <span className="text-[11px]">Remember work email</span>
              </label>

              <button
                type="button"
                onClick={() => setShowHelpModal(true)}
                className="flex items-center gap-1 text-[11px] text-muted hover:text-ink"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                <span>Help</span>
              </button>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-full bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Verifying Credentials...' : 'Sign In'}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </form>

          {/* Quick Access Demo Logins */}
          <div className="pt-4 border-t border-line-soft space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-ink-secondary">
              <div className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-warning fill-warning/20" />
                <span>Quick Access Demo Accounts</span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              {demoAccounts.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleQuickAccess(acc.email, acc.pass)}
                  className="w-full flex items-center justify-between p-2.5 rounded-2xl border border-line bg-surface hover:bg-surface-muted text-left transition-colors group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <UserCheck className="h-3.5 w-3.5 text-muted group-hover:text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-ink truncate">{acc.name}</span>
                        <span className="text-[9px] font-semibold text-primary bg-primary-soft px-1.5 py-0.5 rounded-full shrink-0">
                          {acc.badge}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted font-mono truncate block">{acc.email}</span>
                    </div>
                  </div>
                  <ArrowRight className="h-3 w-3 text-muted group-hover:text-primary shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Notice */}
        <div className="text-center text-[11px] text-muted space-y-0.5">
          <p>ARIB GLOBAL · Camera & Cine Wholesale ERP · Dubai · Singapore · Bangalore · Mumbai</p>
        </div>
      </div>

      {/* Help Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in overflow-y-auto">
          <div className="relative w-full max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain max-w-md rounded-2xl border border-line bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-line-soft">
              <h3 className="text-sm font-bold text-ink">Enterprise Access Assistance</h3>
              <button onClick={() => setShowHelpModal(false)} className="text-muted hover:text-ink-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-ink-secondary">
              User accounts and role permissions are managed by your Super Administrator. Please contact support@lenscore.com for password resets or depot assignment updates.
            </p>
            <div className="flex justify-end pt-2 border-t border-line-soft">
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="px-4 py-2 rounded-full bg-surface-muted text-xs font-semibold text-ink-secondary hover:bg-line"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
