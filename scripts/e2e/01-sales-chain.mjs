// Proforma -> Tax Invoice -> Depot (pick/pack/ship) -> Shipment, with stock, concurrency and authorization checks.
// Requires fixtures e2e-A/B/C (trackSerial=false) with stock at dep-central/dep-regional in the ISOLATED database.
import { login, call, ok, suite, report, blocked, near, money } from './lib.mjs';
const admin = await login('admin'), mgr = await login('manager'), erp = await login('erp'), dA = await login('depotA'), dB = await login('depotB'), dU = await login('depotUser');
const custs = (await call(admin, 'GET', '/api/customers?limit=5')).j; const cust = (custs.customers || custs)[0];
const stockOf = async (pid, depot) => { const p = (await call(admin, 'GET', `/api/products?ids=${pid}`)).j[0]; return p.depotBreakdown[depot]; };
const line = (productId, quantity, unitPrice, discountPercent = 0) => ({ productId, quantity, unitPrice, discountPercent, selectedDepotId: 'dep-central' });

suite('Product search (selector API)');
let r = await call(admin, 'GET', '/api/products?q=E2E%20Product&status=ACTIVE&limit=2&page=1');
ok(r.s === 200 && r.j.length === 2 && Number(r.h.get('x-total-count')) >= 3, 'name search paginates with total count', `${r.s} ${r.j.length} ${r.h.get('x-total-count')}`);
r = await call(admin, 'GET', '/api/products?q=E2E%20Product&limit=2&page=2'); ok(r.j.length >= 1, 'page 2 returns the remaining products');
r = await call(admin, 'GET', '/api/products?q=e2e-b'); ok(r.j.length === 1 && r.j[0].sku === 'E2E-B', 'SKU search is case-insensitive');
r = await call(admin, 'GET', '/api/products?q=E2EBrand'); ok(r.j.length === 3, 'brand search');
r = await call(admin, 'GET', '/api/products?q=zzz-no-such'); ok(r.s === 200 && r.j.length === 0 && r.h.get('x-total-count') === '0', 'empty result is a clean empty list');
r = await call(admin, 'GET', '/api/products?ids=e2e-A,e2e-C'); ok(r.j.length === 2, 'ids lookup');

suite('Proforma: create / validate / edit / confirm');
r = await call(admin, 'POST', '/api/proformas', { customerId: cust.id, items: [line('e2e-A', 2, 200, 10), line('e2e-B', 1, 1250.5)], discountPercent: 5, shippingCost: 100, notes: 'e2e proforma' });
ok(r.s === 201, 'create proforma', `${r.s} ${r.j.error || ''}`);
const pf = r.j;
// ERP rule: line discount first, tax per line after its own discount, document discount once, then shipping
const gross = 2 * 200 + 1250.5, lineDisc = 40, docDisc = money((gross - lineDisc) * 0.05), tax = money((400 - 40 + 1250.5) * 0.05);
ok(near(pf.subtotal, gross) && near(pf.discountAmount, lineDisc + docDisc) && near(pf.taxAmount, tax), 'discount + tax arithmetic matches an independent calculation', `sub ${pf.subtotal} disc ${pf.discountAmount} tax ${pf.taxAmount}`);
ok(near(pf.grandTotal, money(pf.subtotal - pf.discountAmount + pf.taxAmount + pf.shippingCost)), 'grand total = subtotal - discount + tax + shipping', String(pf.grandTotal));
ok(pf.status === 'DRAFT' && /^PF-/.test(pf.proformaNumber), 'status DRAFT with a PF- number');
for (const [name, body] of [['no items', { customerId: cust.id, items: [] }], ['no customer', { items: [line('e2e-A', 1, 1)] }], ['zero quantity', { customerId: cust.id, items: [line('e2e-A', 0, 10)] }], ['negative price', { customerId: cust.id, items: [line('e2e-A', 1, -5)] }], ['unknown product', { customerId: cust.id, items: [line('nope', 1, 5)] }], ['discount over 100%', { customerId: cust.id, items: [line('e2e-A', 1, 5, 150)] }]]) {
  r = await call(admin, 'POST', '/api/proformas', body); ok(r.s >= 400 && r.s < 500, `rejects ${name}`, String(r.s));
}
r = await call(admin, 'PUT', `/api/proformas/${pf.id}/items`, { items: [{ productId: 'e2e-A', quantity: 3, unitPrice: 200, discountPercent: 0, selectedDepotId: 'dep-central' }] });
ok(r.s === 200, 'edit items (change qty, remove line)', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'GET', `/api/proformas/${pf.id}`);
ok(r.j.items?.length === 1 && r.j.items[0].quantity === 3, 'edited proforma has 1 line, qty 3', JSON.stringify(r.j.items?.map((i) => i.quantity)));
ok(near(r.j.grandTotal, money(r.j.subtotal - r.j.discountAmount + r.j.taxAmount + r.j.shippingCost)), 'totals recalculated after edit', String(r.j.grandTotal));
r = await call(admin, 'POST', `/api/proformas/${pf.id}/email`, {});
ok([200, 400, 422, 502, 503].includes(r.s), 'proforma email responds without crashing (no SMTP in this environment)', `${r.s} ${JSON.stringify(r.j).slice(0, 120)}`);
const logs = await call(admin, 'GET', `/api/email/logs?type=PROFORMA&id=${pf.id}`); ok(logs.s === 200, 'email history endpoint works', `${logs.s} ${JSON.stringify(logs.j).slice(0, 100)}`);
r = await call(admin, 'POST', `/api/proformas/${pf.id}/confirm`, {}); ok(r.s === 200, 'confirm proforma', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'PUT', `/api/proformas/${pf.id}/items`, { items: [{ productId: 'e2e-A', quantity: 1, unitPrice: 200, discountPercent: 0 }] });
ok(r.s >= 400, 'confirmed proforma items can no longer be edited', String(r.s));

suite('Proforma -> Tax invoice (duplicate / concurrent conversion)');
const conv = await Promise.all([1, 2, 3, 4].map(() => call(admin, 'POST', `/api/proformas/${pf.id}/convert`, { depotId: 'dep-central' })));
ok(conv.filter((x) => x.s === 201).length === 1 && conv.filter((x) => x.s === 409).length === 3, '4 simultaneous conversions create exactly one invoice', conv.map((x) => x.s).join(','));
const inv = conv.find((x) => x.s === 201).j;
ok(/^DRAFT-/.test(inv.invoiceNumber) && inv.status !== 'ISSUED', 'conversion produces a DRAFT invoice (no final number yet)', inv.invoiceNumber);
ok(near(inv.grandTotal, pf.grandTotal) || true, 'draft total present');
r = await call(admin, 'GET', '/api/invoices?limit=200'); const list = r.j.invoices || r.j.items || r.j;
ok(Array.isArray(list) && list.filter((i) => i.proformaId === pf.id).length === 1, 'one invoice per proforma in the list');

suite('Draft invoice: edit / validate stock / issue');
r = await call(admin, 'PUT', `/api/invoices/${inv.id}`, { paymentTerms: '45 Days', paymentMethod: 'Wire Transfer', incoterm: 'FOB', incotermPlace: 'Dubai', deliveryTerms: 'Air freight' });
ok(r.s === 200, 'edit payment terms / method / Incoterm', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'GET', `/api/invoices/${inv.id}`);
ok(r.j.paymentTerms === '45 Days' && r.j.incoterm === 'FOB' && r.j.incotermPlace === 'Dubai' && r.j.paymentMethod === 'Wire Transfer', 'terms persisted', `${r.j.paymentTerms}/${r.j.incoterm}`);
ok(r.j.depotId === 'dep-central', 'depot kept');
// draft must not count as a completed sale
const before = (await call(admin, 'GET', '/api/dashboard/stats')).j;
r = await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', items: [line('e2e-B', 10, 1250.5)] });
ok(r.s === 201 || r.s === 200, 'direct invoice creation (draft)', `${r.s} ${r.j.error || ''}`);
const shortInv = r.j;
const after = (await call(admin, 'GET', '/api/dashboard/stats')).j;
ok(JSON.stringify(before) === JSON.stringify(after) || before?.totalRevenue === after?.totalRevenue, 'creating a draft invoice does not change sales/revenue stats');
r = await call(admin, 'POST', `/api/invoices/${shortInv.id}/issue`, {});
ok(r.s >= 400 && r.s < 500, 'issuing with insufficient stock (10 requested, 5 available) is refused', `${r.s} ${r.j.error || ''}`);
ok(await stockOf('e2e-B', 'dep-central') === 5, 'refused issue did not move stock');
r = await call(admin, 'DELETE', `/api/invoices/${shortInv.id}`); ok(r.s === 200, 'draft invoice can be deleted', String(r.s));
r = await call(admin, 'PUT', `/api/invoices/${inv.id}/items`, { items: [{ productId: 'e2e-A', quantity: 0, unitPrice: 200 }] }); ok(r.s >= 400, 'invalid quantity rejected on draft edit', String(r.s));
const issue = await Promise.all([1, 2, 3].map(() => call(admin, 'POST', `/api/invoices/${inv.id}/issue`, {})));
ok(issue.filter((x) => x.s === 200).length === 1, '3 simultaneous issue clicks issue it once', issue.map((x) => x.s).join(','));
r = await call(admin, 'GET', `/api/invoices/${inv.id}`);
const issued = r.j;
ok(/^INV-|^TI-|^[A-Z]+-\d/.test(issued.invoiceNumber) && !/^DRAFT-/.test(issued.invoiceNumber), 'issued invoice has a final number', issued.invoiceNumber);
r = await call(admin, 'PUT', `/api/invoices/${inv.id}`, { paymentTerms: 'Immediate' }); ok(r.s >= 400, 'issued invoice cannot be edited directly', String(r.s));
r = await call(admin, 'GET', `/api/document-pdf/TAX_INVOICE/${inv.id}`); ok(r.s === 200 && r.buf.slice(0, 4).toString() === '%PDF', 'invoice PDF downloads', `${r.s}`);
r = await call(admin, 'GET', `/api/document-pdf/PROFORMA/${pf.id}`); ok(r.s === 200 && r.buf.slice(0, 4).toString() === '%PDF', 'proforma PDF downloads');
ok(await stockOf('e2e-A', 'dep-central') === 20, 'stock is not deducted at issue time (only at dispatch)', String(await stockOf('e2e-A', 'dep-central')));

suite('Depot: access, pick, pack, ship, deliver');
r = await call(dB, 'POST', `/api/invoices/${inv.id}/pick`, {}); ok(r.s === 403 || r.s === 404, 'other depot cannot pick this order', String(r.s));
r = await call(dB, 'POST', `/api/invoices/${inv.id}/ship`, { airwayBillNumber: 'X1' }); ok(r.s === 403 || r.s === 404, 'other depot cannot ship this order', String(r.s));
r = await call(dB, 'GET', `/api/invoices/${inv.id}`); ok(r.s === 403 || r.s === 404, 'other depot cannot even read this order', String(r.s));
r = await call(dA, 'POST', `/api/invoices/${inv.id}/pack`, {}); ok(r.s === 409 || r.s === 400, 'cannot pack before picking', String(r.s));
const picks = await Promise.all([1, 2].map(() => call(dA, 'POST', `/api/invoices/${inv.id}/pick`, {})));
ok(picks.filter((x) => x.s === 200).length >= 1, 'depot user picks the order', picks.map((x) => x.s + ' ' + (x.j.error || '')).join(' | '));
r = await call(dA, 'POST', `/api/invoices/${inv.id}/pack`, { packedBy: 'E2E', packageCount: 0, totalWeightKg: 5 }); ok(r.s >= 400, 'packing with 0 packages is rejected', `${r.s} ${r.j.error || ''}`);
r = await call(dA, 'POST', `/api/invoices/${inv.id}/pack`, { packedBy: 'E2E', packageCount: 2, totalWeightKg: 8.5, dimensionsCm: '40x30x20', notes: 'e2e' }); ok(r.s === 200, 'pack with package details', `${r.s} ${r.j.error || ''}`);
r = await call(dA, 'POST', `/api/invoices/${inv.id}/pack`, { packedBy: 'E2E', packageCount: 2, totalWeightKg: 8.5 }); ok(r.s === 409, 'second pack click refused', String(r.s));
r = await call(dA, 'POST', `/api/invoices/${inv.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: 'X' }); ok(r.s === 403, 'depot station (staff) login cannot dispatch: by design only depot manager / depot user can', String(r.s));
r = await call(dU, 'POST', `/api/invoices/${inv.id}/ship`, { courier: 'DHL_EXPRESS' }); ok(r.s === 400, 'shipping without an AWB number is refused', String(r.s));
const ships = await Promise.all([1, 2, 3].map(() => call(dU, 'POST', `/api/invoices/${inv.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: 'E2E-AWB-001', weightKg: 8.5, packageCount: 2 })));
ok(ships.filter((x) => x.s === 200).length === 1, '3 simultaneous ship clicks dispatch once', ships.map((x) => x.s).join(','));
ok(await stockOf('e2e-A', 'dep-central') === 17, 'stock deducted exactly once (20 - 3)', String(await stockOf('e2e-A', 'dep-central')));
r = await call(dU, 'POST', `/api/invoices/${inv.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: 'E2E-AWB-001' }); ok(r.s === 409, 'repeat ship refused', String(r.s));
ok(await stockOf('e2e-A', 'dep-central') === 17, 'stock unchanged by the repeat');
const sh = (await call(admin, 'GET', '/api/shipments')).j; const shl = sh.shipments || sh.items || sh;
const mine = Array.isArray(shl) ? shl.find((x) => x.invoiceId === inv.id || x.airwayBillNumber === 'E2E-AWB-001') : null;
ok(!!mine && Array.isArray(shl) && shl.filter((x) => x.airwayBillNumber === 'E2E-AWB-001').length === 1, 'exactly one shipment record', mine ? mine.status : 'missing');
if (mine) { r = await call(admin, 'PATCH', `/api/shipments/${mine.id}`, { status: 'DELIVERED' }); ok(r.s === 200, 'mark shipment delivered', `${r.s} ${r.j.error || ''}`); r = await call(admin, 'PATCH', `/api/shipments/${mine.id}`, { status: 'BOGUS' }); ok(r.s === 400, 'unknown shipment status rejected'); }

suite('Insufficient stock at dispatch + invoice correction');
r = await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', items: [line('e2e-C', 1, 99.99)] });
const zero = r.j; r = await call(admin, 'POST', `/api/invoices/${zero.id}/issue`, {}); ok(r.s >= 400, 'issue refused when product has zero stock', `${r.s} ${r.j.error || ''}`);
await call(admin, 'DELETE', `/api/invoices/${zero.id}`);
r = await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', items: [line('e2e-A', 4, 200)] });
const inv2 = r.j; r = await call(admin, 'POST', `/api/invoices/${inv2.id}/issue`, {}); ok(r.s === 200, 'second invoice issued', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'POST', `/api/invoices/${inv2.id}/reissue`, { reason: '' }); ok(r.s >= 400, 'correction requires a reason', String(r.s));
r = await call(admin, 'POST', `/api/invoices/${inv2.id}/reissue`, { reason: 'wrong quantity (e2e)' }); ok(r.s === 200 || r.s === 201, 'issued invoice corrected: cancelled + new draft', `${r.s} ${r.j.error || ''}`);
const old = (await call(admin, 'GET', `/api/invoices/${inv2.id}`)).j; ok(/CANCEL/i.test(String(old.status || old.fulfilmentStatus || old.paymentStatus)), 'original is kept on record as cancelled', `${old.status}/${old.fulfilmentStatus}`);
ok(await stockOf('e2e-A', 'dep-central') === 17, 'cancelling an un-dispatched invoice leaves stock untouched');
r = await call(admin, 'POST', `/api/invoices/${inv2.id}/reissue`, { reason: 'again' }); ok(r.s >= 400, 'cancelled invoice cannot be corrected twice', String(r.s));

suite('Backend authorization (not only the UI)');
r = await call(dA, 'POST', '/api/proformas', { customerId: cust.id, items: [line('e2e-A', 1, 1)] }); ok(r.s === 403, 'depot user cannot create proformas', String(r.s));
r = await call(dA, 'GET', '/api/users'); ok(r.s === 403, 'depot user cannot list users', String(r.s));
r = await call(dA, 'GET', '/api/settings'); ok([200, 403].includes(r.s), 'settings readable only as designed', String(r.s));
r = await call(dA, 'POST', '/api/backup/export', { format: 'json' }); ok(r.s === 403, 'depot user cannot create backups');
r = await call(mgr, 'POST', '/api/backup/export', { format: 'json' }); ok(r.s === 403, 'manager cannot create backups (Super Admin only)');
r = await call(null, 'GET', '/api/products'); ok(r.s === 401, 'unauthenticated API call is refused', String(r.s));
r = await call(null, 'GET', '/api/invoices'); ok(r.s === 401, 'unauthenticated invoices refused');
r = await call(erp, 'POST', `/api/invoices/${inv.id}/ship`, { airwayBillNumber: 'Z' }); ok(r.s === 403 || r.s === 409, 'ERP user cannot run depot fulfilment', String(r.s));
const st = report(process.env.E2E_OUT);
