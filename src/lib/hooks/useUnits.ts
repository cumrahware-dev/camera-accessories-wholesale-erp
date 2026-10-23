'use client';

import { useEffect, useState } from 'react';
import { fmtQtyWithUnit, type UnitInfo } from '@/lib/quantity';

let cached: UnitInfo[] | null = null;
let inflight: Promise<UnitInfo[]> | null = null;
const FALLBACK: UnitInfo[] = [{ code: 'Pcs', decimals: 0 }, { code: 'Mt', decimals: 3 }, { code: 'Tonnes', decimals: 3 }, { code: 'Kg', decimals: 3 }];

async function load(): Promise<UnitInfo[]> {
  if (cached) return cached;
  inflight ??= fetch('/api/units', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : FALLBACK)).catch(() => FALLBACK).then((l) => (cached = Array.isArray(l) && l.length ? l : FALLBACK));
  return inflight;
}

/** Configured units of measure (one shared fetch per page load) and a formatter that keeps trailing zeros: fmt(54.62, 'Mt') -> "54.620 Mt". */
export function useUnits() {
  const [units, setUnits] = useState<UnitInfo[]>(cached ?? FALLBACK);
  useEffect(() => { let live = true; load().then((u) => live && setUnits(u)); return () => { live = false; }; }, []);
  return {
    units,
    decimalsFor: (code?: string | null) => units.find((u) => u.code.toLowerCase() === String(code ?? '').toLowerCase())?.decimals ?? 0,
    fmt: (q: unknown, unit?: string | null, withUnit = true) => fmtQtyWithUnit(q, unit, units, withUnit),
  };
}
