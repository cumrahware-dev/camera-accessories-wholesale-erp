'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const PAGE = 50;

/**
 * Searches the WHOLE product catalogue on the server (name, SKU, brand, model, barcode), page by page, and remembers every
 * product it has seen so lines already on a document keep their name / SKU / price whatever the current search shows.
 * Shared by the Proforma / direct Tax Invoice builder and the draft editors, so they all find the same products.
 */
export function useProductCatalogue<T extends { id: string }>({ activeOnly = true }: { activeOnly?: boolean } = {}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [version, setVersion] = useState(0);
  const cache = useRef(new Map<string, T>());
  const [, bump] = useState(0);
  const seq = useRef(0);

  const remember = (list: T[]) => { for (const p of list) cache.current.set(p.id, p); bump((n) => n + 1); };

  const fetchPage = useCallback(async (q: string, pg: number, signal: AbortSignal) => {
    const params = new URLSearchParams({ limit: String(PAGE), page: String(pg) });
    if (q.trim()) params.set('q', q.trim());
    if (activeOnly) params.set('status', 'ACTIVE');
    const res = await fetch(`/api/products?${params}`, { cache: 'no-store', signal });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || (res.status === 403 ? 'You do not have permission to view products.' : `Could not load products (${res.status}).`));
    }
    const list = (await res.json()) as T[];
    const t = Number(res.headers.get('X-Total-Count'));
    return { list: Array.isArray(list) ? list : [], total: Number.isFinite(t) ? t : null };
  }, [activeOnly]);

  // (re)start from page 1 whenever the search text changes (debounced) or a retry is requested
  useEffect(() => {
    const ctrl = new AbortController();
    const my = ++seq.current;
    setLoading(true); setError(null);
    const t = setTimeout(async () => {
      try {
        const { list, total } = await fetchPage(query, 1, ctrl.signal);
        if (my !== seq.current) return;
        remember(list); setResults(list); setTotal(total); setPage(1);
        setHasMore(total !== null ? list.length < total : list.length === PAGE);
      } catch (e: any) {
        if (e?.name === 'AbortError' || my !== seq.current) return;
        setError(e?.message || 'Could not load products.'); setResults([]);
      } finally { if (my === seq.current) setLoading(false); }
    }, query ? 250 : 0);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query, version, fetchPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    const my = seq.current;
    setLoading(true);
    try {
      const { list, total } = await fetchPage(query, page + 1, new AbortController().signal);
      if (my !== seq.current) return;
      remember(list);
      setResults((prev) => { const seen = new Set(prev.map((p) => p.id)); const merged = [...prev, ...list.filter((p) => !seen.has(p.id))]; setHasMore(total !== null ? merged.length < total : list.length === PAGE); return merged; });
      setPage(page + 1);
    } catch (e: any) { setError(e?.message || 'Could not load more products.'); } finally { setLoading(false); }
  }, [loading, hasMore, fetchPage, query, page]);

  /** Loads products by id (those already on a document) so they display correctly even if the search never returns them. */
  const ensure = useCallback(async (ids: string[]) => {
    const missing = Array.from(new Set(ids.filter((id) => id && !cache.current.has(id))));
    if (!missing.length) return;
    try {
      const res = await fetch(`/api/products?ids=${encodeURIComponent(missing.join(','))}&limit=200`, { cache: 'no-store' });
      if (res.ok) remember((await res.json()) as T[]);
    } catch { /* the line still shows its saved name */ }
  }, []);

  return {
    query, setQuery, results, total, loading, error, hasMore, loadMore, ensure,
    retry: () => setVersion((v) => v + 1),
    /** every product seen so far (search results, earlier pages, ensured ids) */
    all: Array.from(cache.current.values()),
    get: (id: string) => cache.current.get(id),
  };
}
