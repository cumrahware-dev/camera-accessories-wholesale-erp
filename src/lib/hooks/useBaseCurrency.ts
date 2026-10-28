'use client';
import { useEffect, useState } from 'react';
import { fetchSettingsCached } from '@/lib/client-cache';

/** The company's base currency (Settings -> Company): the currency stock costs and valuations are kept in. */
export function useBaseCurrency(): string {
  const [cur, setCur] = useState('USD');
  useEffect(() => {
    let live = true;
    fetchSettingsCached().then((s) => { if (live && s?.currency) setCur(String(s.currency).toUpperCase()); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return cur;
}
