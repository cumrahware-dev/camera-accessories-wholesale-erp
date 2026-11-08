// Shipped invoices must not count as "Pending", and inventory value is kept per currency (AED GI sheets, USD cameras),
// never one mixed sum. Checks the API figures against independent SQL and the dashboard in a real browser.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import { BASE, login, call, ok, near, suite, report } from './lib.mjs';

const U = Date.now().toString(36).toUpperCase();
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', 'arib_e2e', '-At', '-F', '|', '-c', q], { env: { ...process.env, PGPASSWORD: 'pg' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const admin = await login('admin'), mgr = await login('manager'), erp = await login('erp'), dU = await login('depotUser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the dashboard answer is cached for 30 s; tests that change data wait it out instead of reaching around it
const overview = async (wait = true) => { if (wait) await sleep(31000); return (await call(admin, 'GET', '/api/dashboard/overview?range=all')).j; };

// independent count of orders whose goods have not left the depot
const sqlPending = () => Number(psql(`select count(*) from "TaxInvoice" i where i."documentStatus" not in ('DRAFT','CANCELLED') and i."fulfilmentStatus" not in ('DRAFT','SHIPPED','DELIVERED','CANCELLED') and not exists (select 1 from "Shipment" s where s."invoiceId"=i.id)`));
const sqlInTransit = () => Number(psql(`select count(*) from "Shipment" where status in ('DISPATCHED','IN_TRANSIT','OUT_FOR_DELIVERY')`));

const mk = async (sku, name, cat, extra = {}) => (await call(admin, 'POST', '/api/products', { sku, name, brand: extra.brand || 'Canon', categoryName: cat, unit: extra.unit || 'Pcs', sellingPrice: 10, wholesalePrice: 9, purchasePrice: 5, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;
const cust = (await call(admin, 'POST', '/api/customers', { companyName: `Tanweer Bhaii Dubai ${U}`, contactPerson: 'Tanweer', email: `tanweer${U}@x.test`.toLowerCase(), phone: '+971500000002', billingAddress: 'Dubai', shippingAddress: 'Dubai' })).j;
const bag = await mk(`BAG-${U}`, 'Camera Bag', 'Accessories');
await call(admin, 'POST', '/api/inventory/adjust', { productId: bag.id, depotId: 'dep-central', deltaQty: 200, reason: 'FOUND' });
const order = async () => {
  const inv = (await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', items: [{ productId: bag.id, quantity: 2, unitPrice: 10 }] })).j;
  await call(admin, 'POST', `/api/invoices/${inv.id}/issue`, {});
  return inv.id;
};
const ship = async (id, i) => {
  await call(admin, 'POST', `/api/invoices/${id}/pick`, {});
  await call(admin, 'POST', `/api/invoices/${id}/pack`, { packedBy: 'E2E', packageCount: 1, totalWeightKg: 2 });
  return call(admin, 'POST', `/api/invoices/${id}/ship`, { courier: 'EMIRATES_SKYCARGO', airwayBillNumber: `176 ${U}${i}` });
};

suite('Five invoices completed and shipped are not counted as Pending');
const five = [];
for (let i = 0; i < 5; i++) { const id = await order(); const r = await ship(id, i); ok(r.s === 200, `invoice ${i + 1} shipped`, r.j.error); five.push(id); }
const fiveNos = psql(`select string_agg("invoiceNumber", ', ' order by "invoiceNumber") from "TaxInvoice" where id in (${five.map((x) => `'${x}'`).join(',')})`);
const state = psql(`select string_agg(distinct i."fulfilmentStatus"||'/'||s.status||'/'||i."paymentStatus", ',') from "TaxInvoice" i join "Shipment" s on s."invoiceId"=i.id where i.id in (${five.map((x) => `'${x}'`).join(',')})`);
ok(state === 'SHIPPED/DISPATCHED/UNPAID', `the five (${fiveNos}) are SHIPPED, shipment DISPATCHED, payment UNPAID`, state);
const waiting = await order(); // issued, not shipped: this one really is pending
let o = await overview();
ok(o.totals.pendingShipments === sqlPending(), `Pending Shipments = orders whose goods have not left the depot (${o.totals.pendingShipments})`, `${o.totals.pendingShipments} vs ${sqlPending()}`);
const check = (await call(admin, 'GET', '/api/shipments/status-check')).j;
ok(!check.pending.some((p) => fiveNos.includes(p.invoiceNumber)), 'none of the five shipped invoices is in the pending list');
ok(check.pending.some((p) => p.invoiceNumber === psql(`select "invoiceNumber" from "TaxInvoice" where id='${waiting}'`)), 'the issued-but-not-shipped order is');
ok(o.totals.shipmentsInTransit === sqlInTransit() && o.totals.shipmentsInTransit >= 5, `the five are reported as shipped / in transit instead (${o.totals.shipmentsInTransit})`);
ok(check.counts.pending === o.totals.pendingShipments && check.counts.inTransit === o.totals.shipmentsInTransit, 'the status check and the dashboard give the same numbers');
// what the old card computed, for the record: shipments not yet delivered
ok(Number(psql(`select count(*) from "Shipment" where status <> 'DELIVERED'`)) >= 5, 'ROOT CAUSE reproduced: the old rule (shipments not yet delivered) counts exactly the shipped orders');

suite('Payment status is independent of shipment status');
const paidWaiting = await order();
psql(`update "TaxInvoice" set "paymentStatus"='PAID' where id='${paidWaiting}'`); // test data: a paid order not yet shipped
o = await overview();
ok(o.totals.pendingShipments === sqlPending() && (await call(admin, 'GET', '/api/shipments/status-check')).j.pending.some((p) => p.paymentStatus === 'PAID'), 'a PAID order that has not shipped is still pending shipment');
ok(psql(`select count(*) from "TaxInvoice" where id in (${five.map((x) => `'${x}'`).join(',')}) and "paymentStatus"='UNPAID'`) === '5', 'the shipped invoices stay UNPAID: shipping never changes payment');

suite('Delivery confirmation moves an order from in transit to done');
const sh0 = psql(`select id from "Shipment" where "invoiceId"='${five[0]}'`);
let r = await call(admin, 'PATCH', '/api/shipments', { id: sh0, status: 'DELIVERED' });
ok(r.s === 200, 'one shipment confirmed delivered', `${r.s} ${r.j.error || ''}`);
const beforeDel = o.totals;
o = await overview();
ok(o.totals.shipmentsInTransit === beforeDel.shipmentsInTransit - 1 && o.totals.pendingShipments === beforeDel.pendingShipments, 'in transit drops by one; pending is unaffected');

suite('An invoice whose status lags behind its shipment record');
const lag = await order(); await ship(lag, 9);
const lagNo = psql(`select "invoiceNumber" from "TaxInvoice" where id='${lag}'`);
// the situation a partly-failed legacy dispatch leaves behind: a shipment exists, the invoice still says PACKED
psql(`update "TaxInvoice" set "fulfilmentStatus"='PACKED' where id='${lag}'`);
const money0 = psql(`select "grandTotal"||'|'||"paymentStatus" from "TaxInvoice" where id='${lag}'`);
const moves0 = psql(`select count(*) from "StockTransaction" where "referenceNumber"='${lagNo}'`), ships0 = psql(`select count(*) from "Shipment" where "invoiceId"='${lag}'`);
let c2 = (await call(admin, 'GET', '/api/shipments/status-check')).j;
ok(c2.statusBehindShipment.some((x) => x.invoiceNumber === lagNo && x.fulfilmentStatus === 'PACKED' && x.shipmentStatus === 'DISPATCHED'), 'the check lists it with its invoice and shipment statuses', JSON.stringify(c2.statusBehindShipment).slice(0, 160));
ok(!c2.pending.some((x) => x.invoiceNumber === lagNo), 'it is NOT counted as pending: its shipment record proves the goods left');
r = await call(admin, 'POST', '/api/shipments/status-check', {}); ok(r.s === 400, 'synchronising needs explicit confirmation');
r = await call(erp, 'POST', '/api/shipments/status-check', { confirm: true }); ok(r.s === 403, 'an ERP user (read-only on shipments) cannot run it', String(r.s));
r = await call(mgr, 'POST', '/api/shipments/status-check', { confirm: true });
ok(r.s === 200 && r.j.fixed.some((f) => f.invoiceNumber === lagNo && f.from === 'PACKED' && f.to === 'SHIPPED'), 'confirmed: the status is brought up to SHIPPED', JSON.stringify(r.j).slice(0, 160));
ok(psql(`select "fulfilmentStatus" from "TaxInvoice" where id='${lag}'`) === 'SHIPPED', 'the invoice now shows Shipped');
ok(psql(`select "grandTotal"||'|'||"paymentStatus" from "TaxInvoice" where id='${lag}'`) === money0, 'amount and payment status untouched');
ok(psql(`select count(*) from "StockTransaction" where "referenceNumber"='${lagNo}'`) === moves0 && psql(`select count(*) from "Shipment" where "invoiceId"='${lag}'`) === ships0, 'no stock movement and no second shipment');
ok(Number(psql(`select count(*) from "AuditLog" where action='INVOICE_STATUS_SYNCED_FROM_SHIPMENT' and "entityLabel"='${lagNo}'`)) === 1, 'audited');
r = await call(mgr, 'POST', '/api/shipments/status-check', { confirm: true }); ok(r.s === 200 && r.j.fixed.length === 0, 'running it again changes nothing');

suite('No duplicates anywhere');
ok(psql(`select count(*) from (select "invoiceId" from "Shipment" group by 1 having count(*) > 1) d`) === '0', 'one shipment per invoice');
ok(psql(`select count(*) from (select "referenceNumber","productId" from "StockTransaction" where type='SALE_DISPATCH' group by 1,2 having count(*) > 1) d`) === '0', 'one dispatch movement per invoice line');
const list = (await call(admin, 'GET', '/api/invoices?limit=200')).j;
ok(five.every((id) => ['SHIPPED', 'DELIVERED'].includes((list.find((x) => x.id === id) || {}).fulfilmentStatus)), 'the invoice list shows the five as Shipped / Delivered');

suite('Inventory value is kept per currency: GI sheets in AED, cameras and lenses in USD');
const gi = [await mk(`GI-${U}-050`, 'GI Sheet 0.50 mm', 'GI Sheets', { brand: 'Leiden', unit: 'Mt' }), await mk(`GI-${U}-070`, 'GI Sheet 0.70 mm', 'GI Sheets', { brand: 'Leiden', unit: 'Mt' })];
const cam = await mk(`CAM-${U}`, 'Canon EOS R6 Mark III', 'Cameras');
const lens = await mk(`LENS-${U}`, 'Canon RF 24-70mm f/2.8', 'Lenses');
// the state the client describes: GI sheet costs held in AED, cameras and lenses in USD - set through the product API
// (the same call the Edit Product screen makes), not by editing the database
for (const [p, cur, cost] of [[gi[0], 'AED', 802.4], [gi[1], 'AED', 915.75], [cam, 'USD', 2499.5], [lens, 'USD', 1099.25]]) {
  const up = await call(admin, 'PUT', `/api/products/${p.id}`, { currency: cur, purchasePrice: cost });
  ok(up.s === 200, `${p.sku}: cost ${cost} ${cur} saved through the product API`, `${up.s} ${up.j.error || ''}`);
}
for (const [p, d, q] of [[gi[0], 'dep-central', '45.960'], [gi[0], 'dep-regional', '4.040'], [gi[1], 'dep-central', '60.210'], [cam, 'dep-central', 4], [lens, 'dep-regional', 3]]) {
  r = await call(admin, 'POST', '/api/inventory/adjust', { productId: p.id, depotId: d, deltaQty: q, reason: 'FOUND' });
  if (r.s !== 200) ok(false, 'stock added', r.j.error);
}
const prices0 = psql(`select string_agg(id||':'||"purchasePrice"||':'||currency, ',' order by id) from "Product"`);
const sqlBy = (where = '') => Object.fromEntries(psql(`select upper(p.currency), round(sum(di.quantity*p."purchasePrice")::numeric, 2) from "DepotInventory" di join "Product" p on p.id=di."productId" ${where} group by 1`).split('\n').filter(Boolean).map((l) => { const [c, v] = l.split('|'); return [c, Number(v)]; }));
let expected = sqlBy();
o = await overview();
const got = Object.fromEntries((o.totals.inventoryByCurrency || []).map((e) => [e.currency, e.value]));
ok(Object.keys(got).sort().join(',') === Object.keys(expected).sort().join(',') && Object.keys(got).includes('AED') && Object.keys(got).includes('USD'), `the dashboard reports AED and USD separately (${Object.keys(got).join(', ')})`, JSON.stringify(o.totals.inventoryByCurrency));
ok(Object.entries(expected).every(([c, v]) => near(got[c], v, 0.005)), 'each currency total matches the stock x cost of the products held in that currency', `${JSON.stringify(got)} vs ${JSON.stringify(expected)}`);
const giAed = Math.round((50 * 802.4 + 60.21 * 915.75) * 100) / 100;
ok(near(got.AED, giAed, 0.01), `GI sheets: AED ${giAed.toFixed(2)} - the AED amounts exactly, nothing converted`, String(got.AED));
ok(o.totals.inventoryValue === null, 'no single mixed total is reported when stock spans currencies', String(o.totals.inventoryValue));
ok(prices0 === psql(`select string_agg(id||':'||"purchasePrice"||':'||currency, ',' order by id) from "Product"`), 'no product cost or currency was changed by any of this');

suite('Correcting a product\'s currency in the app: a relabel, never a conversion');
const cc = (await mk(`CUR-${U}`, 'Currency test sheet', 'GI Sheets', { unit: 'Mt' }));
psql(`update "Product" set "purchasePrice"=802.4, "wholesalePrice"=950.25, "sellingPrice"=1000.5 where id='${cc.id}'`);
const row0 = psql(`select "purchasePrice"||'|'||"wholesalePrice"||'|'||"sellingPrice"||'|'||"totalStock" from "Product" where id='${cc.id}'`);
r = await call(admin, 'PUT', `/api/products/${cc.id}`, { currency: 'aed' });
ok(r.s === 200 && r.j.currency === 'AED', 'a lower-case code is accepted and stored upper-case', `${r.s} ${r.j.error || ''} ${r.j.currency}`);
ok(psql(`select "purchasePrice"||'|'||"wholesalePrice"||'|'||"sellingPrice"||'|'||"totalStock" from "Product" where id='${cc.id}'`) === row0, 'cost, wholesale, selling price and stock are exactly as they were: nothing converted');
ok(Number(psql(`select count(*) from "AuditLog" where action='PRODUCT_CURRENCY_CHANGED' and "entityId"='${cc.id}'`)) === 1, 'the change is audited, with before and after');
ok(/USD to AED/.test(psql(`select description from "AuditLog" where action='PRODUCT_CURRENCY_CHANGED' and "entityId"='${cc.id}'`)) && /not converted/.test(psql(`select description from "AuditLog" where action='PRODUCT_CURRENCY_CHANGED' and "entityId"='${cc.id}'`)), 'and the audit text says USD -> AED, relabelled not converted');
r = await call(admin, 'PUT', `/api/products/${cc.id}`, { currency: 'AED', name: 'Currency test sheet (renamed)' });
ok(r.s === 200 && Number(psql(`select count(*) from "AuditLog" where action='PRODUCT_CURRENCY_CHANGED' and "entityId"='${cc.id}'`)) === 1, 'saving the same currency again records nothing new');
for (const bad of ['DOLLAR', 'US', '123', 'XX1', '']) {
  if (bad === '') continue;
  r = await call(admin, 'PUT', `/api/products/${cc.id}`, { currency: bad });
  ok(r.s === 400 && /3-letter currency/i.test(r.j.error || ''), `"${bad}" is refused`, `${r.s} ${r.j.error || ''}`);
}
ok(psql(`select currency from "Product" where id='${cc.id}'`) === 'AED', 'refused values left the currency alone');
ok((await call(dU, 'PUT', `/api/products/${cc.id}`, { currency: 'USD' })).s === 403, 'a depot login cannot change it');
r = await call(admin, 'POST', '/api/products', { sku: `NEW-AED-${U}`, name: 'New AED product', brand: 'Leiden', categoryName: 'GI Sheets', unit: 'Mt', currency: 'AED', sellingPrice: 10, wholesalePrice: 9, purchasePrice: 5, trackSerial: false, useDefaultTax: false, taxRate: 5 });
ok((r.s === 201 || r.s === 200) && r.j.product.currency === 'AED', 'a new product can be created in AED straight away', `${r.s} ${r.j.error || ''} ${r.j.product?.currency}`);
r = await call(admin, 'POST', '/api/products', { sku: `NEW-BAD-${U}`, name: 'Bad currency', brand: 'X', unit: 'Pcs', currency: 'NOPE', sellingPrice: 1, wholesalePrice: 1, purchasePrice: 1, trackSerial: false, useDefaultTax: false, taxRate: 5 });
ok(r.s === 400, 'an invalid currency on a new product is refused, not silently replaced by USD', `${r.s} ${r.j.error || ''}`);

suite('A purchase never blends AED-costed stock with another currency');
// stock already held and costed in AED; the company (and so this invoice's posting currency) is USD
await call(admin, 'POST', '/api/inventory/adjust', { productId: cc.id, depotId: 'dep-central', deltaQty: '10', reason: 'FOUND' });
const sup = (await call(admin, 'POST', '/api/suppliers', { name: `Leiden Supplier ${U}`, email: `ls${U}@x.test`.toLowerCase() })).j; const supId = (sup.supplier || sup).id;
const draftPI = async (pid, n) => (await call(erp, 'POST', '/api/purchase-invoices', { supplierId: supId, supplierInvoiceNumber: `CUR-${U}-${n}`, invoiceDate: '2026-11-01', depotId: 'dep-central', currency: 'USD', items: [{ productId: pid, quantity: 5, unitCost: 100, taxRate: 5 }] })).j;
const pi = await draftPI(cc.id, 1);
const chk = (await call(mgr, 'GET', `/api/purchase-invoices/${pi.id}/post-check`)).j;
ok(chk.ready === false && chk.problems.some((p) => /costed in AED/.test(p) && /mix two currencies/.test(p)), 'the readiness check says why, before anyone clicks Post', JSON.stringify(chk.problems).slice(0, 200));
const before = psql(`select "purchasePrice"||'|'||currency||'|'||"totalStock" from "Product" where id='${cc.id}'`);
r = await call(mgr, 'POST', `/api/purchase-invoices/${pi.id}/post`, {});
ok(r.s === 409 && /mix two currencies/.test(r.j.error || ''), 'posting is refused with the same explanation', `${r.s} ${(r.j.error || '').slice(0, 100)}`);
ok(psql(`select "purchasePrice"||'|'||currency||'|'||"totalStock" from "Product" where id='${cc.id}'`) === before && psql(`select count(*) from "StockTransaction" where "referenceNumber" like 'PB-%' and "productId"='${cc.id}'`) === '0', 'cost, currency and stock are untouched, and no movement was written');
// a product with NO stock has nothing to blend: the invoice posts and the cost restarts in the posting currency
const empty = await mk(`EMPTY-${U}`, 'AED label, no stock', 'GI Sheets', { unit: 'Mt' });
await call(admin, 'PUT', `/api/products/${empty.id}`, { currency: 'AED' });
const pi2 = await draftPI(empty.id, 2);
r = await call(mgr, 'POST', `/api/purchase-invoices/${pi2.id}/post`, {});
ok(r.s === 200, 'with no stock held, the purchase posts normally', `${r.s} ${r.j.error || ''}`);
ok(psql(`select "purchasePrice"||'|'||currency from "Product" where id='${empty.id}'`) === '100|USD', 'and the cost restarts in the posting currency (100 USD)');
// once the label matches the posting currency, the first product posts too
await call(admin, 'PUT', `/api/products/${cc.id}`, { currency: 'USD' });
r = await call(mgr, 'POST', `/api/purchase-invoices/${pi.id}/post`, {});
ok(r.s === 200, 'after relabelling to the real currency the original invoice posts', `${r.s} ${r.j.error || ''}`);
await call(admin, 'PUT', `/api/products/${cc.id}`, { currency: 'AED' });

suite('Depot-level values are per currency too');
// the sections above added stock and a purchase: take a fresh snapshot of both the database and the dashboard
expected = sqlBy();
o = await overview();
for (const d of o.depotPerformance) {
  const exp = sqlBy(`where di."depotId"='${d.depotId}'`);
  const g = Object.fromEntries((d.inventoryByCurrency || []).map((e) => [e.currency, e.value]));
  ok(Object.entries(exp).every(([c, v]) => near(g[c], v, 0.005)) && Object.keys(g).length === Object.keys(exp).length, `${d.name}: ${Object.entries(g).map(([c, v]) => `${c} ${v}`).join(' + ')}`, `${JSON.stringify(g)} vs ${JSON.stringify(exp)}`);
}
ok(o.depotPerformance.every((d) => (d.inventoryByCurrency.length > 1 ? d.inventoryValue === null : d.inventoryValue === (d.inventoryByCurrency[0]?.value ?? 0))), 'a depot gets a single figure only when it holds one currency');

suite('Inventory listing, stock ledger and dashboard agree');
const prods = (await call(admin, 'GET', `/api/products?ids=${[gi[0].id, gi[1].id, cam.id, lens.id].join(',')}`)).j;
ok(prods.filter((p) => [gi[0].id, gi[1].id].includes(p.id)).length === 2 && prods.filter((p) => [gi[0].id, gi[1].id].includes(p.id)).every((p) => p.currency === 'AED') && prods.filter((p) => [cam.id, lens.id].includes(p.id)).every((p) => p.currency === 'USD'), 'the product API reports AED for GI sheets and USD for the camera and lens');
const lg = (await call(admin, 'GET', `/api/inventory/ledger?productId=${gi[0].id}`)).j;
ok(lg.rows.length > 0 && lg.rows.every((x) => x.currency === 'AED'), 'GI sheet ledger rows are in AED');
const lc = (await call(admin, 'GET', `/api/inventory/ledger?productId=${cam.id}`)).j;
ok(lc.rows.length > 0 && lc.rows.every((x) => x.currency === 'USD'), 'camera ledger rows stay in USD');

suite('The pages: dashboard, inventory and stock ledger');
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1500, height: 1300 } });
const [cn, cv] = admin.split('='); await ctx.addCookies([{ name: cn, value: cv, url: BASE }]);
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
// Intl separates the code with a non-breaking space; the page text below is whitespace-normalised, so this is too
const fmt = (n, c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/\s+/g, ' ');
await pg.goto(`${BASE}/dashboard`, { waitUntil: 'load' }); await pg.waitForTimeout(5000);
const dash = (await pg.locator('body').innerText()).replace(/\s+/g, ' ');
ok(dash.includes(fmt(expected.AED, 'AED')) && dash.includes(fmt(expected.USD, 'USD')), `the Inventory Value card shows ${fmt(expected.AED, 'AED')} and ${fmt(expected.USD, 'USD')} separately`, (dash.match(/Inventory Value.{0,120}/) || [''])[0]);
const mixed = Math.round((expected.AED + expected.USD) * 100) / 100;
ok(!dash.includes(fmt(mixed, 'USD')) && !dash.includes(mixed.toLocaleString('en-US', { minimumFractionDigits: 2 })), 'the old mixed AED + USD figure is gone', fmt(mixed, 'USD'));
const card = (dash.match(/Pending Shipments\s*(\d+)/) || [])[1];
ok(Number(card) === sqlPending(), `the Pending Shipments card reads ${card} (orders not yet shipped)`, (dash.match(/Pending Shipments.{0,80}/) || [''])[0]);
ok(/shipped, in transit/.test(dash), 'and says how many are shipped / in transit');
await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(4000);
ok((await pg.locator('body').innerText()).replace(/\s+/g, ' ').includes(fmt(expected.AED, 'AED')), 'still AED after a browser refresh');
await pg.goto(`${BASE}/inventory`, { waitUntil: 'load' }); await pg.waitForTimeout(4000);
const giRow = (await pg.locator('tr', { hasText: gi[0].sku }).first().innerText()).replace(/\s+/g, ' ');
const camRow = (await pg.locator('tr', { hasText: cam.sku }).first().innerText()).replace(/\s+/g, ' ');
ok(/AED/.test(giRow) && !/\$/.test(giRow), 'inventory list: the GI sheet row is valued in AED', giRow.slice(0, 160));
ok(/\$/.test(camRow) && !/AED/.test(camRow), 'inventory list: the camera row is valued in USD', camRow.slice(0, 160));
await pg.goto(`${BASE}/inventory/ledger?productId=${gi[0].id}`, { waitUntil: 'load' }); await pg.waitForTimeout(3000);
const lt = (await pg.locator('table').first().innerText()).replace(/\s+/g, ' ');
ok(/AED/.test(lt) && !/\$\d/.test(lt), 'stock ledger: GI sheet costs shown in AED', lt.slice(0, 160));
ok(errs.length === 0, 'no page errors', errs.join(' | '));
// the Edit Product screen: the currency can be chosen, and the price labels follow it
await pg.goto(`${BASE}/products/${cam.id}`, { waitUntil: 'load' }); await pg.waitForTimeout(3000);
await pg.getByRole('button', { name: /Edit Product/ }).click(); await pg.waitForTimeout(800);
const sel = pg.locator('select').filter({ has: pg.locator('option[value="AED"]') }).first();
ok(await sel.count() === 1 && (await sel.inputValue()) === 'USD', 'Edit Product offers a price-currency choice, showing USD for the camera');
ok(/Cost Price \(USD\)/.test(await pg.locator('body').innerText()), 'the price labels say USD, not a fixed dollar sign');
await sel.selectOption('AED'); await pg.waitForTimeout(300);
ok(/Cost Price \(AED\)/.test(await pg.locator('body').innerText()) && /does not convert/i.test(await pg.locator('body').innerText()), 'choosing AED relabels the fields and explains that nothing is converted');
await pg.getByRole('button', { name: /^Save Changes$/ }).click(); await pg.waitForTimeout(2500);
ok(psql(`select currency||'|'||"purchasePrice" from "Product" where id='${cam.id}'`) === 'AED|2499.5', 'saved from the screen: AED, and the cost is still 2499.5');
await call(admin, 'PUT', `/api/products/${cam.id}`, { currency: 'USD' });
ok(errs.length === 0, 'no page errors', errs.join(' | '));
await b.close();

suite('A change of currency reaches the dashboard without manual cache edits');
r = await call(admin, 'PUT', `/api/products/${lens.id}`, { currency: 'AED' }); // a correction made in the app
o = await overview();
const after = Object.fromEntries(o.totals.inventoryByCurrency.map((e) => [e.currency, e.value]));
const exp2 = sqlBy();
ok(near(after.AED, exp2.AED, 0.005) && near(after.USD, exp2.USD, 0.005), 'after the cache period the new split is shown', `${JSON.stringify(after)} vs ${JSON.stringify(exp2)}`);
await call(admin, 'PUT', `/api/products/${lens.id}`, { currency: 'USD' });

report(process.env.E2E_OUT);
