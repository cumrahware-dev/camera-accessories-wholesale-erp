// Verification of the "5 invoices done and shipped ... why does this show as Pending?" report, end to end.
//
// The five original invoice numbers are not recorded in the repository and this suite has no connection to production,
// so it uses CONTROLLED records on the isolated test database (never genuine invoices): five shipped invoices with a mix of
// payment states, plus one order for every other condition in the business table. For each invoice it prints a verification
// row: payment status, shipment status, how the dashboard classifies it, what it should be, pass/fail.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { BASE, login, call, ok, suite, report } from './lib.mjs';

const U = Date.now().toString(36).toUpperCase();
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', 'arib_e2e', '-At', '-F', '|', '-c', q], { env: { ...process.env, PGPASSWORD: 'pg' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const admin = await login('admin'), mgr = await login('manager'), erp = await login('erp'), dB = await login('depotB'), dU = await login('depotUser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the dashboard answer is cached for 30 s; checks that follow a data change wait it out instead of reaching around it
const overview = async (wait = true) => { if (wait) await sleep(31000); return (await call(admin, 'GET', '/api/dashboard/overview?range=all')).j.totals; };
const sqlPending = () => Number(psql(`select count(*) from "TaxInvoice" i where i."documentStatus" not in ('DRAFT','CANCELLED') and i."fulfilmentStatus" not in ('DRAFT','SHIPPED','DELIVERED','CANCELLED') and not exists (select 1 from "Shipment" s where s."invoiceId"=i.id)`));
const sqlTransit = () => Number(psql(`select count(*) from "Shipment" s join "TaxInvoice" i on i.id=s."invoiceId" where s.status in ('DISPATCHED','IN_TRANSIT','OUT_FOR_DELIVERY') and i."documentStatus"<>'CANCELLED' and i."fulfilmentStatus"<>'CANCELLED'`));

const cust = (await call(admin, 'POST', '/api/customers', { companyName: `Tanweer Bhaii Dubai ${U}`, contactPerson: 'Tanweer', email: `tanweer${U}@x.test`.toLowerCase(), phone: '+971500000003', billingAddress: 'Dubai', shippingAddress: 'Dubai' })).j;
const prod = (await call(admin, 'POST', '/api/products', { sku: `SHIPV-${U}`, name: 'Verification item', brand: 'Canon', unit: 'Pcs', sellingPrice: 10, wholesalePrice: 9, purchasePrice: 5, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;
await call(admin, 'POST', '/api/inventory/adjust', { productId: prod.id, depotId: 'dep-central', deltaQty: 500, reason: 'FOUND' });

let seq = 0;
const create = async (qty = 2) => (await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', items: [{ productId: prod.id, quantity: qty, unitPrice: 10 }] })).j.id;
const issue = async (qty = 2) => { const id = await create(qty); await call(admin, 'POST', `/api/invoices/${id}/issue`, {}); return id; };
const pack = async (id) => { await call(admin, 'POST', `/api/invoices/${id}/pick`, {}); await call(admin, 'POST', `/api/invoices/${id}/pack`, { packedBy: 'E2E', packageCount: 1, totalWeightKg: 2 }); };
const ship = async (id) => call(admin, 'POST', `/api/invoices/${id}/ship`, { courier: 'EMIRATES_SKYCARGO', airwayBillNumber: `176 ${U}${++seq}` });
const pay = (id, status) => call(admin, 'PUT', `/api/invoices/${id}`, { paymentStatus: status });
const num = (id) => psql(`select "invoiceNumber" from "TaxInvoice" where id='${id}'`);
const rows = []; // the verification report

suite('Baseline');
const p0 = sqlPending(), t0 = sqlTransit();
const b0 = await overview(false);
ok(b0.pendingShipments === p0 && b0.shipmentsInTransit === t0, `dashboard baseline equals the database (pending ${p0}, in transit ${t0})`, `${b0.pendingShipments}/${b0.shipmentsInTransit} vs ${p0}/${t0}`);

suite('Build the controlled records');
const sc = {}; // scenario -> { id, qty, expect, pay, shipment }
// the five "done and shipped" invoices: a mix of payment states, all shipped and not yet confirmed delivered
for (const [i, payment] of [['1', 'UNPAID'], ['2', 'UNPAID'], ['3', 'UNPAID'], ['4', 'PAID'], ['5', 'PARTIALLY_PAID']]) {
  const id = await issue(); await pack(id); const r = await ship(id); if (payment !== 'UNPAID') await pay(id, payment);
  ok(r.s === 200, `five #${i}: shipped (${payment})`, r.j.error);
  sc[`five-${i}`] = { id, qty: 2, expect: 'IN_TRANSIT', shipment: 'DISPATCHED' };
}
// every other condition in the business table
sc['paid-unshipped'] = { id: await issue(3), qty: 3, expect: 'PENDING_SHIPMENT' }; await pay(sc['paid-unshipped'].id, 'PAID');
sc['unpaid-unshipped'] = { id: await issue(), qty: 2, expect: 'PENDING_SHIPMENT' };
sc['packed-not-shipped'] = { id: await issue(), qty: 2, expect: 'PENDING_SHIPMENT' }; await pack(sc['packed-not-shipped'].id);
sc['paid-shipped-delivered'] = { id: await issue(), qty: 2, expect: 'DELIVERED', shipment: 'DELIVERED' }; await pack(sc['paid-shipped-delivered'].id); await ship(sc['paid-shipped-delivered'].id); await pay(sc['paid-shipped-delivered'].id, 'PAID');
sc['unpaid-shipped-delivered'] = { id: await issue(), qty: 2, expect: 'DELIVERED', shipment: 'DELIVERED' }; await pack(sc['unpaid-shipped-delivered'].id); await ship(sc['unpaid-shipped-delivered'].id);
sc['cancelled'] = { id: await issue(), qty: 2, expect: 'CANCELLED' };
sc['draft'] = { id: await create(), qty: 2, expect: 'DRAFT' };
let r = await call(admin, 'PUT', `/api/invoices/${sc['cancelled'].id}`, { fulfilmentStatus: 'CANCELLED' });
ok(r.s === 200, 'an unshipped order is cancelled', `${r.s} ${r.j.error || ''}`);
for (const k of ['paid-shipped-delivered', 'unpaid-shipped-delivered']) {
  const sid = psql(`select id from "Shipment" where "invoiceId"='${sc[k].id}'`);
  r = await call(admin, 'PATCH', '/api/shipments', { id: sid, status: 'DELIVERED' });
  ok(r.s === 200, `${k}: delivery confirmed`, `${r.s} ${r.j.error || ''}`);
}
// payment states recorded for the report, and kept to prove nothing later changes them
const payNow = () => Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, psql(`select "paymentStatus" from "TaxInvoice" where id='${v.id}'`)]));
const pay0 = payNow();
const ids = Object.values(sc).map((v) => v.id);
const inList = ids.map((x) => `'${x}'`).join(',');

suite('Every order is classified as the business table says');
const nums = Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, num(v.id)]));
const cls = (await call(admin, 'GET', `/api/shipments/status-check?numbers=${Object.values(nums).join(',')}`)).j.classifications;
const clsOf = (k) => cls.find((c) => c.invoiceNumber === nums[k]);
for (const [k, v] of Object.entries(sc)) {
  const c = clsOf(k);
  ok(c && c.state === v.expect, `${k}: ${nums[k]} is ${v.expect}`, JSON.stringify(c));
}
ok(clsOf('five-4').paymentStatus === 'PAID' && clsOf('five-4').state === 'IN_TRANSIT', 'PAID and shipped: not pending shipment');
ok(clsOf('five-1').paymentStatus === 'UNPAID' && clsOf('five-1').state === 'IN_TRANSIT' && clsOf('five-1').countedAs === 'In transit', 'UNPAID and shipped: payment pending, NOT shipment pending');
ok(clsOf('paid-unshipped').paymentStatus === 'PAID' && clsOf('paid-unshipped').state === 'PENDING_SHIPMENT', 'PAID but not shipped: shipment pending');
ok(clsOf('five-1').state !== 'DELIVERED' && psql(`select "fulfilmentStatus" from "TaxInvoice" where id='${sc['five-1'].id}'`) === 'SHIPPED', 'shipped but delivery not confirmed: Shipped / in transit, never silently Delivered');
ok(clsOf('cancelled').countedAs.startsWith('not counted'), 'CANCELLED: excluded from the active counts');
ok(clsOf('unpaid-shipped-delivered').state === 'DELIVERED' && clsOf('unpaid-shipped-delivered').paymentStatus === 'UNPAID', 'delivered but unpaid: Delivered (the payment is a separate matter)');

suite('The dashboard agrees (after the cache period) and repeated reads do not change it');
const nPending = Object.values(sc).filter((v) => v.expect === 'PENDING_SHIPMENT').length, nTransit = Object.values(sc).filter((v) => v.expect === 'IN_TRANSIT').length;
const d1 = await overview();
ok(d1.pendingShipments === sqlPending() && d1.pendingShipments === p0 + nPending, `Pending Shipments = ${d1.pendingShipments} (baseline ${p0} + ${nPending} unshipped orders); none of the five is in it`, `${d1.pendingShipments} vs ${sqlPending()}`);
ok(d1.shipmentsInTransit === sqlTransit() && d1.shipmentsInTransit === t0 + nTransit, `In transit = ${d1.shipmentsInTransit} (baseline ${t0} + the five)`, `${d1.shipmentsInTransit} vs ${sqlTransit()}`);
const chk = (await call(admin, 'GET', `/api/shipments/status-check?q=${encodeURIComponent('Tanweer Bhaii Dubai ' + U)}`)).j;
const five = ['five-1', 'five-2', 'five-3', 'five-4', 'five-5'].map((k) => nums[k]);
ok(five.every((n) => chk.inTransit.some((s) => s.invoiceNumber === n)) && !five.some((n) => chk.pending.some((p) => p.invoiceNumber === n)), 'the status check lists all five as in transit and none as pending');
ok(chk.counts.pending === d1.pendingShipments - p0 && chk.counts.inTransit === d1.shipmentsInTransit - t0, 'filtered by the customer, the status check and the dashboard add up');
const d2 = await overview(false), d3 = await overview(false);
ok(JSON.stringify([d1.pendingShipments, d1.shipmentsInTransit]) === JSON.stringify([d2.pendingShipments, d2.shipmentsInTransit]) && JSON.stringify(d2) === JSON.stringify(d3), 'refreshing the dashboard returns the same numbers');

suite('Invoice list and shipment list agree with the records');
const invList = (await call(admin, 'GET', '/api/invoices?limit=500')).j; const invById = new Map(invList.map((i) => [i.id, i]));
const shList = (await call(admin, 'GET', `/api/shipments?q=${encodeURIComponent('Tanweer Bhaii Dubai ' + U)}`)).j; const shByInv = new Map((Array.isArray(shList) ? shList : shList.shipments || []).map((s) => [s.invoiceId, s]));
for (const [k, v] of Object.entries(sc)) {
  const dbF = psql(`select "fulfilmentStatus" from "TaxInvoice" where id='${v.id}'`), dbS = psql(`select status from "Shipment" where "invoiceId"='${v.id}'`) || null;
  const row = invById.get(v.id);
  ok(row && row.fulfilmentStatus === dbF && row.paymentStatus === pay0[k], `${k}: invoice list shows ${dbF} / ${pay0[k]}`, JSON.stringify([row?.fulfilmentStatus, row?.paymentStatus, dbF]));
  ok((shByInv.get(v.id)?.status ?? null) === dbS && (dbS === (v.shipment || null)), `${k}: shipment list shows ${dbS ?? 'no shipment'}`, `${shByInv.get(v.id)?.status} vs ${dbS} vs ${v.shipment}`);
  // verification row
  const c = clsOf(k);
  rows.push({ invoice: nums[k], scenario: k, payment: pay0[k], shipment: dbS ?? '-', fulfilment: dbF, dashboard: c.countedAs, classification: c.state, expected: v.expect, pass: c.state === v.expect });
}
ok(['five-1', 'five-2', 'five-3', 'five-4', 'five-5'].every((k) => invById.get(sc[k].id).fulfilmentStatus === 'SHIPPED'), 'the five show as Shipped in the invoice list');

suite('No duplicate shipments, no stray stock movements; payment untouched');
ok(psql(`select count(*) from (select "invoiceId" from "Shipment" where "invoiceId" in (${inList}) group by 1 having count(*) > 1) d`) === '0', 'at most one shipment per invoice');
const shipped = Object.entries(sc).filter(([, v]) => v.shipment);
for (const [k, v] of shipped) {
  const m = psql(`select count(*)||'|'||coalesce(sum(quantity),0)::numeric(18,0) from "StockTransaction" where type='SALE_DISPATCH' and "referenceNumber"='${nums[k]}'`);
  ok(m === `1|${v.qty}`, `${k}: exactly one dispatch movement of ${v.qty}`, m);
}
for (const k of ['paid-unshipped', 'unpaid-unshipped', 'packed-not-shipped', 'cancelled', 'draft']) {
  ok(psql(`select count(*) from "StockTransaction" where "referenceNumber"='${nums[k]}' and type='SALE_DISPATCH'`) === '0', `${k}: no dispatch movement`);
}
// a repeated / concurrent ship on an already shipped order creates nothing
const reship = await Promise.all([1, 2, 3].map(() => ship(sc['five-1'].id)));
ok(reship.every((x) => x.s === 409) && psql(`select count(*) from "Shipment" where "invoiceId"='${sc['five-1'].id}'`) === '1' && psql(`select count(*) from "StockTransaction" where type='SALE_DISPATCH' and "referenceNumber"='${nums['five-1']}'`) === '1', 'shipping an already shipped order again is refused and creates no second shipment or movement', reship.map((x) => x.s).join(','));
ok(JSON.stringify(payNow()) === JSON.stringify(pay0), 'no payment status changed anywhere in these steps');

suite('Marking delivered moves the shipment AND the invoice together; moving back reverses it');
const s1 = psql(`select id from "Shipment" where "invoiceId"='${sc['five-1'].id}'`);
r = await call(admin, 'PATCH', '/api/shipments', { id: s1, status: 'DELIVERED' });
ok(r.s === 200 && psql(`select "fulfilmentStatus" from "TaxInvoice" where id='${sc['five-1'].id}'`) === 'DELIVERED' && psql(`select status from "Shipment" where id='${s1}'`) === 'DELIVERED', 'confirming delivery sets both to Delivered', `${r.s} ${r.j.error || ''}`);
ok(psql(`select count(*) from "AuditLog" where action='SHIPMENT_UPDATED' and "entityId"='${s1}' and description like '%invoice status SHIPPED -> DELIVERED%'`) === '1', 'the Shipments-page route now audits it, including the invoice change (it did not before)');
r = await call(admin, 'PATCH', '/api/shipments', { id: s1, status: 'IN_TRANSIT' });
ok(r.s === 200 && psql(`select "fulfilmentStatus" from "TaxInvoice" where id='${sc['five-1'].id}'`) === 'SHIPPED', 'moving the shipment back to in transit returns the invoice to Shipped (it used to stay Delivered)', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'PATCH', '/api/shipments', { id: s1, status: 'DELIVERED' });
ok(r.s === 200 && psql(`select count(*) from "Shipment" where "invoiceId"='${sc['five-1'].id}'`) === '1', 'delivered again; still one shipment');
r = await call(admin, 'PATCH', '/api/shipments', { id: s1, status: 'LOST_IN_SPACE' }); ok(r.s === 400, 'an invalid status is refused (the Shipments-page route accepted any text)', String(r.s));
r = await call(dB, 'PATCH', '/api/shipments', { id: s1, status: 'IN_TRANSIT' }); ok(r.s === 403, "another depot's login cannot change this depot's shipment (the Shipments-page route had no depot check)", String(r.s));
r = await call(erp, 'PATCH', '/api/shipments', { id: s1, status: 'IN_TRANSIT' }); ok(r.s === 403, 'a read-only shipments user cannot', String(r.s));
ok((await call(null, 'PATCH', '/api/shipments', { id: s1, status: 'IN_TRANSIT' })).s === 401, 'anonymous cannot');
ok(psql(`select "fulfilmentStatus" from "TaxInvoice" where id='${sc['five-1'].id}'`) === 'DELIVERED', 'none of those refused requests changed anything');
sc['five-1'] = { ...sc['five-1'], expect: 'DELIVERED', shipment: 'DELIVERED' }; rows.find((x) => x.scenario === 'five-1').note = 'later confirmed delivered';

suite('A status that lags behind its shipment record is found and fixed - without guessing');
const lagA = sc['five-2'].id, lagB = sc['five-3'].id, lagC = sc['five-4'].id;
psql(`update "Shipment" set status='DELIVERED', "deliveredAt"=now() where "invoiceId"='${lagA}'`);       // delivered shipment, invoice still Shipped
psql(`update "TaxInvoice" set "fulfilmentStatus"='DELIVERED' where id='${lagC}'`);                        // invoice says delivered, shipment still open
const money0 = psql(`select string_agg("invoiceNumber"||':'||"grandTotal"||':'||"paymentStatus", ',' order by "invoiceNumber") from "TaxInvoice" where id in (${inList})`);
const mv0 = psql(`select count(*) from "StockTransaction" where "referenceNumber" in (${Object.values(nums).map((x) => `'${x}'`).join(',')})`), sh0 = psql(`select count(*) from "Shipment" where "invoiceId" in (${inList})`);
let c2 = (await call(admin, 'GET', `/api/shipments/status-check?q=${encodeURIComponent('Tanweer Bhaii Dubai ' + U)}`)).j;
ok(c2.statusBehindShipment.some((x) => x.invoiceNumber === nums['five-2'] && x.fulfilmentStatus === 'SHIPPED' && x.shipmentStatus === 'DELIVERED'), 'shipment Delivered / invoice Shipped is listed as behind');
ok(c2.deliveredButShipmentOpen.some((x) => x.invoiceNumber === nums['five-4']), 'invoice Delivered / shipment still open is REPORTED, not guessed at');
r = await call(mgr, 'POST', '/api/shipments/status-check', { confirm: true });
ok(r.s === 200 && r.j.fixed.some((f) => f.invoiceNumber === nums['five-2'] && f.from === 'SHIPPED' && f.to === 'DELIVERED'), 'the confirmed sync brings it to Delivered', JSON.stringify(r.j).slice(0, 200));
ok(psql(`select "fulfilmentStatus" from "TaxInvoice" where id='${lagB}'`) === 'SHIPPED', 'an invoice whose shipment is only in transit is NOT made Delivered');
ok(psql(`select "fulfilmentStatus" from "TaxInvoice" where id='${lagC}'`) === 'DELIVERED' && psql(`select status from "Shipment" where "invoiceId"='${lagC}'`) === 'DISPATCHED', 'and the reported-only mismatch was left exactly as it was');
ok(psql(`select string_agg("invoiceNumber"||':'||"grandTotal"||':'||"paymentStatus", ',' order by "invoiceNumber") from "TaxInvoice" where id in (${inList})`) === money0, 'no amount or payment status changed');
ok(psql(`select count(*) from "StockTransaction" where "referenceNumber" in (${Object.values(nums).map((x) => `'${x}'`).join(',')})`) === mv0 && psql(`select count(*) from "Shipment" where "invoiceId" in (${inList})`) === sh0, 'no stock movement and no shipment was created');
r = await call(mgr, 'POST', '/api/shipments/status-check', { confirm: true }); ok(r.s === 200 && r.j.fixed.length === 0, 'running it again changes nothing');
// put the deliberately inconsistent test row back so later checks describe real states
psql(`update "TaxInvoice" set "fulfilmentStatus"='SHIPPED' where id='${lagC}'`);

suite('After the changes, the dashboard and a page reload still say the same');
const d4 = await overview();
ok(d4.pendingShipments === sqlPending() && d4.shipmentsInTransit === sqlTransit(), `dashboard: pending ${d4.pendingShipments}, in transit ${d4.shipmentsInTransit} (equal to the database)`, `${d4.pendingShipments}/${d4.shipmentsInTransit} vs ${sqlPending()}/${sqlTransit()}`);
ok(d4.pendingShipments === d1.pendingShipments, 'delivering orders did not change the pending count');
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1500, height: 1300 } });
const [cn, cv] = admin.split('='); await ctx.addCookies([{ name: cn, value: cv, url: BASE }]);
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
const cardNow = async () => Number(((await pg.locator('body').innerText()).replace(/\s+/g, ' ').match(/Pending Shipments\s*(\d+)/) || [])[1]);
await pg.goto(`${BASE}/dashboard`, { waitUntil: 'load' }); await pg.waitForTimeout(5000);
const shown1 = await cardNow();
ok(shown1 === sqlPending(), `the dashboard card shows ${shown1}, the number of orders not yet shipped`);
await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(4000);
ok((await cardNow()) === shown1, 'and the same after a browser refresh');
ok(/shipped, in transit/.test(await pg.locator('body').innerText()), 'with the shipped orders explained as in transit');
// the invoice list page: a shipped, UNPAID invoice reads Shipped + Unpaid - the word Pending appears nowhere on its row
await pg.goto(`${BASE}/invoices`, { waitUntil: 'load' }); await pg.waitForTimeout(4000);
const rowTxt = (await pg.locator('tr', { hasText: nums['five-3'] }).first().innerText()).replace(/\s+/g, ' ');
ok(/Shipped/i.test(rowTxt) && /Unpaid/i.test(rowTxt) && !/Pending/i.test(rowTxt), `invoice list row for the unpaid shipped invoice: "${rowTxt.slice(0, 90)}"`, rowTxt);
const rowPaid = (await pg.locator('tr', { hasText: nums['paid-unshipped'] }).first().innerText()).replace(/\s+/g, ' ');
ok(/Paid/i.test(rowPaid) && /Ready for Packing/i.test(rowPaid), 'a paid but unshipped invoice reads Paid + Ready for Packing', rowPaid.slice(0, 120));
ok(errs.length === 0, 'no page errors', errs.join(' | '));
await b.close();

// ── the verification report ────────────────────────────────────────────────────────────────────────────────
console.log('\n=== SHIPMENT VERIFICATION REPORT (controlled records, isolated database) ===');
console.log('Invoice            | Scenario                  | Payment        | Shipment   | Dashboard classification      | Expected           | Result');
for (const x of rows) console.log(`${x.invoice.padEnd(18)} | ${x.scenario.padEnd(25)} | ${x.payment.padEnd(14)} | ${String(x.shipment).padEnd(10)} | ${x.dashboard.padEnd(29)} | ${x.expected.padEnd(18)} | ${x.pass ? 'PASS' : 'FAIL'}${x.note ? ` (${x.note})` : ''}`);
fs.writeFileSync((process.env.E2E_OUT || '/tmp/res-18.json').replace(/\.json$/, '-report.json'), JSON.stringify(rows, null, 2));
ok(rows.every((x) => x.pass), `verification report: ${rows.filter((x) => x.pass).length}/${rows.length} rows pass`);

report(process.env.E2E_OUT);
