// AWB / packing details added after a Tax Invoice is issued: controlled update, history, permissions, PDF + preview + print,
// customer-specific default delivery terms. Financial values and numbering must not move.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { BASE, login, call, ok, suite, report } from './lib.mjs';
const U = Date.now().toString(36).toUpperCase();
const TMP = process.env.E2E_TMP || '/tmp';
const admin = await login('admin'), erp = await login('erp'), mgr = await login('manager'), depot = await login('depotUser');
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', 'arib_e2e', '-At', '-F', '|', '-c', q], { env: { ...process.env, PGPASSWORD: 'pg' } }).toString().trim();
const pdfInfo = (file, png) => JSON.parse(execFileSync('python3', ['scripts/e2e/pdfinfo.py', file, ...(png ? [png] : [])], { maxBuffer: 1 << 26 }).toString());
const flat = (t) => t.replace(/\s+/g, ' ');
const getPdf = async (ck, path) => { const r = await fetch(BASE + path, { headers: { cookie: ck } }); const f = `${TMP}/sd-${U}-${Math.random().toString(36).slice(2, 6)}.pdf`; fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); return { status: r.status, file: f }; };

suite('Customer-specific default delivery terms (not hardcoded)');
const mkCust = async (name, extra = {}) => (await call(admin, 'POST', '/api/customers', { companyName: name, contactPerson: 'Ops', email: `${name.replace(/\W/g, '').toLowerCase()}${U}@x.test`, phone: '+971501234567', billingAddress: 'Dubai, UAE', shippingAddress: 'Dubai, UAE', ...extra })).j;
const tanweer = await mkCust(`Tanweer Bhaii Dubai ${U}`, { defaultDeliveryTerms: 'Buyer Responsible for Insurance' });
const other = await mkCust(`Other Buyer ${U}`);
ok(tanweer.id && tanweer.defaultDeliveryTerms === 'Buyer Responsible for Insurance', 'the customer record stores its own default delivery terms', JSON.stringify(tanweer).slice(0, 120));
ok(!other.defaultDeliveryTerms, 'another customer has none');

const mk = async (tag, unit, price) => (await call(admin, 'POST', '/api/products', { sku: `SD-${U}-${tag}`, name: `Ship Test ${tag}`, brand: 'LBM', unit, sellingPrice: price, wholesalePrice: price, purchasePrice: price / 2, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;
const prods = [await mk('M1', 'Mt', 2950.25), await mk('M2', 'Mt', 1875.1), await mk('P1', 'Pcs', 33.33)];
for (const p of prods) await call(admin, 'POST', '/api/inventory/adjust', { productId: p.id, depotId: 'dep-central', deltaQty: 500, reason: 'FOUND' });
const qtys = [54.62, 25.005, 6];
const items = prods.map((p, i) => ({ productId: p.id, quantity: qtys[i], unitPrice: p.sellingPrice }));
const mkInv = async (cust, extra = {}) => { const c = await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', shippingCost: 12.34, items, ...extra }); const i = await call(admin, 'POST', `/api/invoices/${c.j.id}/issue`, {}); return { c, i, id: c.j.id }; };
const t = await mkInv(tanweer);
ok(t.c.s === 201 && t.c.j.deliveryTerms === 'Buyer Responsible for Insurance', "Tanweer's new invoice starts with 'Buyer Responsible for Insurance' (customer default)", `${t.c.s} ${t.c.j.deliveryTerms}`);
const o = await mkInv(other);
ok(o.c.s === 201 && !o.c.j.deliveryTerms, 'another customer’s invoice does not get it');
ok(t.i.s === 200, 'invoice issued', `${t.i.s} ${t.i.j.error || ''}`);
const inv = (await call(admin, 'GET', `/api/invoices/${t.id}`)).j;
const finRow = () => psql(`select md5(row_to_json(t)::text) from (select id,"invoiceNumber","customerId","customerName",subtotal,"discountAmount","taxAmount","shippingCost","otherCharges","grandTotal",currency,"paymentTerms","deliveryTerms","documentStatus","issuedAt","updatedAt" from "TaxInvoice" where id='${t.id}') t`) + '|' + psql(`select string_agg(md5(row_to_json(i)::text), ',' order by id) from "InvoiceItem" i where "invoiceId"='${t.id}'`);
const fin0 = finRow();

suite('Before any AWB is entered: no empty section');
let pdf = await getPdf(admin, `/api/document-pdf/TAX_INVOICE/${t.id}`); let info = pdfInfo(pdf.file); let T = flat(info.text);
ok(!/SHIPMENT & PACKING DETAILS/.test(T), 'no empty Shipment & Packing section');
ok(T.includes('Buyer Responsible for Insurance'), 'insurance wording from the customer default is printed');
ok(/Total Quantity: 79\.625 Mt \+ 6 Pcs/.test(T), 'total quantity 79.625 Mt + 6 Pcs', (T.match(/Total Quantity[^A]*/) || [''])[0]);
const cents = Math.round(Number(inv.grandTotal) * 100);
ok(/Amount in Words: .+ Only\./.test(T) && cents % 100 !== 0, 'amount in words present; non-integer total', String(inv.grandTotal));
ok(info.images.length >= 2, 'stamp present (issued invoice)', String(info.images.length));
pdf = await getPdf(admin, `/api/document-pdf/TAX_INVOICE/${t.id}?stamp=0`); ok(pdfInfo(pdf.file).images.length === 1, 'stamp absent when switched off');

suite('Adding AWB and packing details after issue');
const body = { awbNumber: '176-12345675', awbReceivedDate: '2026-10-25', shipmentDate: '2026-10-24', packageCount: 12, packingDescription: 'Wooden crates, 12 pcs per crate', grossWeightKg: '1250.500', netWeightKg: 1200.25, lengthCm: 120, widthCm: 80, heightCm: 60.5, remarks: 'Handle with care. Keep dry.', buyerResponsibleInsurance: true };
const dep = await call(depot, 'PUT', `/api/invoices/${t.id}/shipment-details`, body);
ok(dep.s === 403, 'a role without the permission is refused', String(dep.s));
const anon = await call(null, 'PUT', `/api/invoices/${t.id}/shipment-details`, body); ok(anon.s === 401, 'anonymous is refused');
const draft = await call(admin, 'POST', '/api/invoices', { customerId: other.id, depotId: 'dep-central', items: [items[2]] });
const dr = await call(erp, 'PUT', `/api/invoices/${draft.j.id}/shipment-details`, { awbNumber: 'X1' }); ok(dr.s === 409 && /draft/i.test(dr.j.error), 'a DRAFT invoice cannot take shipment details (issue it first)', dr.j.error);
for (const [name, patch, re] of [['net above gross', { grossWeightKg: 10, netWeightKg: 11 }, /net weight/i], ['4 decimals', { grossWeightKg: 1.2345 }, /decimal/i], ['bad AWB chars', { awbNumber: 'AB<script>' }, /AWB/i], ['future date', { shipmentDate: '2099-01-01' }, /future/i], ['negative packages', { packageCount: -1 }, /packages/i], ['fractional packages', { packageCount: 2.5 }, /whole/i]]) {
  const r = await call(erp, 'PUT', `/api/invoices/${t.id}/shipment-details`, patch); ok(r.s === 400 && re.test(r.j.error || ''), `validation: ${name} -> "${r.j.error}"`);
}
ok(psql(`select count(*) from "InvoiceShipmentDetails" where "invoiceId"='${t.id}'`) === '0', 'rejected requests saved nothing');
const hostile = await call(erp, 'PUT', `/api/invoices/${t.id}/shipment-details`, { ...body, grandTotal: 1, subtotal: 1, taxAmount: 0, invoiceNumber: 'HACK', customerId: 'x', items: [], documentStatus: 'DRAFT' });
ok(hostile.s === 200, 'the ERP user saves AWB / packing details', `${hostile.s} ${hostile.j.error || ''}`);
ok(finRow() === fin0, 'extra financial fields in the request were ignored: totals, VAT, customer, number, status and every line are byte-identical');
const g = (await call(erp, 'GET', `/api/invoices/${t.id}/shipment-details`)).j;
ok(g.details.awbNumber === '176-12345675' && Number(g.details.grossWeightKg) === 1250.5 && Number(g.details.netWeightKg) === 1200.25 && Number(g.details.heightCm) === 60.5 && g.details.packageCount === 12 && g.details.awbReceivedDate === '2026-10-25', 'values stored with decimals preserved', JSON.stringify(g.details).slice(0, 200));
ok(g.details.updatedByName && g.history.length === 1 && g.history[0].action === 'CREATED' && g.history[0].changedByName === g.details.updatedByName && g.history[0].changedByRole === 'ERP_USER', 'history: who, role, when recorded (CREATED)');
ok(Number(psql(`select count(*) from "AuditLog" where "entityId"='${t.id}' and action='INVOICE_SHIPMENT_DETAILS_ADDED'`)) === 1, 'audit log entry written');

suite('Updating, no-op, and history');
const up = await call(mgr, 'PUT', `/api/invoices/${t.id}/shipment-details`, { awbNumber: '176-99999990', packageCount: 14 });
ok(up.s === 200 && up.j.details.awbNumber === '176-99999990' && up.j.details.packageCount === 14 && Number(up.j.details.grossWeightKg) === 1250.5, 'a manager updates two fields; the others are kept');
const h = up.j.history; ok(h.length === 2 && h[0].action === 'UPDATED' && h[0].changes.awbNumber.from === '176-12345675' && h[0].changes.awbNumber.to === '176-99999990' && h[0].changes.packageCount.from === 12 && Object.keys(h[0].changes).length === 2, 'history records exactly the changed fields with old and new values', JSON.stringify(h[0]?.changes));
const noop = await call(mgr, 'PUT', `/api/invoices/${t.id}/shipment-details`, { awbNumber: '176-99999990', packageCount: 14 });
ok(noop.s === 200 && noop.j.unchanged === true && noop.j.history.length === 2, 'saving the same values again changes nothing and adds no history');
const clr = await call(mgr, 'PUT', `/api/invoices/${t.id}/shipment-details`, { remarks: '' }); ok(clr.s === 200 && clr.j.details.remarks === '' && clr.j.history.length === 3, 'a field can be cleared (recorded in history)');
await call(mgr, 'PUT', `/api/invoices/${t.id}/shipment-details`, { remarks: 'Handle with care. Keep dry.' });
let hist = psql(`select count(*) from "InvoiceShipmentDetailsHistory" where "invoiceId"='${t.id}'`); ok(Number(hist) === 4, 'four history rows so far', hist);
let hdel = ''; try { execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', 'arib_e2e', '-At', '-c', `delete from "InvoiceShipmentDetailsHistory" where "invoiceId"='${t.id}'`], { env: { ...process.env, PGPASSWORD: 'pg' }, stdio: 'pipe' }); } catch (e) { hdel = 'blocked'; }
ok(hdel === 'blocked', 'the history is append-only at the database level');
ok(finRow() === fin0, 'still no change to the invoice itself after all updates');
ok((await call(admin, 'GET', `/api/invoices/${t.id}`)).j.invoiceNumber === inv.invoiceNumber, 'invoice number unchanged');

suite('Generated PDF shows the details');
pdf = await getPdf(admin, `/api/document-pdf/TAX_INVOICE/${t.id}`); info = pdfInfo(pdf.file, `${TMP}/sd-${U}-pdf`); T = flat(info.text);
for (const frag of ['SHIPMENT & PACKING DETAILS', 'AWB No. 176-99999990', 'AWB received 25 Oct 2026', 'Shipment date 24 Oct 2026', 'No. of packages 14', 'Wooden crates, 12 pcs per crate', 'Gross weight 1,250.5 kg', 'Net weight 1,200.25 kg', 'Dimensions (L × W × H) 120 × 80 × 60.5 cm', 'Handle with care. Keep dry.']) ok(T.includes(frag), `PDF: ${frag}`);
ok((T.match(/Buyer Responsible for Insurance/g) || []).length === 1, 'insurance wording printed once (customer default + supplementary flag are de-duplicated)', String((T.match(/Buyer Responsible for Insurance/g) || []).length));
ok(info.images.length >= 2, 'stamp still present');

suite('Invoice notes (existing field) are saved and printed');
const nt = await call(erp, 'PUT', `/api/invoices/${t.id}`, { notes: `Please quote AWB on delivery. ${U}` });
ok(nt.s === 200, 'notes saved on the issued invoice', `${nt.s} ${nt.j.error || ''}`);
ok(psql(`select notes from "TaxInvoice" where id='${t.id}'`).includes(U), 'notes are in the database');
pdf = await getPdf(admin, `/api/document-pdf/TAX_INVOICE/${t.id}`); T = flat(pdfInfo(pdf.file).text); ok(T.includes(`Please quote AWB on delivery. ${U}`), 'notes are printed in the PDF');

suite('Browser: add details through the UI; preview, Download PDF and print agree');
const o2 = await mkInv(tanweer); // a second issued invoice, no details yet
const ck = erp.split('='); const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 }, acceptDownloads: true }); await ctx.addCookies([{ name: ck[0], value: ck[1], url: BASE }]);
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`${BASE}/invoices/${o2.id}`, { waitUntil: 'load' }); await pg.waitForTimeout(2500);
const card = pg.getByTestId('shipment-details-card');
ok((await card.innerText()).includes('No AWB or packing details yet'), 'card shows the empty state');
await card.getByRole('button', { name: /Add AWB/ }).click();
await pg.locator('#sd-awb').fill('618-55501234'); await pg.locator('#sd-awb-date').fill('2026-10-25'); await pg.locator('#sd-ship-date').fill('2026-10-24');
await pg.locator('#sd-packages').fill('3'); await pg.locator('#sd-packing').fill('3 cartons, shrink wrapped'); await pg.locator('#sd-gross').fill('88.125'); await pg.locator('#sd-net').fill('80.5');
await pg.locator('#sd-l').fill('60'); await pg.locator('#sd-w').fill('40'); await pg.locator('#sd-h').fill('30.25'); await pg.locator('#sd-remarks').fill('Fragile');
await card.getByRole('button', { name: 'Save details' }).click(); await pg.waitForTimeout(1500);
const ct = flat(await card.innerText());
ok(ct.includes('618-55501234') && ct.includes('88.125 kg') && ct.includes('3 cartons, shrink wrapped') && /Last updated by/.test(ct), 'card shows the saved details and who updated them', ct.slice(0, 160));
await pg.getByRole('button', { name: /Preview/ }).first().click(); await pg.waitForTimeout(1500);
const doc = pg.locator('.print-page'); const dt = flat(await doc.innerText());
for (const frag of ['SHIPMENT & PACKING DETAILS', 'AWB No.: 618-55501234', 'No. of packages: 3', 'Gross weight: 88.125 kg', 'Net weight: 80.5 kg', 'Dimensions (L × W × H): 60 × 40 × 30.25 cm', 'Fragile']) ok(dt.includes(frag), `preview: ${frag}`);
ok((dt.match(/Buyer Responsible for Insurance/g) || []).length === 1, 'preview prints the insurance wording once');
const [dl] = await Promise.all([pg.waitForEvent('download'), pg.getByTestId('download-pdf').click()]);
const f = `${TMP}/sd-${U}-dl.pdf`; await dl.saveAs(f); const dT = flat(pdfInfo(f).text);
for (const frag of ['618-55501234', '88.125 kg', '3 cartons, shrink wrapped', '60 × 40 × 30.25 cm', 'Fragile']) ok(dT.includes(frag), `downloaded PDF: ${frag}`);
await pg.emulateMedia({ media: 'print' }); await pg.evaluate(() => document.body.classList.add('is-printing-document'));
const pf = `${TMP}/sd-${U}-print.pdf`; fs.writeFileSync(pf, await pg.pdf({ format: 'A4', printBackground: true })); const pi = pdfInfo(pf, `${TMP}/sd-${U}-print`); const PT = flat(pi.text);
for (const frag of ['618-55501234', '88.125 kg', '3 cartons, shrink wrapped', '60 × 40 × 30.25 cm', 'Fragile', 'Buyer Responsible for Insurance']) ok(PT.includes(frag), `print output: ${frag}`);
await pg.emulateMedia({ media: 'screen' });
// history visible in the UI
await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(2000);
await pg.getByTestId('shipment-history').locator('summary').click();
ok(/Added by/.test(await pg.getByTestId('shipment-history').innerText()), 'change history is visible on the invoice page');
ok(errs.length === 0, 'no page errors', errs.join(';'));
await b.close();
report();
