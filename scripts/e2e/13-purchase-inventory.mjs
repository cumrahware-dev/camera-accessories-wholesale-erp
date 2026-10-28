// Purchase posting -> stock movements -> depot balances -> inventory valuation -> inventory screen; reconciliation + repair.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import { BASE, login, call, ok, near, suite, report } from './lib.mjs';
const U = Date.now().toString(36).toUpperCase();
const admin = await login('admin'), mgr = await login('manager'), erp = await login('erp');
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', 'arib_e2e', '-At', '-F', '|', '-c', q], { env: { ...process.env, PGPASSWORD: 'pg' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const mk = async (sku, name, unit, wholesale, trackSerial) => (await call(admin, 'POST', '/api/products', { sku, name, brand: sku.startsWith('CAN') ? 'Canon' : 'LBM', unit, sellingPrice: wholesale, wholesalePrice: wholesale, purchasePrice: 0, trackSerial, useDefaultTax: false, taxRate: 5 })).j.product;
const depots = (await call(admin, 'GET', '/api/purchase-invoices/depots')).j;
const [D1, D2] = depots;
const supRes = (await call(admin, 'POST', '/api/suppliers', { name: `Canon Distribution ${U}`, email: `canon${U}@x.test`.toLowerCase() })).j; const sup = supRes.supplier || supRes;
let n = 0;
const draft = (depot, items, extra = {}) => call(erp, 'POST', '/api/purchase-invoices', { supplierId: sup.id, supplierInvoiceNumber: `INV-${U}-${++n}`, invoiceDate: '2026-10-27', depotId: depot.id, currency: 'USD', items, ...extra });
const post = (id) => call(mgr, 'POST', `/api/purchase-invoices/${id}/post`, {});
const stock = (pid, did) => Number(psql(`select coalesce(sum(quantity),0) from "DepotInventory" where "productId"='${pid}'${did ? ` and "depotId"='${did}'` : ''}`));
const moves = (ref, pid) => psql(`select count(*)||'|'||coalesce(sum(quantity),0) from "StockTransaction" where type='STOCK_IN' and "referenceNumber"='${ref}'${pid ? ` and "productId"='${pid}'` : ''}`).split('|').map(Number);
const prod = (id) => psql(`select "purchasePrice"||'|'||"totalStock"||'|'||"wholesalePrice" from "Product" where id='${id}'`).split('|').map(Number);

suite('Setup: an older camera catalogue (more than 50 products in total)');
const oldCams = []; for (let i = 0; i < 6; i++) oldCams.push(await mk(`CAN-OLD-${U}-${i}`, `Canon EOS R${i} body`, 'Pcs', 1450 + i, true));
for (let i = 0; i < 55; i++) await mk(`FILL-${U}-${i}`, `Accessory ${i}`, 'Pcs', 10, false);
const newCams = [await mk(`CAN-NEW-${U}-1`, 'Canon R6 Mark III', 'Pcs', 2500, true), await mk(`CAN-NEW-${U}-2`, 'Canon R8', 'Pcs', 1800, true)];
const gi = []; for (const g of ['0.50', '0.70', '1.10', '1.50', '2.00']) gi.push(await mk(`GI-${U}-${g}`, `GI Sheet ${g} mm`, 'Mt', 0, false));
const total = Number((await fetch(`${BASE}/api/products?limit=1`, { headers: { cookie: admin } })).headers.get('x-total-count'));
ok(total > 50, `catalogue has ${total} products (> 50, the API page size)`);

suite('Camera invoice: 8 lines (6 older + 2 new products), serial-tracked, one depot');
const camItems = [...oldCams, ...newCams].map((p, i) => ({ productId: p.id, quantity: [10, 9, 8, 9, 8, 9, 8, 8][i], unitCost: 1000 + i * 10, taxRate: 5 }));
const camQty = camItems.reduce((s, i) => s + i.quantity, 0);
const d1 = await draft(D1, camItems); ok(d1.s === 201, 'draft saved', d1.j.error);
ok([...oldCams, ...newCams].every((p) => stock(p.id) === 0), 'draft: no stock yet');
const p1 = await post(d1.j.id); ok(p1.s === 200, 'posted', p1.j.error);
const [mvCount, mvQty] = moves(d1.j.purchaseNumber);
ok(mvCount === 8 && mvQty === camQty, `8 STOCK_IN movements for ${camQty} units`, `${mvCount} ${mvQty}`);
ok(camItems.every((it) => stock(it.productId, D1.id) === it.quantity), 'each product received exactly its quantity in the invoice depot');
ok(camItems.every((it) => near(prod(it.productId)[0], it.unitCost, 0.0001)), 'each product cost = its purchase cost (no previous stock)');
ok(camItems.every((it) => prod(it.productId)[1] === it.quantity), 'product totals updated');
ok(Number(psql(`select count(*) from "SerialNumber" where "productId" in (${camItems.map((i) => `'${i.productId}'`).join(',')})`)) === 0, 'serial-tracked: stock counts without serials (serials are registered separately, as before)');
ok((await post(d1.j.id)).s === 409 && moves(d1.j.purchaseNumber)[0] === 8, 'second post refused: no duplicate movements');
const def = (await call(admin, 'GET', '/api/products')).j;
ok(oldCams.every((p) => !def.some((x) => x.id === p.id)), 'ROOT CAUSE reproduced: the unpaged /api/products (50 newest) does not contain the 6 older cameras');

suite('GI sheets: decimal quantities, no wholesale price, two depots');
const giItems = gi.map((p, i) => ({ productId: p.id, quantity: [45.96, 60.21, 55.2, 45.65, 54.62][i], unitCost: 802.4, taxRate: 5 }));
const d2 = await draft(D2 || D1, giItems); ok((await post(d2.j.id)).s === 200, 'GI invoice posted to the second depot');
ok(giItems.every((it) => near(stock(it.productId, (D2 || D1).id), it.quantity, 0.0005)), 'decimal quantities stored exactly (45.960 / 60.210 / 55.200 / 45.650 / 54.620)');
ok(giItems.every((it) => near(prod(it.productId)[0], 802.4, 0.0001) && prod(it.productId)[2] === 0), 'cost 802.40 per Mt recorded; wholesale price is 0 (never set on these products)');
const d3 = await draft(D1, [{ productId: gi[0].id, quantity: 4.04, unitCost: 900, taxRate: 5 }]); ok((await post(d3.j.id)).s === 200, 'another lot of GI 0.50 into the first depot');
ok(near(stock(gi[0].id), 50, 0.0005) && near(prod(gi[0].id)[0], (45.96 * 802.4 + 4.04 * 900) / 50, 0.0001), 'two depots: total 50.000 Mt; moving-average cost', String(prod(gi[0].id)[0]));

suite('Foreign currency: AED invoice in a USD company needs an exchange rate');
const aed = await draft(D1, [{ productId: newCams[0].id, quantity: 2, unitCost: 3672.99, taxRate: 5 }], { currency: 'AED' });
ok(aed.s === 201 && aed.j.exchangeRate == null, 'AED draft can be saved without a rate (e.g. from a scanned invoice)');
const chk = await call(mgr, 'GET', `/api/purchase-invoices/${aed.j.id}/post-check`);
ok(chk.j.ready === false && chk.j.problems.some((p) => /exchange rate/i.test(p)), 'posting check asks for the exchange rate', JSON.stringify(chk.j.problems));
ok((await post(aed.j.id)).s === 409 && stock(newCams[0].id) === 8, 'posting refused without a rate; no stock moved');
const bad = await call(erp, 'PUT', `/api/purchase-invoices/${aed.j.id}`, { supplierId: sup.id, supplierInvoiceNumber: aed.j.supplierInvoiceNumber, invoiceDate: '2026-10-27', depotId: D1.id, currency: 'AED', exchangeRate: -1, items: [{ productId: newCams[0].id, quantity: 2, unitCost: 3672.99, taxRate: 5 }] });
ok(bad.s === 400 && /exchange rate/i.test(bad.j.error), 'a negative rate is refused', bad.j.error);
const up = await call(erp, 'PUT', `/api/purchase-invoices/${aed.j.id}`, { supplierId: sup.id, supplierInvoiceNumber: aed.j.supplierInvoiceNumber, invoiceDate: '2026-10-27', depotId: D1.id, currency: 'AED', exchangeRate: '0.272294', items: [{ productId: newCams[0].id, quantity: 2, unitCost: 3672.99, taxRate: 5 }] });
ok(up.s === 200 && near(up.j.exchangeRate, 0.272294, 1e-9), 'rate saved on the draft');
const before = prod(newCams[0].id);
ok((await post(aed.j.id)).s === 200, 'posted with the rate');
const usdUnit = Math.round(3672.99 * 0.272294 * 10000) / 10000;
const [pc] = prod(newCams[0].id);
ok(near(pc, (8 * before[0] + 2 * 3672.99 * 0.272294) / 10, 0.0001), `moving-average cost in USD: (8 x ${before[0]} + 2 x ${usdUnit}) / 10 = ${pc}`);
ok(near(Number(psql(`select "unitCost" from "StockTransaction" where "referenceNumber"='${aed.j.purchaseNumber}'`)), usdUnit, 0.0001), `stock movement unit cost in USD (${usdUnit})`);
const jl = psql(`select l."accountCode", l.debit, l.credit from "JournalLine" l join "JournalEntry" e on e.id=l."journalEntryId" where e."sourceId"='${aed.j.id}'`).split('\n').map((r) => r.split('|').map((x, i) => (i ? Number(x) : x)));
const grandAed = Number(psql(`select "grandTotal" from "PurchaseInvoice" where id='${aed.j.id}'`));
ok(near(jl.reduce((s, r) => s + r[1] - r[2], 0), 0) && jl.some((r) => r[0] === '2100' && near(r[2], Math.round(grandAed * 0.272294 * 100) / 100)), 'journal in USD and balanced (payable = AED total x rate)', JSON.stringify(jl));

suite('Invalid product mapping');
const nop = await draft(D1, [{ productId: 'does-not-exist', quantity: 1, unitCost: 1 }]); ok(nop.s === 400 && /product not found/i.test(nop.j.error), 'unknown product refused on save', nop.j.error);

suite('Inventory screen shows every product with stock and cost value');
const ck = admin.split('='); const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1200 } }); await ctx.addCookies([{ name: ck[0], value: ck[1], url: BASE }]);
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`${BASE}/inventory`, { waitUntil: 'load' }); await pg.waitForTimeout(3500);
const rowText = async (sku) => { const r = pg.locator('tr', { hasText: sku }).first(); return (await r.count()) ? (await r.innerText()).replace(/\s+/g, ' ') : ''; };
for (const p of [...oldCams, ...newCams]) { const t = await rowText(p.sku); ok(!!t, `listed: ${p.sku}`, t.slice(0, 80)); }
const t0 = await rowText(oldCams[0].sku);
ok(/10 Pcs/.test(t0) && t0.includes('$10,000.00') && t0.includes('$14,500.00'), `older camera row: 10 Pcs, cost value $10,000.00, wholesale $14,500.00`, t0);
const tg = await rowText(gi[1].sku);
ok(/60\.210 Mt/.test(tg) && tg.includes('$48,312.50') && /No wholesale price/.test(tg), 'GI row: 60.210 Mt, cost value $48,312.50 (60.21 x 802.40), "No wholesale price" instead of $0.00', tg);
await pg.getByPlaceholder(/Search SKU/).fill(`CAN-OLD-${U}-5`); await pg.waitForTimeout(500);
ok(await pg.locator('tr', { hasText: `CAN-OLD-${U}-5` }).count() === 1, 'search finds an older product');
const headerVal = await pg.getByTestId('inventory-value').innerText();
const expected = Number(psql(`select round(sum(di.quantity * p."purchasePrice")::numeric, 2) from "DepotInventory" di join "Product" p on p.id = di."productId"`));
ok(near(Number(headerVal.replace(/[^0-9.]/g, '')), expected, 0.02), `Inventory Value = sum(qty x cost) over all depots (${headerVal} vs ${expected})`);
ok(errs.length === 0, 'no page errors', errs.join(';'));

suite('Reconciliation: damaged history is found and repaired safely');
const ref = d1.j.purchaseNumber;
// simulate the reported damage on the camera invoice: two products' stock never arrived, one product total stale
const victims = [oldCams[3], oldCams[4]];
for (const v of victims) {
  const q = Number(psql(`select quantity from "StockTransaction" where type='STOCK_IN' and "referenceNumber"='${ref}' and "productId"='${v.id}'`));
  psql(`delete from "StockTransaction" where type='STOCK_IN' and "referenceNumber"='${ref}' and "productId"='${v.id}'`);
  psql(`update "DepotInventory" set quantity = quantity - ${q}, "availableQuantity" = "availableQuantity" - ${q} where "productId"='${v.id}' and "depotId"='${D1.id}'`);
}
psql(`update "Product" set "totalStock" = 0 where id='${oldCams[5].id}'`);
let rec = (await call(mgr, 'GET', `/api/purchase-invoices/reconciliation?ids=${d1.j.id}`)).j;
const ri = rec.invoices[0];
ok(ri.lines.filter((l) => l.status === 'MISSING').map((l) => l.sku).sort().join() === victims.map((v) => v.sku).sort().join(), 'report: exactly the two damaged lines are MISSING', JSON.stringify(ri.lines.map((l) => [l.sku, l.status])));
ok(ri.lines.filter((l) => l.status === 'OK').length === 6 && ri.repairable, 'other six lines OK; invoice repairable');
ok(rec.products.find((p) => p.productId === oldCams[5].id).issues.includes('TOTAL_STALE'), 'stale product total reported');
ok((await call(erp, 'GET', '/api/purchase-invoices/reconciliation')).s === 403, 'reconciliation needs the posting permission');
ok((await call(mgr, 'POST', '/api/purchase-invoices/reconciliation/repair', { invoiceId: d1.j.id })).s === 400, 'repair requires explicit confirmation');
const fin0 = psql(`select md5(row_to_json(p)::text) from (select "grandTotal",subtotal,"taxAmount",status,"journalEntryId" from "PurchaseInvoice" where id='${d1.j.id}') p`);
const rep = await call(mgr, 'POST', '/api/purchase-invoices/reconciliation/repair', { invoiceId: d1.j.id, confirm: true });
ok(rep.s === 200 && rep.j.repaired.length === 2 && rep.j.totals.length >= 1, 'repair created 2 movements and re-derived the stale total', JSON.stringify(rep.j));
ok(victims.every((v) => stock(v.id, D1.id) === camItems.find((i) => i.productId === v.id).quantity), 'depot quantities restored for the two products');
ok(prod(oldCams[5].id)[1] === camItems[5].quantity, 'stale total fixed');
ok(psql(`select md5(row_to_json(p)::text) from (select "grandTotal",subtotal,"taxAmount",status,"journalEntryId" from "PurchaseInvoice" where id='${d1.j.id}') p`) === fin0 && Number(psql(`select count(*) from "JournalEntry" where "sourceId"='${d1.j.id}'`)) === 1, 'invoice amounts and its journal untouched; no second journal');
ok(Number(psql(`select count(*) from "AuditLog" where "entityId"='${d1.j.id}' and action='PURCHASE_STOCK_RECONCILED'`)) === 1, 'repair recorded in the audit log');
ok(Number(psql(`select count(*) from "StockTransaction" where "referenceNumber"='${ref}' and notes like 'Reconciliation repair%'`)) === 2, 'repaired movements are marked as such');
const rep2 = await call(mgr, 'POST', '/api/purchase-invoices/reconciliation/repair', { invoiceId: d1.j.id, confirm: true });
ok(rep2.s === 200 && rep2.j.repaired.length === 0 && rep2.j.totals.length === 0 && moves(ref)[0] === 8, 'second repair does nothing (no duplicates)');
rec = (await call(mgr, 'GET', `/api/purchase-invoices/reconciliation?ids=${d1.j.id}`)).j;
ok(rec.invoices[0].issues.length === 0 && rec.invoices[0].lines.every((l) => l.status === 'OK'), 'report now clean');
// a quantity mismatch is reported, never auto-repaired
psql(`update "StockTransaction" set quantity = quantity + 1 where "referenceNumber"='${d2.j.purchaseNumber}' and "productId"='${gi[2].id}'`);
rec = (await call(mgr, 'GET', `/api/purchase-invoices/reconciliation?ids=${d2.j.id}`)).j;
ok(rec.invoices[0].lines.find((l) => l.productId === gi[2].id).status === 'QTY_MISMATCH' && !rec.invoices[0].repairable, 'quantity mismatch reported for manual review, not repairable automatically');
psql(`update "StockTransaction" set quantity = quantity - 1 where "referenceNumber"='${d2.j.purchaseNumber}' and "productId"='${gi[2].id}'`);
const all = (await call(mgr, 'GET', '/api/purchase-invoices/reconciliation?days=3')).j;
ok(all.invoices.length >= 4 && all.invoices.every((i) => !i.issues.some((x) => x.startsWith('LINE_'))), `last 3 days: ${all.invoices.length} posted invoices, no line issues left`);

suite('Reconciliation page');
await pg.goto(`${BASE}/purchases/reconciliation`, { waitUntil: 'load' }); await pg.waitForTimeout(2500);
const rt = (await pg.locator('body').innerText()).replace(/\s+/g, ' ');
ok(rt.includes(ref) && /Reconciled/.test(rt), 'page lists the invoices and their state');
await b.close();
report();
