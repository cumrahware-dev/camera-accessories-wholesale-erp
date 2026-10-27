// Final Tax Invoice acceptance: an EXISTING issued invoice (from before these features) plus a 5-line / 288 Pcs invoice
// like the customer's reference PDF. Everything is checked in the saved data and in the generated PDF / preview / print.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { BASE, login, call, ok, suite, report } from './lib.mjs';
const U = Date.now().toString(36).toUpperCase();
const TMP = process.env.E2E_TMP || '/tmp';
const admin = await login('admin'), erp = await login('erp'), depot = await login('depotUser');
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', 'arib_e2e', '-At', '-F', '|', '-c', q], { env: { ...process.env, PGPASSWORD: 'pg' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const pdfInfo = (file, png) => JSON.parse(execFileSync('python3', ['scripts/e2e/pdfinfo.py', file, ...(png ? [png] : [])], { maxBuffer: 1 << 26 }).toString());
const flat = (t) => t.replace(/\s+/g, ' ');
const getPdf = async (path) => { const r = await fetch(BASE + path, { headers: { cookie: admin } }); const f = `${TMP}/acc-${U}-${Math.random().toString(36).slice(2, 6)}.pdf`; fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); return { status: r.status, file: f, warn: decodeURIComponent(r.headers.get('x-pdf-warning') || '') }; };
const W = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const parseWords = (txt) => { let t = 0, c = 0; for (const w of txt.toLowerCase().replace(/-/g, ' ').split(/\s+/)) { if (W[w] !== undefined) c += W[w]; else if (w === 'hundred') c *= 100; else if (w === 'thousand') { t += c * 1e3; c = 0; } else if (w === 'million') { t += c * 1e6; c = 0; } } return t + c; };
const wordsToCents = (words, major) => { const body = words.slice(major.length).replace(/ Only\.$/, '').trim(); const [a, b] = body.split(/ and /); return parseWords(a) * 100 + (b ? parseWords(b.replace(/\s*[A-Za-z]+$/, '')) : 0); };
const finHash = (id) => psql(`select md5(row_to_json(t)::text) from (select id,"invoiceNumber","customerId",subtotal,"discountPercent","discountAmount","taxAmount","shippingCost","otherCharges","grandTotal",currency,"deliveryTerms","documentStatus","issuedAt","updatedAt" from "TaxInvoice" where id='${id}') t`) + '|' + psql(`select string_agg(md5(row_to_json(i)::text), ',' order by id) from "InvoiceItem" i where "invoiceId"='${id}'`);

async function checkInvoice(label, id, { expectQty }) {
  const inv = (await call(admin, 'GET', `/api/invoices/${id}`)).j;
  suite(`${label} ${inv.invoiceNumber}: SKU, total quantity, amount in words, stamp`);
  const pdf = await getPdf(`/api/document-pdf/TAX_INVOICE/${id}`); const info = pdfInfo(pdf.file, `${TMP}/acc-${U}-${inv.invoiceNumber}`); const T = flat(info.text);
  // SKU must be the product master's code for every line
  const master = psql(`select it."productId", p.sku from "InvoiceItem" it join "Product" p on p.id = it."productId" where it."invoiceId"='${id}' order by it.id`).split('\n').filter(Boolean).map((r) => r.split('|'));
  ok(master.length === inv.items.length && master.every(([, sku]) => T.includes(sku)), `every line prints its product-master SKU (${master.map((m) => m[1]).join(', ')})`);
  ok(inv.items.every((it) => master.some(([pid, sku]) => pid === it.productId && sku === it.productSku)), 'invoice line SKUs equal the product records');
  ok(T.includes(`Total Quantity: ${expectQty}`), `Total Quantity: ${expectQty} (from the saved lines)`, (T.match(/Total Quantity:[^A]*/) || [''])[0]);
  const major = inv.currency === 'AED' ? 'UAE Dirhams' : 'US Dollars';
  const words = /Amount in Words: (.+? Only\.)/.exec(T)?.[1] || '';
  const gc = Math.round(Number(inv.grandTotal) * 100);
  ok(words.startsWith(major) && wordsToCents(words, major) === gc, `amount in words = ${Number(inv.grandTotal).toFixed(2)} exactly`, words);
  ok(Math.abs(Number(inv.subtotal) - Number(inv.discountAmount) + Number(inv.taxAmount) + Number(inv.shippingCost) + Number(inv.otherCharges) - Number(inv.grandTotal)) < 0.005, 'grand total = subtotal - discount + VAT + freight + other charges');
  ok(info.images.length >= 2 && !pdf.warn, 'stamp printed by default for an issued invoice, no warning');
  const off = await getPdf(`/api/document-pdf/TAX_INVOICE/${id}?stamp=0`); ok(pdfInfo(off.file).images.length === 1, 'stamp absent when the option is off');
  const on = await getPdf(`/api/document-pdf/TAX_INVOICE/${id}?stamp=1`); const oi = pdfInfo(on.file); const st = oi.images.find((i) => Math.abs(i.w / i.h - 1) < 0.02);
  ok(on.status === 200 && !!st, `stamp present when the option is on, square aspect kept (${st?.w}x${st?.h})`);
  return { inv, T };
}

// ── 1. an EXISTING issued invoice (in the database before any of these features) ─────────────────────────────────────
const legacy = psql(`select id from "TaxInvoice" where "invoiceNumber"='INV-2026-00001'`);
ok(!!legacy, 'existing issued invoice INV-2026-00001 found');
const leg0 = finHash(legacy);
const { T: legT } = await checkInvoice('Existing invoice', legacy, { expectQty: '17 Pcs' });
ok(!legT.includes('Buyer Responsible for Insurance') && !legT.includes('SHIPMENT & PACKING'), 'before: no insurance wording, no empty shipment section');

suite('Existing invoice: add AWB / packing details + insurance after issue (ERP user)');
const lock = await call(erp, 'PUT', `/api/invoices/${legacy}`, { deliveryTerms: 'Buyer Responsible for Insurance' });
ok(lock.s === 400 && /issued invoice keeps/i.test(lock.j.error), 'the issued invoice delivery note stays locked (existing rule)', lock.j.error);
ok((await call(depot, 'PUT', `/api/invoices/${legacy}/shipment-details`, { awbNumber: 'X' })).s === 403, 'a user without the permission is refused');
const save = await call(erp, 'PUT', `/api/invoices/${legacy}/shipment-details`, { awbNumber: '176-44556677', awbReceivedDate: '2026-10-25', shipmentDate: '2026-10-24', packageCount: 5, packingDescription: '5 cartons, palletised', grossWeightKg: '312.750', netWeightKg: '298.5', lengthCm: '120', widthCm: '100', heightCm: '95.5', remarks: 'Keep dry', buyerResponsibleInsurance: true });
ok(save.s === 200 && save.j.details.awbNumber === '176-44556677', 'saved', `${save.s} ${save.j.error || ''}`);
ok(finHash(legacy) === leg0, 'invoice number, customer, lines, SKUs, quantities, rates, VAT, discount and total byte-identical');
ok(psql(`select count(*) from "TaxInvoice" where "invoiceNumber"='INV-2026-00001'`) === '1', 'no duplicate invoice');
const re = (await call(erp, 'GET', `/api/invoices/${legacy}`)).j.shipmentDetails;
ok(re && re.awbNumber === '176-44556677' && Number(re.grossWeightKg) === 312.75 && Number(re.heightCm) === 95.5 && re.buyerResponsibleInsurance === true, 'reopened: the details are read back from the database', JSON.stringify(re).slice(0, 160));
const hist = (await call(erp, 'GET', `/api/invoices/${legacy}/shipment-details`)).j.history;
ok(hist.length === 1 && hist[0].changedByName && hist[0].changedAt && hist[0].changedByRole === 'ERP_USER', 'history row: who, role, when');
ok(Number(psql(`select count(*) from "AuditLog" where "entityId"='${legacy}' and action='INVOICE_SHIPMENT_DETAILS_ADDED'`)) === 1, 'audit log entry recorded');
let pdf = await getPdf(`/api/document-pdf/TAX_INVOICE/${legacy}`); let LT = flat(pdfInfo(pdf.file, `${TMP}/acc-${U}-legacy-after`).text);
ok(LT.includes('Buyer Responsible for Insurance'), 'PDF: "Buyer Responsible for Insurance" in the TERMS section');
for (const f of ['SHIPMENT & PACKING DETAILS', 'AWB No. 176-44556677', 'AWB received 25 Oct 2026', 'No. of packages 5', '5 cartons, palletised', 'Gross weight 312.75 kg', 'Net weight 298.5 kg', '120 × 100 × 95.5 cm', 'Keep dry']) ok(LT.includes(f), `PDF: ${f}`);
ok(!/AWB No\.\s*(—|-|N\/A)/.test(LT), 'no placeholder values');

// ── 2. a 5-line, 288 Pcs invoice like the reference PDF, with a discount, VAT and freight ────────────────────────────
const mk = async (i, price) => (await call(admin, 'POST', '/api/products', { sku: `ACC-${U}-${i}`, name: `Acceptance Item ${i}`, brand: 'ARIB', unit: 'Pcs', sellingPrice: price, wholesalePrice: price, purchasePrice: price / 2, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;
const prods = []; for (const [i, p] of [[1, 1200], [2, 845.5], [3, 99.99], [4, 410], [5, 15.25]].entries()) prods.push(await mk(i + 1, p[1] ?? p));
for (const p of prods) await call(admin, 'POST', '/api/inventory/adjust', { productId: p.id, depotId: 'dep-central', deltaQty: 500, reason: 'FOUND' });
const cust = ((await call(admin, 'GET', '/api/customers?limit=1')).j.customers || (await call(admin, 'GET', '/api/customers?limit=1')).j)[0];
const q = [100, 60, 50, 48, 30];
const c = await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', discountPercent: 2.5, shippingCost: 125.4, deliveryTerms: 'Air freight; Buyer Responsible for Insurance', notes: 'Reference invoice for acceptance', items: prods.map((p, i) => ({ productId: p.id, quantity: q[i], unitPrice: p.sellingPrice })) });
await call(admin, 'POST', `/api/invoices/${c.j.id}/issue`, {});
const { inv: big, T: BT } = await checkInvoice('Reference-style invoice', c.j.id, { expectQty: '288 Pcs' });
ok(Number(big.discountAmount) > 0 && Math.round(Number(big.grandTotal) * 100) % 100 !== 0, `discount applied and a non-integer total (${big.grandTotal})`);
ok((BT.match(/Buyer Responsible for Insurance/g) || []).length === 1 && BT.includes('Air freight'), 'insurance wording from this invoice’s own delivery terms, printed once');
ok(BT.includes('Reference invoice for acceptance'), 'Notes section printed');

// mixed units + decimals
const mt = (await call(admin, 'POST', '/api/products', { sku: `ACC-${U}-MT`, name: 'Acceptance Sheet', brand: 'LBM', unit: 'Mt', sellingPrice: 2950, wholesalePrice: 2950, purchasePrice: 2000, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;
await call(admin, 'POST', '/api/inventory/adjust', { productId: mt.id, depotId: 'dep-central', deltaQty: 500, reason: 'FOUND' });
const m = await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', items: [{ productId: mt.id, quantity: 54.62, unitPrice: 2950 }, { productId: mt.id, quantity: 45.65, unitPrice: 2950 }, { productId: prods[0].id, quantity: 3, unitPrice: 1200 }] });
await call(admin, 'POST', `/api/invoices/${m.j.id}/issue`, {});
await checkInvoice('Mixed-unit invoice', m.j.id, { expectQty: '100.270 Mt + 3 Pcs' });

// ── 3. preview, Download PDF and print of the existing invoice show the same saved data ──────────────────────────────
suite('Existing invoice: preview / download / print consistency');
const ck = erp.split('='); const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 }, acceptDownloads: true }); await ctx.addCookies([{ name: ck[0], value: ck[1], url: BASE }]);
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`${BASE}/invoices/${legacy}`, { waitUntil: 'load' }); await pg.waitForTimeout(2500);
const card = flat(await pg.getByTestId('shipment-details-card').innerText());
ok(card.includes('176-44556677') && card.includes('312.75 kg') && card.includes('Buyer Responsible for Insurance') && /Last updated by/.test(card), 'invoice page card shows the saved details after reopening');
await pg.getByRole('button', { name: /Preview/ }).first().click(); await pg.waitForTimeout(1500);
const dt = flat(await pg.locator('.print-page').innerText());
const pdfWords = /Amount in Words: (.+? Only\.)/.exec(LT)?.[1];
for (const f of ['Buyer Responsible for Insurance', 'AWB No.: 176-44556677', 'Gross weight: 312.75 kg', 'Total Quantity: 17 Pcs', pdfWords]) ok(dt.includes(f), `preview: ${f}`);
ok(await pg.locator('.print-page img[alt*="Seal"]').evaluate((i) => i.complete && i.naturalWidth > 0), 'preview: stamp shown and loaded');
await pg.getByRole('button', { name: /Seal: Included/ }).click(); await pg.waitForTimeout(300);
ok(await pg.locator('.print-page img[alt*="Seal"]').count() === 0, 'preview: stamp switched off');
const [d0] = await Promise.all([pg.waitForEvent('download'), pg.getByTestId('download-pdf').click()]); const f0 = `${TMP}/acc-${U}-off.pdf`; await d0.saveAs(f0);
ok(pdfInfo(f0).images.length === 1, 'Download PDF with the stamp off: no stamp in the file');
await pg.getByRole('button', { name: /Seal: Omitted/ }).click(); await pg.waitForTimeout(300);
const [d1] = await Promise.all([pg.waitForEvent('download'), pg.getByTestId('download-pdf').click()]); const f1 = `${TMP}/acc-${U}-on.pdf`; await d1.saveAs(f1);
const i1 = pdfInfo(f1); ok(i1.images.length >= 2 && flat(i1.text).includes('176-44556677'), 'Download PDF with the stamp on: stamp + shipment details');
await pg.emulateMedia({ media: 'print' }); await pg.evaluate(() => document.body.classList.add('is-printing-document'));
const pf = `${TMP}/acc-${U}-print.pdf`; fs.writeFileSync(pf, await pg.pdf({ format: 'A4', printBackground: true })); const pi = pdfInfo(pf, `${TMP}/acc-${U}-print`); const PT = flat(pi.text);
for (const f of ['Buyer Responsible for Insurance', '176-44556677', '312.75 kg', 'Total Quantity: 17 Pcs', pdfWords]) ok(PT.includes(f), `print: ${f}`);
ok(pi.images.length >= 2, 'print: stamp included');
ok(errs.length === 0, 'no page errors', errs.join(';'));
await b.close();

// ── 4. a database that has not been migrated: clear message, invoice + PDF still work ────────────────────────────────
suite('Shipment-details table missing (migration not applied)');
psql('alter table "InvoiceShipmentDetails" rename to "InvoiceShipmentDetails_off"');
try {
  const g = await call(erp, 'GET', `/api/invoices/${legacy}/shipment-details`);
  ok(g.s === 503 && g.j.code === 'MIGRATION_PENDING' && /migrations/i.test(g.j.error), 'shipment details: 503 telling the administrator to run the migrations', g.j.error);
  ok((await call(erp, 'GET', `/api/invoices/${legacy}`)).s === 200, 'the invoice itself still opens');
  ok((await getPdf(`/api/document-pdf/TAX_INVOICE/${legacy}`)).status === 200, 'and its PDF still downloads');
} finally { psql('alter table "InvoiceShipmentDetails_off" rename to "InvoiceShipmentDetails"'); }
ok(finHash(legacy) === leg0, 'the existing invoice’s financial record is unchanged at the end');
report();
