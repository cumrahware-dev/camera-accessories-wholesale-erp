// Purchase invoice VAT / totals / inventory valuation / accounting entries, from one calculation (lib/purchasing/calc).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execSync } from 'child_process';
import { BASE, login, call, ok, near, suite, report } from './lib.mjs';
const U = Date.now().toString(36).toUpperCase();
const admin = await login('admin'), erp = await login('erp'), mgr = await login('manager');
const sql = (q) => execSync(`psql -h localhost -U postgres -d arib_e2e -At -F '|' -c ${JSON.stringify(q)}`, { env: { ...process.env, PGPASSWORD: 'pg' } }).toString().trim();
const dep = (await call(erp, 'GET', '/api/purchase-invoices/depots')).j[0];
const mkProd = async (tag, unit) => (await call(admin, 'POST', '/api/products', { sku: `V-${U}-${tag}`, name: `VAT ${tag} ${U}`, brand: 'T', unit, sellingPrice: 10, wholesalePrice: 10, purchasePrice: 0, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;
const sup = (name) => call(admin, 'POST', '/api/suppliers', { name: `${name} ${U}`, email: `${name.replace(/\W/g, '')}${U}@x.test`.toLowerCase() }).then((r) => r.j.supplier || r.j);
const supplier = await sup('Bonn Metals');
let seq = 0;
const draft = async (ck, items, extra = {}, sp = supplier) => call(ck, 'POST', '/api/purchase-invoices', { supplierId: sp.id, supplierInvoiceNumber: `VAT-${U}-${++seq}`, invoiceDate: '2026-10-01', depotId: dep.id, currency: 'USD', items, ...extra });
const journal = (id) => sql(`select l."accountCode", l.debit, l.credit from "JournalLine" l join "JournalEntry" e on e.id=l."journalEntryId" where e."sourceId"='${id}' order by l.debit desc`).split('\n').filter(Boolean).map((r) => r.split('|'));
const bal = (j) => j.reduce((s, r) => s + Number(r[1]) - Number(r[2]), 0);
const stockIn = (pid) => sql(`select count(*), coalesce(sum(quantity),0), coalesce(max("unitCost"),0) from "StockTransaction" where "productId"='${pid}' and type='STOCK_IN'`).split('|').map(Number);
const dInv = (pid) => Number(sql(`select coalesce(sum(quantity),0) from "DepotInventory" where "productId"='${pid}'`));

suite('Scenario A: VAT-exclusive 100,000 + 5%');
const pa = await mkProd('A', 'Pcs');
let r = await draft(erp, [{ productId: pa.id, quantity: 1, unitCost: 100000, taxRate: 5 }]);
ok(r.s === 201 && near(r.j.subtotal, 100000) && near(r.j.taxAmount, 5000) && near(r.j.grandTotal, 105000), 'saved: net 100,000 / VAT 5,000 / gross 105,000', JSON.stringify(r.j).slice(0, 150));
let d = (await call(erp, 'GET', `/api/purchase-invoices/${r.j.id}`)).j;
ok(near(d.financials.inventoryCost, 100000) && near(d.financials.recoverableVat, 5000) && d.financials.nonRecoverableVat === 0, 'details financials: inventory cost 100,000, recoverable VAT 5,000');
ok(dInv(pa.id) === 0 && stockIn(pa.id)[0] === 0 && journal(r.j.id).length === 0, 'draft: no stock, no journal');
let p = await call(mgr, 'POST', `/api/purchase-invoices/${r.j.id}/post`, {});
let j = journal(r.j.id);
ok(p.s === 200 && j.length === 3 && near(bal(j), 0), 'posted; journal has 3 lines and balances', JSON.stringify(j));
ok(j.some((x) => x[0] === '1300' && near(x[1], 100000)) && j.some((x) => x[0] === '1410' && near(x[1], 5000)) && j.some((x) => x[0] === '2100' && near(x[2], 105000)), 'Dr Inventory 100,000 / Dr Input VAT 5,000 / Cr Payable 105,000');
ok(dInv(pa.id) === 1 && stockIn(pa.id)[0] === 1 && near(stockIn(pa.id)[2], 100000), 'stock +1 at unit cost 100,000 (VAT not in stock cost)');
ok(near(Number(sql(`select "purchasePrice" from "Product" where id='${pa.id}'`)), 100000), 'product cost = 100,000');

suite('Scenario B: VAT-inclusive 105,000 @ 5%');
const pb = await mkProd('B', 'Pcs');
r = await draft(erp, [{ productId: pb.id, quantity: 1, unitCost: 105000, taxRate: 5 }], { pricesIncludeTax: true });
ok(r.s === 201 && near(r.j.subtotal, 100000) && near(r.j.taxAmount, 5000) && near(r.j.grandTotal, 105000), 'net 100,000 / VAT 5,000 / gross 105,000', JSON.stringify(r.j).slice(0, 150));
d = (await call(erp, 'GET', `/api/purchase-invoices/${r.j.id}`)).j;
ok(d.pricesIncludeTax === true && near(d.items[0].lineTotal, 100000) && near(d.items[0].taxAmount, 5000), 'reopened draft keeps the VAT-inclusive flag, line net and VAT');
p = await call(mgr, 'POST', `/api/purchase-invoices/${r.j.id}/post`, {}); j = journal(r.j.id);
ok(p.s === 200 && near(bal(j), 0) && j.some((x) => x[0] === '1300' && near(x[1], 100000)) && j.some((x) => x[0] === '1410' && near(x[1], 5000)) && j.some((x) => x[0] === '2100' && near(x[2], 105000)), 'journal: stock 100,000 / VAT 5,000 / payable 105,000', JSON.stringify(j));
ok(near(stockIn(pb.id)[2], 100000), 'stock unit cost 100,000 (net)');

suite('Scenario C: non-recoverable VAT');
const pc = await mkProd('C', 'Pcs');
r = await draft(erp, [{ productId: pc.id, quantity: 1, unitCost: 100000, taxRate: 5 }], { nonRecoverableVatPercent: 100 });
d = (await call(erp, 'GET', `/api/purchase-invoices/${r.j.id}`)).j;
ok(near(d.financials.inventoryCost, 105000) && near(d.financials.nonRecoverableVat, 5000) && d.financials.recoverableVat === 0, 'inventory cost 105,000; non-recoverable 5,000; recoverable 0');
p = await call(mgr, 'POST', `/api/purchase-invoices/${r.j.id}/post`, {}); j = journal(r.j.id);
ok(p.s === 200 && near(bal(j), 0) && j.length === 2 && j.some((x) => x[0] === '1300' && near(x[1], 105000)) && j.some((x) => x[0] === '2100' && near(x[2], 105000)), 'journal: Dr Inventory 105,000 / Cr Payable 105,000, no input VAT line', JSON.stringify(j));
ok(near(stockIn(pc.id)[2], 105000), 'stock unit cost 105,000');
const half = await draft(erp, [{ productId: pc.id, quantity: 2, unitCost: 100, taxRate: 5 }], { nonRecoverableVatPercent: 40 });
const hd = (await call(erp, 'GET', `/api/purchase-invoices/${half.j.id}`)).j.financials;
ok(near(hd.vat, 10) && near(hd.nonRecoverableVat, 4) && near(hd.recoverableVat, 6) && near(hd.inventoryCost, 204) && near(hd.grandTotal, 210), '40% non-recoverable: VAT 10 = 6 recoverable + 4 non-recoverable; stock 204; payable 210');
ok((await draft(erp, [{ productId: pc.id, quantity: 1, unitCost: 1, taxRate: 5 }], { nonRecoverableVatPercent: 150 })).s === 400, 'non-recoverable % above 100 is rejected');

suite('Scenario D: Bonn Metals invoice (Leiden reference: 261.640 Mt at AED 2,950.00 + 5% VAT)');
const mts = []; for (const [i, q] of [54.62, 45.65, 55.2, 60.21, 45.96].entries()) mts.push({ prod: await mkProd(`M${i}`, 'Mt'), q });
const lines = (rate) => mts.map(({ prod, q }) => ({ productId: prod.id, quantity: q, unitCost: 2950, taxRate: rate }));
// D1 - as the form defaults used to save it: line VAT 0%  -> 771,838.00 is the NET amount, VAT never entered
const d0 = await draft(erp, lines(0));
ok(near(d0.j.subtotal, 771838) && d0.j.taxAmount === 0 && near(d0.j.grandTotal, 771838), 'D1 VAT left at 0%: saved total 771,838.00 equals the NET amount (no VAT) - this is the AED 771,838.00 shown', JSON.stringify([d0.j.subtotal, d0.j.taxAmount, d0.j.grandTotal]));
// D2 - with 5% VAT
r = await draft(erp, lines(5));
ok(near(r.j.subtotal, 771838) && near(r.j.taxAmount, 38591.9) && near(r.j.grandTotal, 810429.9), 'D2 at 5%: net 771,838.00 / VAT 38,591.90 / gross 810,429.90', JSON.stringify([r.j.subtotal, r.j.taxAmount, r.j.grandTotal]));
const bid = r.j.id;
suite('Scenario D UI: form summary, reopened draft, details page and posting confirmation show the same figures');
const ck = mgr.split('='); const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } }); await ctx.addCookies([{ name: ck[0], value: ck[1], url: BASE }]);
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`${BASE}/purchases/new?id=${bid}`, { waitUntil: 'load' }); await pg.waitForTimeout(2500);
let body = await pg.locator('body').innerText();
ok(/771,838\.00/.test(body) && /38,591\.90/.test(body) && /810,429\.90/.test(body), 'reopened draft form: net, VAT and gross shown', (body.match(/[\d,]+\.\d\d/g) || []).slice(0, 12).join(' '));
ok(/Inventory cost to be booked/.test(body) && /Gross supplier invoice total/.test(body), 'form labels the payable and the inventory cost separately');
await pg.goto(`${BASE}/purchases/${bid}`, { waitUntil: 'load' }); await pg.waitForTimeout(2000);
body = await pg.locator('body').innerText();
ok(/771,838\.00/.test(body) && /38,591\.90/.test(body) && /810,429\.90/.test(body) && /VAT 5%/.test(body), 'details page: net / VAT 5% / gross');
await pg.getByRole('button', { name: /Post & receive stock/ }).click(); await pg.waitForTimeout(800);
const modal = await pg.getByRole('dialog').innerText();
ok(/261\.640/.test(modal) && /Bonn Metals/.test(modal) && /771,838\.00/.test(modal) && /VAT 5%/.test(modal) && /38,591\.90/.test(modal) && /810,429\.90/.test(modal), 'posting confirmation: quantity 261.640, supplier, net, VAT rate + amount, gross', modal.replace(/\n/g, ' ').slice(0, 400));
ok(/Recoverable VAT/.test(modal) && /Non-recoverable VAT/.test(modal) && /Inventory cost to be booked/.test(modal), 'confirmation shows recoverable / non-recoverable VAT and inventory cost');
ok(!/at the invoice costs/.test(modal), 'the gross total is not labelled as inventory cost');
await pg.getByRole('button', { name: 'Post invoice' }).click(); await pg.waitForTimeout(2500);
await b.close();
const dd = (await call(mgr, 'GET', `/api/purchase-invoices/${bid}`)).j; j = journal(bid);
ok(dd.status === 'POSTED' && near(bal(j), 0), 'posted via the UI; journal balances', JSON.stringify(j));
ok(j.some((x) => x[0] === '1300' && near(x[1], 771838)) && j.some((x) => x[0] === '1410' && near(x[1], 38591.9)) && j.some((x) => x[0] === '2100' && near(x[2], 810429.9)), 'Dr Inventory 771,838.00 / Dr Input VAT 38,591.90 / Cr Payable 810,429.90');
const qsum = mts.reduce((s, m) => s + dInv(m.prod.id), 0), cnt = mts.reduce((s, m) => s + stockIn(m.prod.id)[0], 0);
ok(near(qsum, 261.64, 0.0005) && cnt === 5, 'stock received: 261.640 Mt in 5 movements', `${qsum} ${cnt}`);
ok(mts.every((m) => near(stockIn(m.prod.id)[2], 2950, 0.0001)), 'every line stocked at AED 2,950.00 per Mt (VAT excluded)');
const again = await call(mgr, 'POST', `/api/purchase-invoices/${bid}/post`, {});
ok(again.s === 409 && mts.reduce((s, m) => s + dInv(m.prod.id), 0) === qsum && journal(bid).length === j.length, 'second post refused: no extra stock, no extra journal');
ok(errs.length === 0, 'no page errors', errs.join(';'));

suite('Discounts, freight, rounding, multiple rates, draft edit');
const pm = await mkProd('MIX', 'Mt');
r = await draft(erp, [{ productId: pm.id, quantity: 10.5, unitCost: 33.333, taxRate: 5, discountAmount: 10 }, { productId: pa.id, quantity: 3, unitCost: 19.99, taxRate: 0 }], { discountAmount: 5, freightAmount: 12.5, otherCharges: 2.5 });
let f = (await call(erp, 'GET', `/api/purchase-invoices/${r.j.id}`)).j.financials;
// line1 net = 10.5 x 33.333 - 10 = 340.0 (349.9965-10=339.9965 -> 340.00), VAT 17.00 ; line2 net 59.97
ok(near(f.subtotal, 399.97) && near(f.vat, 17) && f.vatByRate.length === 2 && near(f.grandTotal, 399.97 - 5 + 17 + 12.5 + 2.5) && near(f.inventoryCost, 399.97 - 5 + 12.5 + 2.5), 'mixed rates 5% and 0%, line + invoice discount, freight, other: totals and inventory cost', JSON.stringify(f));
const up = await call(erp, 'PUT', `/api/purchase-invoices/${r.j.id}`, { supplierId: supplier.id, supplierInvoiceNumber: r.j.supplierInvoiceNumber, invoiceDate: '2026-10-01', depotId: dep.id, currency: 'USD', nonRecoverableVatPercent: 100, discountAmount: 5, freightAmount: 12.5, otherCharges: 2.5, items: [{ productId: pm.id, quantity: 10.5, unitCost: 33.333, taxRate: 5, discountAmount: 10 }, { productId: pa.id, quantity: 3, unitCost: 19.99, taxRate: 0 }] });
f = (await call(erp, 'GET', `/api/purchase-invoices/${r.j.id}`)).j.financials;
ok(up.s === 200 && near(f.nonRecoverableVat, 17) && near(f.inventoryCost, 399.97 - 5 + 12.5 + 2.5 + 17), 'editing the draft recalculates: non-recoverable VAT joins inventory cost', JSON.stringify(f));
const bad = await call(erp, 'POST', '/api/purchase-invoices', { supplierId: supplier.id, supplierInvoiceNumber: `VAT-${U}-x`, invoiceDate: '2026-10-01', depotId: dep.id, items: [{ productId: pa.id, quantity: 1, unitCost: 10, taxRate: 101 }] });
ok(bad.s === 400 && /tax rate/i.test(bad.j.error), 'tax rate above 100 rejected with a specific message', bad.j.error);
// rounding: 3 lines of 0.10 x 33 at 5%
const rr = await draft(erp, [0, 1, 2].map(() => ({ productId: pa.id, quantity: 1, unitCost: 0.1, taxRate: 5 })));
ok(near(rr.j.subtotal, 0.3) && near(rr.j.grandTotal, rr.j.subtotal + rr.j.taxAmount), 'small-amount rounding reconciles', JSON.stringify([rr.j.subtotal, rr.j.taxAmount, rr.j.grandTotal]));
const pp = await call(mgr, 'POST', `/api/purchase-invoices/${r.j.id}/post`, {}); j = journal(r.j.id);
ok(pp.s === 200 && near(bal(j), 0) && j.length === 2, 'mixed invoice with 100% non-recoverable VAT posts and balances (no input-VAT line)', JSON.stringify(j));
report();
