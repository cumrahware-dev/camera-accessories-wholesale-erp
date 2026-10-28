/**
 * Every product the caller may see, page by page. GET /api/products returns 50 rows by default (newest first), so a
 * screen that fetched it once silently dropped every older product: stock received for an older catalogue item was in
 * the database but missing from the screen. Always fresh (no browser cache), so a just-posted purchase shows at once.
 * Browser-safe.
 */
export async function fetchAllProducts<T = any>(query = ''): Promise<T[]> {
  const PAGE = 200;
  const out: T[] = [];
  for (let page = 1; page <= 500; page++) {
    const r = await fetch(`/api/products?limit=${PAGE}&page=${page}${query ? `&${query.replace(/^[?&]/, '')}` : ''}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Products could not be loaded (${r.status}).`);
    const rows = await r.json();
    if (!Array.isArray(rows)) break;
    out.push(...rows);
    const total = Number(r.headers.get('X-Total-Count'));
    if (rows.length < PAGE || (Number.isFinite(total) && total > 0 && out.length >= total)) break;
  }
  return out;
}
