'use client';

import { useEffect, useState } from 'react';

export interface ClientDefaultTax { id: string | null; name: string; rate: number }

// The default tax comes from Settings -> Company & Business Details -> Tax Rates. Nothing here assumes a rate.
const NONE: ClientDefaultTax = { id: null, name: 'Tax', rate: 0 };
let cached: { value: ClientDefaultTax; at: number } | null = null;
let inflight: Promise<ClientDefaultTax> | null = null;

export function fetchDefaultTax(force = false): Promise<ClientDefaultTax> {
  if (!force && cached && Date.now() - cached.at < 60_000) return Promise.resolve(cached.value);
  inflight ??= fetch('/api/tax-rates', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { const v: ClientDefaultTax = j?.default ?? NONE; cached = { value: v, at: Date.now() }; return v; })
    .catch(() => cached?.value ?? NONE)
    .finally(() => { inflight = null; });
  return inflight;
}

export function invalidateDefaultTax() { cached = null; }

/** The configured default tax. `loaded` is false until the first answer arrives. */
export function useDefaultTax(): ClientDefaultTax & { loaded: boolean } {
  const [t, setT] = useState<ClientDefaultTax & { loaded: boolean }>({ ...(cached?.value ?? NONE), loaded: !!cached });
  useEffect(() => {
    let alive = true;
    fetchDefaultTax().then((v) => { if (alive) setT({ ...v, loaded: true }); });
    return () => { alive = false; };
  }, []);
  return t;
}

/** "VAT / Tax (x%):" built from the rates the lines really carry: shown when every line shares one rate, otherwise without a rate. */
export function taxLabel(rates: number[]): string {
  const uniq = Array.from(new Set(rates.map((r) => Number(r) || 0)));
  return uniq.length === 1 ? `VAT / Tax (${uniq[0]}%):` : 'VAT / Tax:';
}
