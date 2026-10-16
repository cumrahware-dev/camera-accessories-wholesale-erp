// Browser sweep: every page for every role at desktop + phone width. Collects console errors, failed requests,
// 4xx/5xx API calls, duplicate identical GETs, horizontal overflow, 404/application-error pages and chunk/asset failures.
import fs from 'fs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { BASE, CREDS, login, call, ok, suite, report } from './lib.mjs';
const admin = await login('admin');
const first = async (url, pick = (j) => (Array.isArray(j) ? j : j.items || j.customers || j.invoices || j.suppliers || j.documents || j.shipments || [])) => { const r = await call(admin, 'GET', url); return pick(r.j)[0]; };
const ids = {
  customer: (await first('/api/customers?limit=1'))?.id, product: (await first('/api/products?limit=1'))?.id, proforma: (await first('/api/proformas?limit=1'))?.id,
  invoice: (await first('/api/invoices?limit=1'))?.id, purchase: (await first('/api/purchase-invoices'))?.id, service: (await first('/api/service-invoices'))?.id,
  shipment: (await first('/api/shipments'))?.id, ocr: (await first('/api/ocr-documents?limit=1'))?.id, depot: 'dep-central', price: (await first('/api/price-support'))?.id,
};
const pages = ['/dashboard', '/customers', `/customers/${ids.customer}`, '/products', `/products/${ids.product}`, '/proformas', '/proformas/new', `/proformas/${ids.proforma}`, '/invoices', '/invoices/new', `/invoices/${ids.invoice}`,
  '/purchases', '/purchases/new', `/purchases/${ids.purchase}`, '/purchases/price-support', '/purchases/price-support/new', '/purchases/price-support/reports', '/suppliers', '/service-invoices', '/service-invoices/new', `/service-invoices/${ids.service}`,
  '/shipments', `/shipments/${ids.shipment}`, '/ocr', `/ocr/${ids.ocr}`, '/inventory', '/inventory/adjustments', '/inventory/serials', '/inventory/transfers', '/depots', `/depots/${ids.depot}`, '/orders',
  '/documents', '/reports', '/reports/sales', '/reports/inventory', '/reports/profit', '/accounting/journal', '/audit-logs', '/users', '/settings', '/settings/company', '/settings/backup', '/settings/email-templates'].filter((p) => !p.endsWith('undefined'));
const depotPages = ['/depot', '/depot/pick', '/depot/pack', '/depot/ship', '/depot/inventory', '/depot/users', '/depot-mobile'];
const browser = await chromium.launch();
const cookieOf = async (role) => { const ck = await login(role); const [n, v] = ck.split('='); return { name: n, value: v, url: BASE }; };
const isDupOk = (u) => /\/api\/(auth\/me|events|notifications|auth\/session)/.test(u);
const sweep = async (role, list, width, expectDenied = false) => {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 800 : 900 } });
  await ctx.addCookies([await cookieOf(role)]);
  const issues = [];
  for (const path of list) {
    const p = await ctx.newPage(); const errs = [], bad = [], gets = new Map();
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 160)));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
    p.on('requestfailed', (r) => { if (!/_rsc|aborted|ERR_ABORTED/.test(r.failure()?.errorText + r.url())) bad.push('failed ' + r.url().replace(BASE, '')); });
    p.on('response', (r) => { const u = r.url().replace(BASE, ''); if (r.status() >= 400 && (u.startsWith('/api/') || /\/_next\//.test(u))) bad.push(`${r.status()} ${u.slice(0, 90)}`); if (r.request().method() === 'GET' && u.startsWith('/api/')) gets.set(u, (gets.get(u) || 0) + 1); });
    let status = 0; try { const resp = await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 25000 }); status = resp?.status() ?? 0; } catch (e) { errs.push('nav: ' + e.message.slice(0, 100)); }
    await p.waitForTimeout(400);
    const text = (await p.locator('body').innerText().catch(() => '')).slice(0, 4000);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2).catch(() => false);
    const final = new URL(p.url()).pathname;
    const dupes = [...gets].filter(([u, n]) => n > 1 && !isDupOk(u)).map(([u, n]) => `${n}x ${u.slice(0, 70)}`);
    if (!expectDenied) {
      if (/Application error|This page could not be found|Internal Server Error|Unhandled Runtime Error/i.test(text)) errs.push('error page text');
      if (final !== path && /^\/(login|unauthorized)/.test(final)) errs.push(`redirected to ${final}`);
    }
    issues.push({ path, status, errs, bad: bad.filter((b) => !(expectDenied && /^40[13]/.test(b))), overflow, dupes, final });
    await p.close();
  }
  await ctx.close(); return issues;
};
const summarise = (name, rows, { allowOverflow = false } = {}) => {
  for (const r of rows) {
    ok(r.errs.length === 0 && r.bad.length === 0 && (allowOverflow || !r.overflow), `${name} ${r.path}`, [...r.errs, ...r.bad, r.overflow ? 'horizontal overflow' : ''].filter(Boolean).join(' | '));
  }
  const dup = rows.filter((r) => r.dupes.length); if (dup.length) console.log(`NOTE duplicate GETs (${name}): ` + dup.map((r) => r.path + ' ' + r.dupes.join(',')).join(' ; '));
};

suite('Super Admin: every page, desktop 1280');
summarise('admin@1280', await sweep('admin', pages, 1280));
suite('Super Admin: every page, phone 375');
summarise('admin@375', await sweep('admin', pages, 375));
suite('Manager and ERP user: pages they can open');
summarise('manager@1280', await sweep('manager', pages.filter((p) => !/^\/(users|settings\/backup|audit-logs)/.test(p)), 1280));
suite('Depot users');
summarise('depot@1280', await sweep('depotUser', depotPages, 1280));
summarise('depot@375', await sweep('depotUser', depotPages, 375));
suite('Depot: admin-only pages are blocked');
const denied = await sweep('depotUser', ['/users', '/settings', '/settings/backup', '/customers', '/purchases', '/audit-logs', '/accounting/journal'], 1280, true);
for (const r of denied) ok(/^\/(unauthorized|login|depot)/.test(r.final) || r.status === 403, `depot blocked from ${r.path}`, `landed on ${r.final} (${r.status})`);

suite('Navigation, refresh, session expiry, PWA');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addCookies([await cookieOf('admin')]);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/customers', { waitUntil: 'networkidle' }); await p.goto(BASE + '/products', { waitUntil: 'networkidle' });
  await p.goBack({ waitUntil: 'networkidle' }); ok(new URL(p.url()).pathname === '/customers', 'browser Back returns to the previous page');
  await p.goForward({ waitUntil: 'networkidle' }); ok(new URL(p.url()).pathname === '/products', 'browser Forward works');
  await p.reload({ waitUntil: 'networkidle' }); ok(new URL(p.url()).pathname === '/products' && (await p.locator('body').innerText()).length > 200, 'refresh keeps the page and session');
  await ctx.clearCookies(); await p.goto(BASE + '/invoices', { waitUntil: 'networkidle' }); ok(new URL(p.url()).pathname.startsWith('/login'), 'expired / missing session redirects to login', new URL(p.url()).pathname);
  const api = await ctx.request.get(BASE + '/api/invoices'); ok(api.status() === 401, 'expired session gets 401 from the API', String(api.status()));
  ok(errs.length === 0, 'no uncaught page errors during navigation', errs.join('|'));
  const m = await (await fetch(BASE + '/manifest.json')).json().catch(() => null); ok(m && m.name && m.icons?.length, 'PWA manifest valid', JSON.stringify(m)?.slice(0, 80));
  const sw = await fetch(BASE + '/sw.js'); const swt = await sw.text(); ok(sw.status === 200 && !/caches\.open\([^)]*\)[\s\S]{0,400}(\/api\/|_next)/.test(swt), 'service worker does not cache API or _next assets', `${sw.status}`);
  await ctx.close();
}
suite('Two users at once');
{
  const [a, b] = await Promise.all([call(admin, 'POST', '/api/customers', { companyName: 'Concurrent A ' + Date.now(), email: `ca-${Date.now()}@example.com` }), call(await login('manager'), 'POST', '/api/customers', { companyName: 'Concurrent B ' + Date.now(), email: `cb-${Date.now()}@example.com` })]);
  ok(a.s < 300 && b.s < 300, 'two users creating customers simultaneously both succeed', `${a.s}/${b.s}`);
  const ca = (a.j.customer || a.j).customerCode, cb = (b.j.customer || b.j).customerCode; ok(ca && cb && ca !== cb, 'customer codes are unique under concurrency', `${ca} ${cb}`);
}
await browser.close();
report(process.env.E2E_OUT);
