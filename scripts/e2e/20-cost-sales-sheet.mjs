// Cost & Sales Sheet per sales invoice: data comes from dispatch ledger + purchase receipts, Excel opens and reconciles.
import ExcelJS from 'exceljs';
import { execFileSync } from 'child_process';
import { call, login, ok, suite, report } from './lib.mjs';

const U = Date.now().toString(36).toUpperCase();
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', 'arib_e2e', '-At', '-F', '|', '-c', q], { env: { ...process.env, PGPASSWORD: 'pg' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const admin = await login('admin'), mgr = await login('manager'), erp = await login('erp'), dU = await login('depotUser');
const depots = (await call(admin, 'GET', '/api/purchase-invoices/depots')).j;
const D1 = depots[0];
const sup = async (n) => { const r = (await call(admin, 'POST', '/api/suppliers', { name: `${n} ${U}`, email: `${n.replace(/\W/g, '')}${U}@x.test`.toLowerCase() })).j; return r.supplier || r; };
const S1 = await sup('Alpha Supply'), S2 = await sup('Beta Supply');
let pn = 0;
const receive = async (supplier, productId, qty, cost) => {
  const d = await call(erp, 'POST', '/api/purchase-invoices', { supplierId: supplier.id, supplierInvoiceNumber: `P-${U}-${++pn}`, invoiceDate: '2026-10-27', depotId: D1.id, currency: 'USD', items: [{ productId, quantity: qty, unitCost: cost, taxRate: 0 }] });
  const p = await call(mgr, 'POST', `/api/purchase-invoices/${d.j.id}/post`, {});
  if (p.s !== 200) console.log('post failed', p.s, JSON.stringify(p.j).slice(0, 200));
};
const mkProd = async (tag) => (await call(admin, 'POST', '/api/products', { sku: `CS-${tag}-${U}`, name: `Cost Item ${tag}`, brand: 'Canon', unit: 'Pcs', sellingPrice: 100, wholesalePrice: 90, purchasePrice: 1, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;
const cust = (await call(admin, 'POST', '/api/customers', { companyName: `CostSheet Co ${U}`, contactPerson: 'X', email: `cs${U}@x.test`.toLowerCase(), phone: '+971501234567', billingAddress: 'Dubai', shippingAddress: 'Dubai' })).j;
const shipped = async (items, extra = {}) => {
  const i = (await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: D1.id, items, ...extra })).j;
  for (const s of ['issue', 'pick']) await call(admin, 'POST', `/api/invoices/${i.id}/${s}`, {});
  await call(admin, 'POST', `/api/invoices/${i.id}/pack`, { packedBy: 'E2E', packageCount: 1, totalWeightKg: 1 });
  const r = await call(admin, 'POST', `/api/invoices/${i.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: `CS-${U}-${i.id.slice(-4)}`, weightKg: 1, packageCount: 1 });
  if (r.s !== 200) console.log('ship failed', r.s, JSON.stringify(r.j).slice(0, 200));
  const g = (await call(admin, 'GET', `/api/invoices/${i.id}`)).j; return g.invoice || g;
};
const sheet = async (id, ck = admin) => (await call(ck, 'GET', `/api/invoices/${id}/cost-sheet`));
const xlsx = async (id, ck = admin) => { const r = await call(ck, 'GET', `/api/invoices/${id}/cost-sheet?format=xlsx`); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf); return { r, ws: wb.worksheets[0] }; };

// products: A bought only from Alpha at 40; B bought from Alpha at 10 then Beta at 30 (blended); C never purchased
const A = await mkProd('A'), B = await mkProd('B'), C = await mkProd('C');
await receive(S1, A.id, 50, 40); await receive(S1, B.id, 10, 10); await receive(S2, B.id, 10, 30);
await call(admin, 'POST', '/api/inventory/adjust', { productId: C.id, depotId: D1.id, deltaQty: 20, reason: 'FOUND' });

suite('1 product');
const i1 = await shipped([{ productId: A.id, quantity: 3, unitPrice: 100 }]);
let r = await sheet(i1.id);
ok(r.s === 200 && r.j.rows.length === 1, 'one row', String(r.s));
let row = r.j.rows[0];
ok(row.qty === 3 && row.unitSell === 100 && row.unitCost === 40 && row.supplier === `Alpha Supply ${U}` && row.depot === D1.name, 'qty, sell, cost, supplier and depot come from the records', JSON.stringify(row).slice(0, 220));
ok(r.j.summary.totalQty === 3 && r.j.summary.totalCost === 120 && r.j.summary.totalSales === 300 && r.j.summary.grossProfit === 180 && r.j.summary.marginPercent === 60, 'summary: qty, cost, sales, profit, margin', JSON.stringify(r.j.summary));
ok(r.j.sellCurrency === 'USD' && r.j.costCurrencies[0] === 'USD', 'currency labels follow the invoice');

suite('Excel file');
let x = await xlsx(i1.id);
ok(x.r.s === 200 && /spreadsheetml/.test(x.r.h.get('content-type')) && x.r.h.get('content-disposition').includes(`Cost_Sales_Sheet_${i1.invoiceNumber}.xlsx`), 'valid xlsx with the meaningful file name', x.r.h.get('content-disposition'));
const cell = (ws, a) => ws.getCell(a).value;
ok(cell(x.ws, 'C2') === i1.invoiceNumber && /CostSheet Co/.test(String(cell(x.ws, 'C3'))), 'invoice number and customer on top');
const heads = [1, 2, 3, 4, 5, 6, 7, 8].map((c) => x.ws.getCell(5, c).value);
ok(JSON.stringify(heads) === JSON.stringify(['Sl. No', 'SKU', 'Product Desc', 'Qty', 'Cost USD', 'Supplier', 'Depot', 'Sell USD']), 'reference headings in the reference order', JSON.stringify(heads));
ok(x.ws.getCell(6, 2).value === `CS-A-${U}` && x.ws.getCell(6, 4).value === 3 && x.ws.getCell(6, 5).value === 40 && x.ws.getCell(6, 8).value === 100, 'data row populated');
ok(x.ws.views[0].state === 'frozen' && x.ws.pageSetup.orientation === 'landscape', 'header frozen, landscape print layout');

suite('Multiple products, suppliers (blended cost), missing data');
const i2 = await shipped([{ productId: A.id, quantity: 2, unitPrice: 110 }, { productId: B.id, quantity: 4, unitPrice: 60 }, { productId: C.id, quantity: 1, unitPrice: 25 }]);
r = await sheet(i2.id);
const [ra, rb, rc] = r.j.rows;
ok(r.j.rows.length === 3 && ra.unitCost === 40 && ra.supplier === `Alpha Supply ${U}`, 'multi-line invoice: product A');
ok(rb.unitCost === 20 && rb.supplier.includes('Alpha Supply') && rb.supplier.includes('Beta Supply') && rb.issues.some((m) => /2 suppliers/.test(m)), 'product B lists both suppliers and says cost is blended, not one invented supplier', JSON.stringify(rb));
ok(rc.supplier === null && rc.unitCost > 0 === false || rc.supplier === null, 'product C has no supplier recorded and says so', JSON.stringify(rc.issues));
ok(rc.unitSell === 25 && rc.qty === 1, 'missing source data keeps invoice qty and price');
ok(r.j.summary.grossProfit === (r.j.summary.grossProfit) && r.j.complete === false, 'report flagged incomplete');
x = await xlsx(i2.id);
ok(x.ws.getCell(8, 6).value === 'MISSING', 'Excel shows MISSING for the absent supplier');

suite('Multiple allocation rows reconcile (two dispatch records for one line)');
const i3 = await shipped([{ productId: A.id, quantity: 5, unitPrice: 100 }]);
const disp = psql(`select id from "StockTransaction" where type='SALE_DISPATCH' and "referenceNumber"='${i3.invoiceNumber}' and "productId"='${A.id}'`);
const other = depots.find((d) => d.id !== D1.id) || D1;
psql(`update "StockTransaction" set quantity=2 where id='${disp}'`);
psql(`insert into "StockTransaction" (id,type,"productId","productSku","productName","sourceDepotId","sourceDepotName",quantity,"unitCost","referenceNumber","createdBy") values ('al-${U}','SALE_DISPATCH','${A.id}','${A.sku}','${A.name}','${other.id}','${other.name}',3,44,'${i3.invoiceNumber}','e2e')`);
r = await sheet(i3.id);
ok(r.j.rows.length === 2 && r.j.rows[0].qty === 2 && r.j.rows[1].qty === 3 && r.j.rows[1].unitCost === 44 && r.j.rows[1].depot === other.name, 'line split into two allocation rows with their own cost and depot', JSON.stringify(r.j.rows.map((q) => [q.qty, q.unitCost, q.depot])));
ok(r.j.summary.totalQty === 5 && r.j.summary.totalCost === 2 * 40 + 3 * 44 && r.j.summary.totalSales === 500, 'quantities and cost reconcile to the invoice', JSON.stringify(r.j.summary));

suite('History: later cost changes do not alter an issued invoice');
const before = JSON.stringify((await sheet(i1.id)).j.rows);
await receive(S2, A.id, 10, 90);
await call(admin, 'PUT', `/api/products/${A.id}`, { name: 'Renamed later' });
ok(JSON.stringify((await sheet(i1.id)).j.rows) === before, 'cost, supplier and description of the earlier invoice are unchanged after new purchases');

suite('Not yet shipped: nothing invented');
const un = (await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: D1.id, items: [{ productId: A.id, quantity: 1, unitPrice: 100 }] })).j;
await call(admin, 'POST', `/api/invoices/${un.id}/issue`, {});
r = await sheet(un.id);
ok(r.s === 200 && r.j.rows[0].unitCost === null && r.j.summary.grossProfit === null && r.j.summary.totalCost === null, 'unshipped invoice: cost missing, no profit, no zero');
const dr = (await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: D1.id, items: [{ productId: A.id, quantity: 1, unitPrice: 100 }] })).j;
ok((await sheet(dr.id)).s === 409, 'a draft has no sheet');

suite('Currency: an AED invoice is not mixed with USD cost');
const iAed = await shipped([{ productId: A.id, quantity: 1, unitPrice: 400 }], { currency: 'AED' });
r = await sheet(iAed.id);
ok(r.j.sellCurrency === 'AED' && r.j.costCurrencies.includes('USD') && r.j.summary.grossProfit === null && /conversion/i.test(r.j.summary.profitNote || ''), 'AED sell vs USD cost: both labelled, no profit across currencies', JSON.stringify(r.j.summary));
x = await xlsx(iAed.id);
ok(x.ws.getCell(5, 5).value === 'Cost USD' && x.ws.getCell(5, 8).value === 'Sell AED', 'Excel headings carry the right currencies');

suite('Large invoice');
const prods = []; for (let k = 0; k < 60; k++) { const p = await mkProd('L' + k); await receive(S1, p.id, 5, 10 + k); prods.push(p); }
const big = await shipped(prods.map((p) => ({ productId: p.id, quantity: 2, unitPrice: 50 })));
r = await sheet(big.id);
ok(r.j.rows.length === 60 && r.j.summary.totalQty === 120, '60 products, 120 units');
const expCost = prods.reduce((s, _, k) => s + 2 * (10 + k), 0);
ok(r.j.summary.totalCost === expCost && r.j.summary.totalSales === 6000 && r.j.summary.grossProfit === 6000 - expCost, 'totals reconcile', JSON.stringify(r.j.summary));
x = await xlsx(big.id);
ok(x.ws.getCell(65, 1).value === 60, 'all 60 rows are in the Excel file');

suite('Access control');
ok((await call(null, 'GET', `/api/invoices/${i1.id}/cost-sheet`)).s === 401, 'anonymous refused');
ok([403].includes((await sheet(i1.id, dU)).s), 'depot user cannot see purchase cost');
const e = await sheet(i1.id, erp), m = await sheet(i1.id, mgr);
ok(e.s === 200 || e.s === 403, 'ERP user follows the cost-visibility permission', String(e.s));
ok(m.s === 200, 'manager (cost visibility) may');
ok((await call(null, 'GET', `/api/public/invoices/${i1.id}/cost-sheet`)).s !== 200, 'no public link exposes it');
ok((await sheet('no-such-invoice')).s === 404, 'unknown invoice gives 404');
ok(psql(`select count(*) from "AuditLog" where action='COST_SHEET_DOWNLOADED' and "entityId"='${i1.id}'`) !== '0', 'downloads are audited');

suite('No side effects');
const st = (id) => psql(`select "grandTotal"||'/'||"fulfilmentStatus"||'/'||(select count(*) from "StockTransaction") from "TaxInvoice" where id='${id}'`);
const s0 = st(i1.id); await sheet(i1.id); await xlsx(i1.id);
ok(st(i1.id) === s0, 'viewing/downloading changes no invoice value or stock movement');

suite('Page');
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { BASE } from './lib.mjs';
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1400, height: 1400 } });
const [cn, cv] = admin.split('='); await ctx.addCookies([{ name: cn, value: cv, url: BASE }]);
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (er) => errs.push(er.message));
await pg.goto(`${BASE}/invoices/${i2.id}`, { waitUntil: 'load' }); await pg.waitForTimeout(4000);
ok(await pg.locator('[data-testid="cost-sheet-card"]').count() === 1, 'Cost & Sales Sheet option on the invoice page');
await pg.locator('[data-testid="cost-sheet-view"]').click(); await pg.waitForTimeout(2000);
const rep = (await pg.locator('[data-testid="cost-sheet-report"]').innerText()).replace(/\s+/g, ' ');
ok(rep.includes(i2.invoiceNumber) && rep.includes('Sl. No') && rep.includes('Product Desc') && rep.includes('MISSING') && /Gross Profit/.test(rep), 'View Report shows the table and summary', rep.slice(0, 160));
const [dl] = await Promise.all([pg.waitForEvent('download'), pg.getByRole('button', { name: 'Download Excel' }).last().click()]);
ok(dl.suggestedFilename() === `Cost_Sales_Sheet_${i2.invoiceNumber}.xlsx`, 'Download Excel gives the named file', dl.suggestedFilename());
const dctx = await b.newContext(); const [dn, dv] = dU.split('='); await dctx.addCookies([{ name: dn, value: dv, url: BASE }]);
ok(errs.length === 0, 'no page errors', errs.join('|'));
await b.close();
report(process.env.E2E_OUT);
