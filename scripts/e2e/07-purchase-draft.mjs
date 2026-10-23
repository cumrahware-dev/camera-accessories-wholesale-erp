// Purchase invoice: supplier dropdown, draft save (UI + API), validation messages, persistence, posting exactly once.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { BASE, login, call, ok, suite, report } from './lib.mjs';
const U = Date.now().toString(36).toUpperCase();
const admin = await login('admin'), erp = await login('erp'), mgr = await login('manager'), depot = await login('depotUser');
const stockOf = async (pid) => { const r = await call(admin, 'GET', `/api/products/${pid}`); return Number(r.j.totalStock); };
const prod = (await call(admin, 'POST', '/api/products', { sku: `PI-${U}`, name: `PI Test ${U}`, brand: 'T', unit: 'Pcs', sellingPrice: 30, wholesalePrice: 25, purchasePrice: 10, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;

suite('Supplier list API for purchasing roles');
for (const [n, ck] of [['admin', admin], ['manager', mgr], ['erp user', erp]]) {
  const r = await call(ck, 'GET', '/api/purchase-invoices/suppliers');
  ok(r.s === 200 && Array.isArray(r.j) && r.j.length > 0 && r.j.every((s) => s.id && s.name), `${n}: suppliers load with id + name`, `${r.s}`);
}
ok((await call(depot, 'GET', '/api/purchase-invoices/suppliers')).s === 403, 'depot user: still forbidden');
ok((await call(null, 'GET', '/api/purchase-invoices/suppliers')).s === 401, 'anonymous: 401');
const sups = (await call(erp, 'GET', '/api/purchase-invoices/suppliers')).j;
const dep = (await call(erp, 'GET', '/api/depots')).j[0];

const dl = await call(erp, 'GET', '/api/purchase-invoices/depots'); ok(dl.s === 200 && dl.j.length > 0 && dl.j[0].name, 'depot list for purchasing', String(dl.s));
suite('Browser: dropdown shows names, draft saves, survives refresh');
const ck = erp.split('='); const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addCookies([{ name: ck[0], value: ck[1], url: BASE }]);
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(BASE + '/purchases/new', { waitUntil: 'load' }); await p.waitForTimeout(2000);
const opts = await p.locator('#supplier').locator('option').allInnerTexts();
ok(sups.every((s) => opts.includes(s.name)), 'every supplier name is an option', opts.join('|'));
await p.locator('#supplier').selectOption({ label: sups[0].name });
const invNo = `UI-${U}`;
await p.locator('#pi-number').fill(invNo);
await p.getByPlaceholder(/Add a product/).fill(`PI-${U}`); await p.waitForTimeout(1200);
await p.getByRole('button', { name: new RegExp(`PI Test ${U}`) }).first().click();
await p.getByLabel(/Quantity of/).first().fill('4');
await p.getByLabel('Unit cost').first().fill('10');
await p.getByRole('button', { name: /Save/i }).last().click(); await p.waitForTimeout(2500);
ok(/\/purchases\/c/.test(p.url()), 'saved and opened the invoice', p.url());
const id = p.url().split('/').pop();
ok((await stockOf(prod.id)) === 0, 'draft did not touch stock');
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1500);
ok((await p.locator('body').innerText()).includes(invNo), 'after refresh the draft shows the saved invoice number');
const inv = (await call(erp, 'GET', `/api/purchase-invoices/${id}`)).j;
ok(inv.status === 'DRAFT' && inv.items.length === 1 && Number(inv.items[0].quantity) === 4, 'persisted as DRAFT with the line');
ok(errs.length === 0, 'no page errors', errs.join(';'));

suite('Validation gives specific messages');
const base = { supplierId: sups[0].id, supplierInvoiceNumber: `V-${U}`, invoiceDate: '2026-10-01', depotId: dep.id, currency: 'USD', items: [{ productId: prod.id, quantity: 1, unitCost: 10, taxRate: 5 }] };
for (const [name, patch, re] of [['no supplier', { supplierId: '' }, /supplier/i], ['no number', { supplierInvoiceNumber: ' ' }, /invoice number/i], ['no depot', { depotId: '' }, /depot/i], ['bad date', { invoiceDate: 'x' }, /date/i], ['no items', { items: [] }, /item/i], ['neg cost', { items: [{ ...base.items[0], unitCost: -1 }] }, /unit cost/i], ['bad qty', { items: [{ ...base.items[0], quantity: 0 }] }, /quantity/i]]) {
  const r = await call(erp, 'POST', '/api/purchase-invoices', { ...base, ...patch });
  ok(r.s === 400 && re.test(r.j.error || '') && !/went wrong/i.test(r.j.error), `${name}: 400 "${r.j.error}"`);
}
const mal = await fetch(BASE + '/api/purchase-invoices', { method: 'POST', headers: { cookie: erp, 'content-type': 'application/json' }, body: '{bad' });
ok(mal.status === 400, 'malformed JSON -> 400', String(mal.status));

suite('Duplicate submission and posting exactly once');
const [r1, r2] = await Promise.all([call(erp, 'POST', '/api/purchase-invoices', base), call(erp, 'POST', '/api/purchase-invoices', base)]);
ok([r1.s, r2.s].sort().join() === '201,409', 'two simultaneous identical submits: one 201, one 409', `${r1.s},${r2.s}`);
const draftId = (r1.s === 201 ? r1 : r2).j.id;
ok((await stockOf(prod.id)) === 0, 'drafts left stock at 0');
ok((await call(erp, 'POST', `/api/purchase-invoices/${draftId}/post`, {})).s === 403, 'ERP user cannot post (manager-only)');
const posts = await Promise.all([call(mgr, 'POST', `/api/purchase-invoices/${draftId}/post`, {}), call(mgr, 'POST', `/api/purchase-invoices/${draftId}/post`, {}), call(mgr, 'POST', `/api/purchase-invoices/${draftId}/post`, {})]);
ok(posts.filter((x) => x.s === 200).length === 1, 'three simultaneous posts: exactly one succeeds', posts.map((x) => x.s).join());
ok((await stockOf(prod.id)) === 1, 'stock increased exactly once (1)', String(await stockOf(prod.id)));
const put = await call(mgr, 'PUT', `/api/purchase-invoices/${draftId}`, base);
ok(put.s === 409 || put.s === 400, 'posted invoice cannot be edited', String(put.s));
ok((await call(mgr, 'POST', `/api/purchase-invoices/${draftId}/post`, {})).s !== 200 && (await stockOf(prod.id)) === 1, 're-post refused, stock unchanged');
await b.close();
report();
