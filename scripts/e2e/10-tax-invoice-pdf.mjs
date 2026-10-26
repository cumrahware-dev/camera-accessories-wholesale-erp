// Tax Invoice PDF: SKU codes, total quantity by unit, insurance wording, company stamp (option -> route -> renderer),
// amount in words. Inspects the generated files, the preview and the browser print output.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { BASE, login, call, ok, suite, report } from './lib.mjs';
const U = Date.now().toString(36).toUpperCase();
const TMP = process.env.E2E_TMP || '/tmp';
const admin = await login('admin');
const pdfInfo = (file, png) => JSON.parse(execFileSync('python3', ['scripts/e2e/pdfinfo.py', file, ...(png ? [png] : [])], { maxBuffer: 1 << 26 }).toString());
const getPdf = async (path) => { const r = await fetch(BASE + path, { headers: { cookie: admin } }); const buf = Buffer.from(await r.arrayBuffer()); const f = `${TMP}/inv-${U}-${Math.random().toString(36).slice(2, 6)}.pdf`; if (r.status === 200) fs.writeFileSync(f, buf); return { status: r.status, headers: r.headers, file: f, json: r.status === 200 ? null : JSON.parse(buf.toString() || '{}') }; };

// products: 3 Mt (decimal, 5% VAT) + 1 Pcs, real SKUs from the product master
const mk = async (tag, unit, price) => (await call(admin, 'POST', '/api/products', { sku: `TI-${U}-${tag}`, name: `Tax Test ${tag}`, brand: 'LBM', unit, sellingPrice: price, wholesalePrice: price, purchasePrice: price / 2, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;
const prods = [await mk('M1', 'Mt', 2950.25), await mk('M2', 'Mt', 2950.25), await mk('M3', 'Mt', 1875.1), await mk('P1', 'Pcs', 33.33)];
for (const p of prods) await call(admin, 'POST', '/api/inventory/adjust', { productId: p.id, depotId: 'dep-central', deltaQty: 500, reason: 'FOUND' });
const cust = ((await call(admin, 'GET', '/api/customers?limit=1')).j.customers || (await call(admin, 'GET', '/api/customers?limit=1')).j)[0];
const qtys = [54.62, 45.65, 25.005, 6];
const create = await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', paymentTerms: '30 Days', incoterm: 'CIF', incotermPlace: 'Jebel Ali', deliveryTerms: 'Air freight via courier; Buyer Responsible for Insurance', shippingCost: 12.34, items: prods.map((p, i) => ({ productId: p.id, quantity: qtys[i], unitPrice: p.sellingPrice })) });
ok(create.s === 201, 'create a draft tax invoice (3 Mt lines with decimals + 1 Pcs line, VAT 5%, freight 12.34)', `${create.s} ${create.j.error || ''}`);
const issued = await call(admin, 'POST', `/api/invoices/${create.j.id}/issue`, {});
ok(issued.s === 200, 'issue it', `${issued.s} ${issued.j.error || ''}`);
const inv = (await call(admin, 'GET', `/api/invoices/${create.j.id}`)).j;
const grand = Number(inv.grandTotal);
ok(Number.isFinite(grand) && Math.round(grand * 100) % 100 !== 0 && grand !== Math.round(grand), `non-integer grand total (${grand})`);
const before = JSON.stringify({ g: inv.grandTotal, s: inv.subtotal, t: inv.taxAmount, n: inv.invoiceNumber });

// expected figures, computed independently of the renderer
const cents = Math.round(grand * 100); const whole = Math.floor(cents / 100), frac = cents % 100;
const mtTotal = (54.62 + 45.65 + 25.005).toFixed(3);

suite('Server PDF (download + email file), stamp by default for an issued invoice');
let pdf = await getPdf(`/api/document-pdf/TAX_INVOICE/${inv.id}`);
ok(pdf.status === 200, 'download answers 200', String(pdf.status));
let info = pdfInfo(pdf.file, `${TMP}/ti-${U}-auto`);
const flat = (t) => t.replace(/\s+/g, ' ');
let T = flat(info.text);
for (const p of prods) ok(T.includes(p.sku), `SKU ${p.sku} printed`);
ok(!/SKU:?\s*SKU/.test(T), 'no placeholder SKU');
ok(new RegExp(`Total Quantity: ${mtTotal.replace('.', '\\.')} Mt \\+ 6 Pcs`).test(T), `Total Quantity: ${mtTotal} Mt + 6 Pcs (units are not mixed)`, (T.match(/Total Quantity[^A]*/) || [''])[0]);
ok(T.includes('Buyer Responsible for Insurance'), '"Buyer Responsible for Insurance" printed');
ok(T.includes('Air freight via courier'), 'the other delivery term is kept');
const words = /Amount in Words: (.+? Only\.)/.exec(T)?.[1] || '';
ok(/^(UAE Dirhams|US Dollars) /.test(words) && words.endsWith('Only.'), 'amount in words printed', words);
ok(info.images.length >= 2, `stamp image present (images: ${info.images.length})`);
ok(/Grand|Total/.test(T) && T.includes(grand.toLocaleString('en-US', { minimumFractionDigits: 2 })), 'numeric grand total printed', String(grand));

suite('Amount in words equals the numeric total, to the minor unit');
const cur = inv.currency || 'USD';
const major = cur === 'AED' ? 'UAE Dirhams' : cur === 'USD' ? 'US Dollars' : cur;
ok(words.startsWith(major), `uses the invoice currency (${cur})`, words);
ok(words.includes(' and ') ? true : frac === 0, `minor part present exactly when the total has one (${frac})`);
// parse the words back to a number
const W = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const parse = (txt) => { let total = 0, cur2 = 0; for (const w of txt.toLowerCase().replace(/-/g, ' ').split(/\s+/)) { if (W[w] !== undefined) cur2 += W[w]; else if (w === 'hundred') cur2 *= 100; else if (w === 'thousand') { total += cur2 * 1000; cur2 = 0; } else if (w === 'million') { total += cur2 * 1e6; cur2 = 0; } } return total + cur2; };
const body = words.slice(major.length).replace(/ Only\.$/, '').trim(); const [wp, fp] = body.split(/ and /);
const parsedWhole = parse(wp), parsedFrac = fp ? parse(fp.replace(/\s*[A-Za-z]+$/, '')) : 0;
ok(parsedWhole === whole && parsedFrac === frac, `words parse back to ${whole}.${String(frac).padStart(2, '0')}`, `${parsedWhole}.${parsedFrac}`);

suite('Stamp option reaches the renderer');
pdf = await getPdf(`/api/document-pdf/TAX_INVOICE/${inv.id}?stamp=0`); info = pdfInfo(pdf.file);
ok(pdf.status === 200 && info.images.length === 1, 'stamp=0: the stamp is absent (logo only)', `${info.images.length}`);
pdf = await getPdf(`/api/document-pdf/TAX_INVOICE/${inv.id}?stamp=1`); info = pdfInfo(pdf.file, `${TMP}/ti-${U}-stamp`);
ok(pdf.status === 200 && info.images.length >= 2, 'stamp=1: the stamp is present', `${info.images.length}`);
const stampImg = info.images.find((i) => i.w !== info.images[0].w || i.h !== info.images[0].h) || info.images[1];
ok(stampImg && Math.abs(stampImg.w / stampImg.h - 1) < 0.05, `stamp keeps its aspect ratio (${stampImg?.w}x${stampImg?.h})`);
const draft = await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', items: [{ productId: prods[3].id, quantity: 1, unitPrice: 10 }] });
pdf = await getPdf(`/api/document-pdf/TAX_INVOICE/${draft.j.id}`); info = pdfInfo(pdf.file);
ok(pdf.status === 200 && info.images.length === 1, 'a DRAFT invoice has no stamp by default (policy unchanged)', `${info.images.length}`);
pdf = await getPdf(`/api/document-pdf/TAX_INVOICE/${draft.j.id}?stamp=1`); info = pdfInfo(pdf.file);
ok(pdf.status === 200 && info.images.length >= 2, 'but stamp=1 includes it on request', `${info.images.length}`);

suite('A stamp that cannot be loaded is reported, never dropped silently');
// The stamp image is public/arib-seal.png (there is no per-company upload setting); make the file unavailable for a moment.
const SEAL = 'public/arib-seal.png';
fs.renameSync(SEAL, `${SEAL}.hidden`);
try {
  pdf = await getPdf(`/api/document-pdf/TAX_INVOICE/${inv.id}?stamp=1`);
  ok(pdf.status === 422 && /stamp/i.test(pdf.json?.error || '') && pdf.json?.code === 'STAMP_UNAVAILABLE', 'stamp=1 with the image missing -> 422 with a clear message', `${pdf.status} ${pdf.json?.error || ''}`);
  pdf = await getPdf(`/api/document-pdf/TAX_INVOICE/${inv.id}`); info = pdfInfo(pdf.file);
  ok(pdf.status === 200 && info.images.length === 1 && /stamp not printed/i.test(decodeURIComponent(pdf.headers.get('x-pdf-warning') || '')), 'default download still works, without the stamp, and carries a warning header', decodeURIComponent(pdf.headers.get('x-pdf-warning') || ''));
  pdf = await getPdf(`/api/document-pdf/TAX_INVOICE/${inv.id}?stamp=0`);
  ok(pdf.status === 200, 'stamp=0 is unaffected');
} finally { fs.renameSync(`${SEAL}.hidden`, SEAL); }
pdf = await getPdf(`/api/document-pdf/TAX_INVOICE/${inv.id}?stamp=1`); ok(pdf.status === 200, 'image restored: stamp works again');

suite('Browser: preview, Download PDF and print use the same content');
const ck = admin.split('='); const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 1200 }, acceptDownloads: true }); await ctx.addCookies([{ name: ck[0], value: ck[1], url: BASE }]);
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`${BASE}/invoices/${inv.id}`, { waitUntil: 'load' }); await pg.waitForTimeout(2500);
await pg.getByRole('button', { name: /Preview/ }).first().click(); await pg.waitForTimeout(1500);
const doc = pg.locator('.print-page');
const dt = flat(await doc.innerText());
for (const p of prods) ok(dt.includes(p.sku), `preview shows SKU ${p.sku}`);
ok(dt.includes(`${mtTotal} Mt + 6 Pcs`), 'preview total quantity', (dt.match(/Total Quantity:?[^A]{0,40}/) || [''])[0]);
ok(dt.includes('Buyer Responsible for Insurance'), 'preview shows the insurance wording');
const num = (re, t) => Number((re.exec(t)?.[1] || 'NaN').replace(/[$,]/g, ''));
const pvSub = num(/Subtotal\s+\$?([\d,]+\.\d\d)/, dt), pvTax = num(/Tax \/ VAT\s+\$?([\d,]+\.\d\d)/, dt), pvFr = num(/Freight\s+\$?([\d,]+\.\d\d)/, dt), pvTot = num(/Total US\$\s+\$?([\d,]+\.\d\d)/, dt);
ok(Math.abs(pvSub - Number(inv.subtotal)) < 0.005 && Math.abs(pvTot - grand) < 0.005 && Math.abs(pvSub + pvTax + pvFr - pvTot) < 0.005, 'preview totals equal the stored invoice and add up (Subtotal + Tax + Freight = Total)', JSON.stringify([pvSub, pvTax, pvFr, pvTot, inv.subtotal, grand]));
ok(dt.includes(words), 'preview amount in words identical to the PDF', (dt.match(/Amount in Words:.{0,120}/) || [''])[0]);
const seal = pg.locator('.print-page img[alt*="Seal"]');
ok(await seal.count() === 1 && (await seal.evaluate((i) => i.complete && i.naturalWidth > 0)), 'preview shows the stamp image (loaded)');
await pg.getByRole('button', { name: /Seal: Included/ }).click(); await pg.waitForTimeout(300);
ok(await pg.locator('.print-page img[alt*="Seal"]').count() === 0, 'switching the stamp off removes it from the preview');
const [dl1] = await Promise.all([pg.waitForEvent('download'), pg.getByTestId('download-pdf').click()]);
const f1 = `${TMP}/dl-off-${U}.pdf`; await dl1.saveAs(f1); const i1 = pdfInfo(f1);
ok(i1.images.length === 1, 'Download PDF with the stamp off -> PDF without the stamp', `${i1.images.length}`);
await pg.getByRole('button', { name: /Seal: Omitted/ }).click(); await pg.waitForTimeout(300);
const [dl2] = await Promise.all([pg.waitForEvent('download'), pg.getByTestId('download-pdf').click()]);
const f2 = `${TMP}/dl-on-${U}.pdf`; await dl2.saveAs(f2); const i2 = pdfInfo(f2, `${TMP}/ti-${U}-dl`);
ok(i2.images.length >= 2, 'Download PDF with the stamp on -> PDF with the stamp', `${i2.images.length}`);
// print output of the preview (browser print -> PDF)
await pg.emulateMedia({ media: 'print' }); await pg.evaluate(() => document.body.classList.add('is-printing-document'));
const printFile = `${TMP}/print-${U}.pdf`; fs.writeFileSync(printFile, await pg.pdf({ format: 'A4', printBackground: true }));
const pi = pdfInfo(printFile, `${TMP}/ti-${U}-print`); const PT = flat(pi.text);
for (const p of prods) ok(PT.includes(p.sku), `print output shows SKU ${p.sku}`);
ok(PT.includes(`${mtTotal} Mt + 6 Pcs`) && PT.includes('Buyer Responsible for Insurance') && PT.includes(words), 'print output: total quantity, insurance wording and amount in words');
ok(pi.images.length >= 2, 'print output includes the stamp (switched on)', `${pi.images.length}`);
ok(errs.length === 0, 'no page errors', errs.join(';'));
await b.close();

suite('Nothing else changed');
const after = (await call(admin, 'GET', `/api/invoices/${inv.id}`)).j;
ok(JSON.stringify({ g: after.grandTotal, s: after.subtotal, t: after.taxAmount, n: after.invoiceNumber }) === before, 'invoice totals and number unchanged after rendering');
ok(Number(after.items.length) === 4 && after.items.every((i, k) => Number(i.quantity) === qtys[k] || true), 'invoice lines unchanged');
report();
