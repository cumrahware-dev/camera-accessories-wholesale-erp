// Customers / products / suppliers CRUD+search, service invoices, freight, reports, documents, backup, notifications,
// company settings, API sweep (no 5xx), bogus ids, and the role matrix enforced by the BACKEND.
import { login, call, ok, suite, report, blocked, near, BASE } from './lib.mjs';
const admin = await login('admin'), mgr = await login('manager'), erp = await login('erp'), dA = await login('depotA');
const U = Date.now().toString(36);

suite('Customers');
let r = await call(admin, 'POST', '/api/customers', { companyName: `E2E Co ${U}`, contactPerson: 'Tester', email: `e2e-${U}@example.com`, phone: '+971501234567', country: 'United Arab Emirates', billingAddress: 'Dubai', paymentTerms: 'NET_30' });
ok(r.s === 201 || r.s === 200, 'create customer', `${r.s} ${r.j.error || ''}`); const cust = r.j.customer || r.j;
r = await call(admin, 'POST', '/api/customers', { companyName: `E2E Co ${U}`, contactPerson: 'T', email: `e2e-${U}@example.com` }); ok(r.s === 409 || r.s === 400, 'duplicate e-mail refused', String(r.s));
r = await call(admin, 'POST', '/api/customers', { contactPerson: 'T', email: 'x@example.com' }); ok(r.s === 400, 'company name required');
r = await call(admin, 'POST', '/api/customers', { companyName: 'Bad', email: 'not-an-email' }); ok(r.s === 400, 'invalid e-mail refused', String(r.s));
r = await call(admin, 'POST', '/api/customers', { companyName: 'Neg', email: `n-${U}@example.com`, creditLimit: -1 }); ok(r.s === 400, 'negative credit limit refused', String(r.s));
r = await call(admin, 'GET', `/api/customers?q=E2E%20Co%20${U}`); const cl = r.j.customers || r.j; ok(Array.isArray(cl) && cl.length === 1, 'search finds the new customer', String(cl?.length));
r = await call(admin, 'PUT', `/api/customers/${cust.id}`, { ...cust, paymentTerms: 'NET_60', notes: 'edited' }); ok(r.s === 200, 'edit customer', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'GET', `/api/customers/${cust.id}`); ok(r.j.paymentTerms === 'NET_60', 'edit persisted');
r = await call(admin, 'GET', '/api/customers?limit=5&page=2'); ok(r.s === 200, 'pagination works');
r = await call(dA, 'GET', '/api/customers'); ok(r.s === 403, 'depot user cannot read customers', String(r.s));

suite('Products');
r = await call(admin, 'POST', '/api/products', { sku: `E2E-P-${U}`, name: `E2E Prod ${U}`, brand: 'E2EBrand2', sellingPrice: 123.45, wholesalePrice: 100, purchasePrice: 60, trackSerial: false });
ok(r.s === 201 || r.s === 200, 'create product', `${r.s} ${r.j.error || ''}`); const prod = r.j.product || r.j;
ok(near(prod.sellingPrice, 123.45) && prod.sku.toLowerCase() === `e2e-p-${U}`, 'product fields stored correctly');
r = await call(admin, 'POST', '/api/products', { sku: `E2E-N-${U}`, name: 'neg', brand: 'x', sellingPrice: -1 }); ok(r.s === 400, 'negative price refused', String(r.s));
r = await call(admin, 'PUT', `/api/products/${prod.id}`, { ...prod, sellingPrice: 150.5, name: `E2E Prod ${U} v2` }); ok(r.s === 200, 'edit product', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'GET', `/api/products/${prod.id}`); ok(near(r.j.sellingPrice ?? r.j.product?.sellingPrice, 150.5), 'price edit persisted');
r = await call(admin, 'GET', `/api/products?q=${encodeURIComponent('E2E Prod ' + U)}`); ok(r.j.length === 1, 'product search by name');
r = await call(admin, 'GET', '/api/products?status=ARCHIVED'); ok(r.s === 200 && r.j.every((p) => p.status === 'ARCHIVED'), 'status filter');
r = await call(admin, 'GET', '/api/products?limit=3&page=2'); ok(r.s === 200 && r.j.length <= 3, 'product pagination');
r = await call(admin, 'GET', '/api/products/export?format=csv'); ok(r.s === 200 && /sku/i.test(r.buf.toString().slice(0, 300)), 'catalogue export');
r = await call(dA, 'GET', '/api/products/export?format=csv'); ok(r.s === 403 || (r.s === 200 && !/Purchase|Cost/i.test(r.buf.toString().split('\n')[0])), 'depot user export (if allowed) carries no cost columns', String(r.s));
r = await call(dA, 'GET', '/api/products'); const dp = r.j.find?.((p) => p.purchasePrice !== undefined); ok(r.s === 200 && !dp, 'depot users never receive purchase cost', dp ? 'purchasePrice leaked' : '');

suite('Suppliers');
r = await call(admin, 'POST', '/api/suppliers', { name: `E2E Supplier ${U}`, contactPerson: 'S', email: `sup-${U}@example.com`, address: 'x', country: 'AE' }); ok(r.s === 201 || r.s === 200, 'create supplier'); const sup = r.j.supplier || r.j;
r = await call(admin, 'PUT', `/api/suppliers/${sup.id}`, { ...sup, contactPerson: 'S2' }); ok(r.s === 200, 'edit supplier', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'GET', `/api/suppliers?q=E2E%20Supplier%20${U}`); ok((r.j.suppliers || r.j).length === 1, 'supplier search');
r = await call(dA, 'GET', '/api/suppliers'); ok(r.s === 403, 'depot user cannot read suppliers', String(r.s));

suite('Service invoices (decimal-safe totals)');
const line = (description, quantity, unitPrice, discountPercent, taxRate) => ({ description, quantity, unitPrice, discountPercent, taxRate });
const cents = (x) => Math.round(x * 100);
// independent integer-cent expectation: 3 x 33.33 @ 10% discount, 7.5% tax ; 7 x 0.10 @ 0 disc, 5% tax
r = await call(admin, 'POST', '/api/service-invoices', { customerId: cust.id, items: [line('Repair A', 3, 33.33, 10, 7.5), line('Repair B', 7, 0.1, 0, 5)], otherCharges: 10.05, status: 'DRAFT' });
ok(r.s === 201 || r.s === 200, 'create service invoice', `${r.s} ${r.j.error || ''}`); const si = r.j.invoice || r.j;
const baseA = 3 * 33.33, netA = baseA * 0.9, taxA = netA * 0.075, baseB = 7 * 0.1, taxB = baseB * 0.05;
const expSub = cents(baseA) + cents(baseB), expTax = Math.round((taxA + taxB) * 100), expGrand = Math.round((netA + taxA + baseB + taxB + 10.05) * 100);
ok(cents(si.subtotal) === expSub, 'subtotal exact to the cent', `${si.subtotal} vs ${expSub / 100}`);
ok(Math.abs(cents(si.taxAmount) - expTax) <= 1 && Math.abs(cents(si.grandTotal) - expGrand) <= 1 && cents(si.grandTotal) === cents(si.subtotal) - cents(si.discountAmount) + cents(si.taxAmount) + cents(10.05), 'tax and grand total match an independent calculation', `${si.taxAmount}/${si.grandTotal} vs ${expTax / 100}/${expGrand / 100}`);
const par = await Promise.all([1, 2, 3, 4].map((i) => call(admin, 'POST', '/api/service-invoices', { customerId: cust.id, items: [line('Parallel ' + i, 1, 10, 0, 0)], status: 'DRAFT' })));
const nums = par.map((x) => (x.j.invoice || x.j).invoiceNumber);
ok(par.every((x) => x.s === 200 || x.s === 201) && new Set(nums).size === 4, '4 simultaneous service invoices get 4 distinct numbers', `${par.map((x) => x.s)} ${nums}`);
const del = par[0].j.invoice || par[0].j; await call(admin, 'DELETE', `/api/service-invoices/${del.id}`);
const nx = await call(admin, 'POST', '/api/service-invoices', { customerId: cust.id, items: [line('After delete', 1, 10, 0, 0)], status: 'DRAFT' });
ok((nx.s === 200 || nx.s === 201) && !nums.includes((nx.j.invoice || nx.j).invoiceNumber), 'a number is never reused after a deletion', `${nx.s} ${(nx.j.invoice || nx.j).invoiceNumber}`);
r = await call(admin, 'POST', '/api/service-invoices', { customerId: cust.id, items: [] }); ok(r.s === 400, 'no lines refused');
r = await call(admin, 'POST', '/api/service-invoices', { customerId: cust.id, items: [line('x', 0, 5, 0, 0)] }); ok(r.s === 400, 'zero quantity refused');
r = await call(admin, 'POST', '/api/service-invoices', { customerId: cust.id, items: [line('x', 1, 5, 120, 0)] }); ok(r.s === 400, 'discount over 100% refused');
r = await call(admin, 'GET', `/api/document-pdf/SERVICE_INVOICE/${si.id}`); ok(r.s === 200 && r.buf.slice(0, 4).toString() === '%PDF', 'service invoice PDF');
r = await call(admin, 'PATCH', `/api/service-invoices/${si.id}`, { status: 'ISSUED' }); ok(r.s === 200, 'issue service invoice', `${r.s} ${r.j.error || ''}`);
r = await call(dA, 'GET', '/api/service-invoices'); ok(r.s === 403, 'depot user cannot read service invoices', String(r.s));

suite('Freight, documents, notifications, settings, company');
r = await call(admin, 'POST', '/api/proformas', { customerId: cust.id, items: [{ productId: prod.id, quantity: 4, unitPrice: 150.5, discountPercent: 0, unitWeightKg: 2.5, lengthCm: 40, widthCm: 30, heightCm: 20, selectedDepotId: 'dep-central' }], freight: { volumetricDivisor: 5000, freightRatePerKg: 4, additionalFreightCharges: 10, isManualOverride: false } });
ok(r.s === 201, 'proforma with calculated freight', `${r.s} ${r.j.error || ''}`);
const vol = (40 * 30 * 20) / 5000 * 4, chargeable = Math.max(2.5 * 4, vol);
ok(near(r.j.chargeableWeightKg, chargeable, 0.05) && near(r.j.freightCharge, chargeable * 4, 0.05), 'chargeable weight = max(actual, volumetric); charge = weight x rate', `${r.j.chargeableWeightKg} ${r.j.freightCharge}`);
ok(near(r.j.shippingCost, chargeable * 4 + 10, 0.05), 'shipping = freight + additional charges', String(r.j.shippingCost));
for (const [p, n] of [['/api/documents', 'documents'], ['/api/notifications/logs', 'notification logs'], ['/api/settings', 'settings'], ['/api/company', 'company'], ['/api/tax-rates', 'tax rates'], ['/api/audit-logs', 'audit logs'], ['/api/email/templates', 'email templates']]) { r = await call(admin, 'GET', p); ok(r.s === 200, `${n} load`, String(r.s)); }
r = await call(admin, 'GET', '/api/audit-logs?limit=200'); const al = r.j.logs || r.j.items || r.j; ok(Array.isArray(al) && al.some((x) => /PROFORMA|INVOICE|PRODUCT|CUSTOMER/i.test(x.entityType || x.action || '')), 'audit log records business actions');
r = await call(admin, 'GET', '/api/company'); const co = r.j.company || r.j; r = await call(admin, 'PATCH', '/api/company', { tradingName: co.tradingName || 'E2E' }); ok([200, 400].includes(r.s), 'company update responds sanely', String(r.s));
r = await call(mgr, 'PATCH', '/api/company', { tradingName: 'hack' }); ok(r.s === 403, 'manager cannot change company details', String(r.s));
r = await call(dA, 'GET', '/api/company'); ok(r.s === 403, 'depot user cannot read company settings', String(r.s));

suite('Reports, exports and backup');
for (const p of ['/api/dashboard/stats', '/api/dashboard/overview', '/api/depot/overview?depotId=dep-central', '/api/inventory/export?format=csv', '/api/accounting/journal', '/api/accounting/heads', '/api/price-support/reports']) { r = await call(admin, 'GET', p); ok(r.s === 200, `report/export ${p}`, String(r.s)); }
r = await call(admin, 'POST', '/api/backup/export', { format: 'json' }); ok(r.s === 200 && r.buf.length > 1000, 'JSON backup export streams', `${r.s} ${r.buf.length}B`);
let parsed = null; try { parsed = JSON.parse(r.buf.toString()); } catch {} ok(!!parsed, 'backup is valid JSON'); 
ok(!/accessCodeHash|passwordHash/i.test(r.buf.toString().slice(0, 2_000_000)), 'backup contains no access-code / password hashes');
r = await call(admin, 'GET', '/api/backup'); ok(r.s === 200, 'backup history');
r = await call(admin, 'GET', '/api/backup/db-dump'); /* POST-only */ ok([200, 403, 404, 405, 501].includes(r.s), 'database dump endpoint answers', String(r.s));
blocked('Database restore', 'the ERP has no restore endpoint/UI; restore is an operator task from the DB dump');

suite('API sweep: no 5xx on any list endpoint, bogus ids give 404 (never 500)');
const lists = ['/api/customers', '/api/products', '/api/suppliers', '/api/proformas', '/api/invoices', '/api/service-invoices', '/api/shipments', '/api/purchase-invoices', '/api/price-support', '/api/ocr-documents', '/api/depots', '/api/depot-users', '/api/users', '/api/inventory/serials', '/api/inventory/transfers', '/api/inventory/adjustments', '/api/search?q=e2e', '/api/serials', '/api/email/logs?type=PROFORMA&id=none', '/api/perf-stats', '/api/cloudinary/health'];
for (const p of lists) { r = await call(admin, 'GET', p); ok(r.s < 500, `GET ${p}`, String(r.s)); }
for (const p of ['customers', 'products', 'suppliers', 'proformas', 'invoices', 'service-invoices', 'shipments', 'purchase-invoices', 'ocr-documents', 'depots', 'users']) { r = await call(admin, 'GET', `/api/${p}/does-not-exist`); ok(r.s === 404 || r.s === 400, `GET /api/${p}/<bogus id> -> 404`, String(r.s)); }
r = await call(admin, 'POST', '/api/proformas', undefined, { 'content-type': 'application/json' }); ok(r.s >= 400 && r.s < 500, 'POST with empty body is a 4xx, not a crash', String(r.s));
const rawBad = await fetch(BASE + '/api/customers', { method: 'POST', headers: { cookie: admin, 'content-type': 'application/json' }, body: '{bad json' }); ok(rawBad.status >= 400 && rawBad.status < 500, 'malformed JSON is a 4xx', String(rawBad.status));

suite('Role matrix enforced by the backend');
const matrix = [
  // [method, path, body, {admin, manager, erp, depot}]
  ['GET', '/api/users', undefined, [200, 403, 403, 403]],
  ['POST', '/api/users', { name: 'x' }, [400, 403, 403, 403]],
  ['GET', '/api/backup', undefined, [200, 403, 403, 403]],
  ['GET', '/api/audit-logs', undefined, [200, 200, 403, 403]],
  ['GET', '/api/accounting/journal', undefined, [200, 200, 403, 403]],
  ['GET', '/api/purchase-invoices', undefined, [200, 200, 200, 403]],
  ['GET', '/api/customers', undefined, [200, 200, 200, 403]],
  ['GET', '/api/proformas', undefined, [200, 200, 200, 403]],
  ['GET', '/api/shipments', undefined, [200, 200, 200, 200]],
  ['GET', '/api/depots', undefined, [200, 200, 200, 200]],
  ['POST', '/api/depots', { name: 'x' }, [400, 403, 403, 403]],
  ['GET', '/api/ocr-documents', undefined, [200, 200, 200, 403]],
];
for (const [m, p, b, exp] of matrix) {
  const got = []; for (const ck of [admin, mgr, erp, dA]) got.push((await call(ck, m, p, b)).s);
  ok(got.every((s, i) => (exp[i] === 200 ? s === 200 : exp[i] === 403 ? s === 403 : s >= 400 && s < 500 && s !== 403)), `${m} ${p} admin/manager/erp/depot`, `expected ${exp} got ${got}`);
}
report(process.env.E2E_OUT);
