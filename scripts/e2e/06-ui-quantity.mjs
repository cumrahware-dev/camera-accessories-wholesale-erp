// Browser test: typing / pasting decimal quantities in the proforma builder, decimals limits, saved document pages,
// print preview (invoice) and the depot packing list.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { BASE, login, call, ok, suite, report } from './lib.mjs';
const U = Date.now().toString(36).toUpperCase();
const admin = await login('admin');
const mk = async (gauge, unit) => (await call(admin, 'POST', '/api/products', { sku: `UI-${U}-${gauge}`, name: `UI Gi Sheet ${gauge}`, brand: 'LBM', unit, sellingPrice: 2950, wholesalePrice: 2950, purchasePrice: 2000, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j;
const mt = (await mk('1.1', 'Mt')).product, mt2 = (await mk('1.5', 'Mt')).product, pcs = (await mk('PCS', 'Pcs')).product;
for (const p of [mt, mt2, pcs]) await call(admin, 'POST', '/api/inventory/adjust', { productId: p.id, depotId: 'dep-central', deltaQty: 100, reason: 'FOUND' });
const cust = ((await call(admin, 'GET', '/api/customers?limit=1')).j.customers || (await call(admin, 'GET', '/api/customers?limit=1')).j)[0];
const ck = admin.split('='); const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addCookies([{ name: ck[0], value: ck[1], url: BASE }]);
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));

suite('Typing decimals in the proforma builder');
await p.goto(BASE + '/proformas/new', { waitUntil: 'load' }); await p.waitForTimeout(1500);
await p.getByText(cust.companyName).first().click();
await p.getByRole('button', { name: /Continue to Step 2|Continue to Product/ }).first().click();
const search = p.getByPlaceholder(/Quick search/);
for (const sku of [`UI-${U}-1.1`, `UI-${U}-1.5`, `UI-${U}-PCS`]) { await search.fill(sku); await p.waitForTimeout(900); await p.getByRole('button', { name: 'Add', exact: true }).first().click(); }
const q = (name) => p.getByLabel(`Quantity of ${name}`);
const q1 = q('UI Gi Sheet 1.1');
await q1.click(); await q1.fill(''); await q1.pressSequentially('54.620', { delay: 40 });
ok(await q1.inputValue() === '54.620', 'typing 54.620 keeps every character (including the trailing zero while editing)', await q1.inputValue());
await q1.pressSequentially('7', { delay: 40 }); ok(await q1.inputValue() === '54.620', 'a 4th decimal is not accepted for Mt', await q1.inputValue());
await q1.fill(''); await p.evaluate(() => navigator.clipboard?.writeText?.('1,045.500').catch(() => {}));
await q1.pressSequentially('54.', { delay: 40 }); ok(await q1.inputValue() === '54.', 'a trailing "." is not swallowed while typing', await q1.inputValue());
await q1.pressSequentially('62', { delay: 40 }); await q1.blur(); await p.waitForTimeout(300);
ok(await q1.inputValue() === '54.620', 'on leaving the field 54.62 is tidied to 54.620', await q1.inputValue());
const q2 = q('UI Gi Sheet 1.5'); await q2.click(); await q2.fill(''); await q2.pressSequentially('45.650', { delay: 30 }); await q2.blur();
ok(await q2.inputValue() === '45.650', 'second line 45.650');
const qp = q('UI Gi Sheet PCS'); await qp.click(); await qp.fill(''); await qp.pressSequentially('2.5', { delay: 30 });
ok(await qp.inputValue() === '25', 'a Pcs product does not accept a decimal point', await qp.inputValue());
await qp.fill(''); await qp.pressSequentially('3', { delay: 30 }); await qp.blur();
await q1.focus(); await q1.fill(''); await p.keyboard.insertText('54.62'); ok((await q1.inputValue()) === '54.62', 'pasted text is accepted', await q1.inputValue()); await q1.blur();
const body = await p.locator('body').innerText();
ok(/161,129\.00/.test(body) && /134,667\.50/.test(body), 'line amounts on screen: 161,129.00 and 134,667.50', (body.match(/[\d,]+\.\d\d/g) || []).slice(0, 8).join(' '));
for (let i = 0; i < 6; i++) { const n = p.getByRole('button', { name: /^Continue to/ }).first(); if (!(await n.count())) break; await n.click(); await p.waitForTimeout(400); }
await p.getByRole('button', { name: /Save Proforma/ }).last().click(); await p.waitForTimeout(2500);
ok(/\/proformas\/c/.test(p.url()), 'saved; opened the proforma page', p.url());

suite('Saved proforma page and conversion');
let t = await p.locator('body').innerText();
ok(/54\.620 Mt/.test(t) && /45\.650 Mt/.test(t), 'the saved proforma page shows 54.620 Mt and 45.650 Mt', (t.match(/[\d.]+ Mt/g) || []).join(','));
ok(/3 Pcs|\b3\b/.test(t), 'the whole-number line still shows 3');
const id = p.url().split('/').pop();
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200); t = await p.locator('body').innerText();
ok(/54\.620 Mt/.test(t), 'after refresh the quantity is still 54.620 Mt');
await call(admin, 'POST', `/api/proformas/${id}/confirm`, {});
const c = await call(admin, 'POST', `/api/proformas/${id}/convert`, { depotId: 'dep-central' }); const inv = c.j;
await call(admin, 'POST', `/api/invoices/${inv.id}/issue`, {});
inv.invoiceNumber = (await call(admin, 'GET', `/api/invoices/${inv.id}`)).j.invoiceNumber;
await p.goto(`${BASE}/invoices/${inv.id}`, { waitUntil: 'load' }); await p.waitForTimeout(1500);
t = await p.locator('body').innerText(); ok(/54\.620 Mt/.test(t), 'invoice page shows 54.620 Mt');
await p.getByRole('button', { name: /Preview/ }).first().click(); await p.waitForTimeout(1200);
t = await p.locator('body').innerText();
ok(/54\.620 Mt/.test(t) && /Total Quantity:\s*100\.270 Mt \+ 3 Pcs/.test(t), 'print preview: 54.620 Mt per line; Total Quantity 100.270 Mt + 3 Pcs (different units are listed, never added together)', (t.match(/Total Quantity:?[^\n]{0,40}/g) || []).join('|'));
ok(/161,129\.00/.test(t), 'print preview line amount 161,129.00');

suite('Depot packing list (delivery note)');
const dctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const dc = (await login('depotA')).split('='); await dctx.addCookies([{ name: dc[0], value: dc[1], url: BASE }]);
const dp = await dctx.newPage(); dp.on('pageerror', (e) => errs.push(e.message));
await dp.goto(BASE + '/depot/pick', { waitUntil: 'load' }); await dp.waitForTimeout(2000);
const open = dp.getByText(inv.invoiceNumber || '', { exact: false }).first();
const found = inv.invoiceNumber && (await open.count());
if (found) { await open.click(); await dp.waitForTimeout(1200); const pt = await dp.locator('body').innerText(); ok(/54\.620 Mt/.test(pt), 'depot order screen shows Qty: 54.620 Mt', (pt.match(/Qty: [\d.]+( Mt)?/g) || []).join('|')); }
else ok(false, 'depot pick screen lists the order', `looked for ${inv.invoiceNumber}`);
ok(errs.length === 0, 'no uncaught page errors', errs.join('|'));
await b.close();
report(process.env.E2E_OUT);
