// Decimal quantities end to end with the reference Leiden Building Materials invoice (Gi Sheet, Mt, AED 2,950.00 per Mt):
// units, validation, purchase receipt, stock, proforma, conversion, invoice, PDF, depot pick/pack/ship, transfers, adjustments.
import { execFileSync } from 'child_process';
import fs from 'fs';
import { login, call, ok, suite, report, near, BASE } from './lib.mjs';
const admin = await login('admin'), dU = await login('depotUser'), dA = await login('depotA');
const U = Date.now().toString(36).toUpperCase();
const REF = [['1.1', 54.62], ['1.5', 45.65], ['1.7', 55.2], ['1.8', 60.21], ['1.3', 45.96]];
const AMOUNTS = [161129.0, 134667.5, 162840.0, 177619.5, 135582.0];
const RATE = 2950;
const pdfText = (buf) => { const f = process.env.E2E_TMP + '/dq.pdf'; fs.writeFileSync(f, buf); return execFileSync('python3', ['-I', '-c', 'import pymupdf,sys;d=pymupdf.open(sys.argv[1]);print("\\n".join(p.get_text() for p in d))', f]).toString(); };
const stock = async (id, depot) => (await call(admin, 'GET', `/api/products?ids=${id}`)).j[0].depotBreakdown[depot];
const total = async (id) => (await call(admin, 'GET', `/api/products?ids=${id}`)).j[0].totalStock;

suite('Units of measure');
let r = await call(admin, 'GET', '/api/units');
const units = r.j; const dp = (c) => units.find((u) => u.code === c)?.decimals;
ok(r.s === 200 && dp('Pcs') === 0 && dp('Mt') === 3 && dp('Kg') === 3 && dp('Tonnes') === 3 && dp('Meters') === 2 && dp('Sq.m') === 2 && dp('Cu.m') === 3, 'Pcs, Mt, Kg, Tonnes, Meters, Sq.m, Cu.m are configured with their decimals', JSON.stringify(units.map((u) => u.code + ':' + u.decimals)));
r = await call(admin, 'POST', '/api/units', { code: 'Roll' + U.slice(-3), name: 'Rolls (e2e)', decimals: 1 }); ok(r.s === 201, 'a new unit can be added (Super Admin)', String(r.s));
r = await call(admin, 'POST', '/api/units', { code: 'Bad', name: 'x', decimals: 7 }); ok(r.s === 400, 'more than 3 decimals refused');
r = await call(dA, 'POST', '/api/units', { code: 'X1', name: 'x', decimals: 0 }); ok(r.s === 403, 'depot user cannot add units', String(r.s));

suite('Products sold by weight');
const pids = [];
for (const [i, [gauge]] of REF.entries()) {
  r = await call(admin, 'POST', '/api/products', { sku: `GI-${U}-${gauge}`, name: `Gi Sheet 1220x2440x${gauge}mm`, brand: 'LBM', unit: 'mt', sellingPrice: RATE, wholesalePrice: RATE, purchasePrice: 2000, useDefaultTax: false, taxRate: 5, trackSerial: true });
  if (i === 0) ok(r.s === 400 && /Serial/.test(r.j.error || ''), 'serial tracking refused for a product sold in Mt', `${r.s} ${r.j.error || ''}`);
  r = await call(admin, 'POST', '/api/products', { sku: `GI-${U}-${gauge}`, name: `Gi Sheet 1220x2440x${gauge}mm`, brand: 'LBM', unit: 'mt', sellingPrice: RATE, wholesalePrice: RATE, purchasePrice: 2000, useDefaultTax: false, taxRate: 5 });
  ok(r.s === 201, `create product Gi Sheet ${gauge}mm in Mt`, `${r.s} ${r.j.error || ''}`);
  const p = r.j.product || r.j; pids.push(p.id);
  if (i === 0) ok(p.unit === 'Mt' && p.trackSerial === false, 'unit normalised to "Mt"; serial tracking switched off', `${p.unit} ${p.trackSerial}`);
}
r = await call(admin, 'POST', '/api/products', { sku: `BAD-${U}`, name: 'x', brand: 'x', unit: 'Parsecs' }); ok(r.s === 400, 'unknown unit refused', String(r.s));
r = await call(admin, 'POST', '/api/products', { sku: `PCS-${U}`, name: 'Pcs product', brand: 'x', unit: 'Pcs', trackSerial: false, sellingPrice: 10, depotBreakdown: { 'dep-central': 2.5 } }); ok(r.s === 400, 'opening stock 2.5 refused for a Pcs product', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'POST', '/api/products', { sku: `PCS-${U}`, name: 'Pcs product', brand: 'x', unit: 'Pcs', trackSerial: false, sellingPrice: 10, wholesalePrice: 10, purchasePrice: 5 }); const pcs = (r.j.product || r.j).id; ok(r.s === 201, 'create a Pcs product');

suite('Purchase and stock receipt with fractions');
r = await call(admin, 'GET', '/api/suppliers?limit=1'); let sup = (r.j.suppliers || r.j)[0];
const RECV = [60.0, 50.125, 60.0, 65.5, 50.0];
r = await call(admin, 'POST', '/api/purchase-invoices', { supplierId: sup.id, supplierInvoiceNumber: `DQ-${U}`, invoiceDate: '2026-10-20', depotId: 'dep-central', currency: 'USD', items: pids.map((id, i) => ({ productId: id, quantity: RECV[i], unitCost: 2000, taxRate: 5 })) });
ok(r.s === 201 || r.s === 200, 'draft purchase invoice with decimal quantities (60, 50.125 ...)', `${r.s} ${r.j.error || ''}`); const pi = r.j;
ok(pi.items?.[1] && Number(pi.items[1].quantity) === 50.125 && pi.items[1].unit === 'Mt', 'saved with 50.125 Mt (nothing rounded)', JSON.stringify(pi.items?.[1]?.quantity));
ok(near(pi.subtotal, RECV.reduce((s, q) => s + q * 2000, 0)), 'purchase subtotal is exact', String(pi.subtotal));
r = await call(admin, 'POST', '/api/purchase-invoices', { supplierId: sup.id, supplierInvoiceNumber: `DQ2-${U}`, invoiceDate: '2026-10-20', depotId: 'dep-central', items: [{ productId: pcs, quantity: 1.5, unitCost: 5 }] }); ok(r.s === 400, 'purchase of 1.5 Pcs refused', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'POST', '/api/purchase-invoices', { supplierId: sup.id, supplierInvoiceNumber: `DQ3-${U}`, invoiceDate: '2026-10-20', depotId: 'dep-central', items: [{ productId: pids[0], quantity: 1.2345, unitCost: 5 }] }); ok(r.s === 400, 'purchase with 4 decimals refused', `${r.s} ${r.j.error || ''}`);
const before = await Promise.all(pids.map((id) => stock(id, 'dep-central')));
r = await call(admin, 'POST', `/api/purchase-invoices/${pi.id}/post`, {}); ok(r.s === 200, 'post the purchase invoice', `${r.s} ${r.j.error || ''}`);
const after = await Promise.all(pids.map((id) => stock(id, 'dep-central')));
ok(after.every((a, i) => near(a - before[i], RECV[i], 0.0005)) && after[1] === 50.125, 'stock received exactly (50.125 Mt in the depot)', JSON.stringify(after));
ok((await total(pids[1])) === 50.125, 'product total stock equals the depot stock');
const posted = (await call(admin, 'GET', `/api/purchase-invoices/${pi.id}`)).j; const jl = posted.journal?.lines || [];
ok(near(jl.reduce((s, l) => s + l.debit - l.credit, 0), 0, 0.005), 'journal balanced');

suite('Quotation / proforma with the reference quantities');
const custs = (await call(admin, 'GET', '/api/customers?limit=1')).j; const cust = (custs.customers || custs)[0];
const body = { customerId: cust.id, notes: 'Leiden Building Materials reference', items: REF.map(([g, q], i) => ({ productId: pids[i], quantity: q, unitPrice: RATE, discountPercent: 0, selectedDepotId: 'dep-central' })) };
r = await call(admin, 'POST', '/api/proformas', { ...body, items: [{ ...body.items[0], quantity: 54.6205 }] }); ok(r.s === 400, '54.6205 (4 decimals) is refused', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'POST', '/api/proformas', { ...body, items: [{ ...body.items[0], quantity: 0 }] }); ok(r.s === 400, 'zero quantity refused');
r = await call(admin, 'POST', '/api/proformas', { ...body, items: [{ ...body.items[0], quantity: -3 }] }); ok(r.s === 400, 'negative quantity refused');
r = await call(admin, 'POST', '/api/proformas', { ...body, items: [{ ...body.items[0], quantity: 'abc' }] }); ok(r.s === 400, 'non-numeric quantity refused');
r = await call(admin, 'POST', '/api/proformas', { ...body, items: [{ productId: pcs, quantity: 2.5, unitPrice: 10, selectedDepotId: 'dep-central' }] }); ok(r.s === 400, '2.5 Pcs refused (whole-piece unit)', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'POST', '/api/proformas', body); ok(r.s === 201, 'create the proforma with 54.620 / 45.650 / 55.200 / 60.210 / 45.960 Mt', `${r.s} ${r.j.error || ''}`);
const pf = r.j;
const lines = (await call(admin, 'GET', `/api/proformas/${pf.id}`)).j;
ok(lines.items.map((i) => Number(i.quantity)).join() === REF.map((x) => x[1]).join(), 'reopened proforma has the exact quantities', lines.items.map((i) => i.quantity).join());
ok(lines.items.every((i) => i.unit === 'Mt'), 'every line carries the unit Mt');
ok(lines.items.every((i, k) => near(i.totalPrice, AMOUNTS[k] * 1.05, 0.006)), 'line amounts: qty x 2,950.00 (+5% VAT) = 161,129.00 / 134,667.50 / 162,840.00 / 177,619.50 / 135,582.00 before VAT', lines.items.map((i) => i.totalPrice).join());
ok(near(lines.subtotal, 771838.0, 0.0001) && near(lines.taxAmount, 38591.9, 0.0001) && near(lines.grandTotal, 810429.9, 0.0001), 'subtotal 771,838.00; VAT 38,591.90; grand total 810,429.90', `${lines.subtotal}/${lines.taxAmount}/${lines.grandTotal}`);
// edit keeps precision: change one quantity and back
r = await call(admin, 'PUT', `/api/proformas/${pf.id}/items`, { items: lines.items.map((i, k) => ({ id: i.id, productId: i.productId, quantity: k === 0 ? 54.62 : Number(i.quantity), unitPrice: i.unitPrice })) }); ok(r.s === 200, 'edit the quotation (same quantities) without losing precision', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'PUT', `/api/proformas/${pf.id}/items`, { items: lines.items.map((i, k) => ({ id: i.id, productId: i.productId, quantity: k === 0 ? '54.6200' : Number(i.quantity), unitPrice: i.unitPrice })) }); ok(r.s === 400 || r.s === 200, 'trailing zeros in input are tolerated or refused clearly', String(r.s));
const again = (await call(admin, 'GET', `/api/proformas/${pf.id}`)).j; ok(near(again.subtotal, 771838.0, 0.0001) && near(again.taxAmount, 38591.9, 0.0001) && near(again.grandTotal, 810429.9, 0.0001) && Number(again.items[0].quantity) === 54.62, 'totals unchanged after the edit', String(again.grandTotal));
r = await call(admin, 'GET', `/api/document-pdf/PROFORMA/${pf.id}`); ok(r.s === 200, 'proforma PDF generated'); let txt = pdfText(r.buf);
ok(/54\.620 Mt/.test(txt) && /45\.650 Mt/.test(txt) && /55\.200 Mt/.test(txt) && /60\.210 Mt/.test(txt) && /45\.960 Mt/.test(txt), 'proforma PDF prints 54.620 Mt, 45.650 Mt, 55.200 Mt, 60.210 Mt, 45.960 Mt (trailing zeros kept)', txt.match(/\d+\.\d+ Mt/g)?.join(','));
ok(/261\.640 Mt/.test(txt), 'proforma PDF prints the total quantity 261.640 Mt');

suite('Proforma -> Tax invoice -> PDF -> depot');
r = await call(admin, 'POST', `/api/proformas/${pf.id}/confirm`, {}); ok(r.s === 200, 'confirm');
r = await call(admin, 'POST', `/api/proformas/${pf.id}/convert`, { depotId: 'dep-central' }); ok(r.s === 201, 'convert to a draft tax invoice', `${r.s} ${r.j.error || ''}`); const inv = r.j;
let g = (await call(admin, 'GET', `/api/invoices/${inv.id}`)).j;
ok(g.items.map((i) => Number(i.quantity)).join() === REF.map((x) => x[1]).join() && g.items.every((i) => i.unit === 'Mt'), 'the draft invoice has the same quantities and units');
ok(near(g.taxAmount, 38591.9, 0.0001) && near(g.grandTotal, 810429.9, 0.0001), 'invoice VAT 38,591.90 and grand total 810,429.90 (exact)', String(g.grandTotal));
r = await call(admin, 'POST', `/api/invoices/${inv.id}/issue`, {}); ok(r.s === 200, 'issue the invoice (stock checked with decimals)', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'GET', `/api/document-pdf/TAX_INVOICE/${inv.id}`); txt = pdfText(r.buf);
ok(/Mt\s+54\.620\b/.test(txt) && /Total Quantity: 261\.640 Mt/.test(txt), 'tax invoice PDF shows 54.620 (unit column Mt) and Total Quantity: 261.640 Mt', (txt.match(/Total Quantity[^\n]*/) || [''])[0]);
const wantTotals = ['161,129.00', '134,667.50', '162,840.00', '177,619.50', '135,582.00', '771,838.00', '38,591.90', '810,429.90'];
const missingAmt = wantTotals.filter((t) => !txt.includes(t));
ok(missingAmt.length === 0, 'tax invoice PDF shows line amounts 161,129.00 ... 135,582.00, subtotal 771,838.00, VAT 38,591.90, grand total 810,429.90', `missing: ${missingAmt.join(', ')} | totals block: ${txt.split('\n').filter((x) => /subtotal|vat|tax|total/i.test(x)).slice(0, 14).join(' / ')}`);
ok((await Promise.all(pids.map((id) => stock(id, 'dep-central')))).every((s, i) => s === after[i]), 'issuing does not move stock');
const picks = await call(dA, 'POST', `/api/invoices/${inv.id}/pick`, {}); ok(picks.s === 200, 'pick', `${picks.s} ${picks.j.error || ''}`);
r = await call(dA, 'POST', `/api/invoices/${inv.id}/pack`, { packedBy: 'E2E', packageCount: 5, totalWeightKg: 261640 }); ok(r.s === 200, 'pack', `${r.s} ${r.j.error || ''}`);
const ships = await Promise.all([1, 2].map(() => call(dU, 'POST', `/api/invoices/${inv.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: 'DQ-AWB-' + U })));
ok(ships.filter((x) => x.s === 200).length === 1, 'two simultaneous ship clicks dispatch once', ships.map((x) => x.s).join());
const now = await Promise.all(pids.map((id) => stock(id, 'dep-central')));
ok(now.every((s, i) => near(s, after[i] - REF[i][1], 0.0005)), 'stock deducted by the exact decimal quantity, once', JSON.stringify({ was: after, now }));
ok(now[1] === 4.475, '50.125 - 45.650 = 4.475 Mt left (no float noise)', String(now[1]));
ok((await total(pids[1])) === 4.475, 'product total stock updated too');

suite('Insufficient stock with decimals');
r = await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', items: [{ productId: pids[1], quantity: 4.476, unitPrice: RATE }] });
const dr = r.j; r = await call(admin, 'POST', `/api/invoices/${dr.id}/issue`, {}); ok(r.s >= 400 && /stock/i.test(r.j.error || ''), '4.476 Mt requested, 4.475 available: refused', `${r.s} ${r.j.error || ''}`);
await call(admin, 'DELETE', `/api/invoices/${dr.id}`);
r = await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', items: [{ productId: pids[1], quantity: 4.475, unitPrice: RATE }] });
const dr2 = r.j; r = await call(admin, 'POST', `/api/invoices/${dr2.id}/issue`, {}); ok(r.s === 200, 'exactly 4.475 Mt (all that is left) can be issued', `${r.s} ${r.j.error || ''}`);
await call(admin, 'POST', `/api/invoices/${dr2.id}/reissue`, { reason: 'e2e cleanup' });

suite('Transfers and adjustments');
const s0 = [await stock(pids[0], 'dep-central'), await stock(pids[0], 'dep-regional')];
r = await call(admin, 'POST', '/api/inventory/transfers', { sourceDepotId: 'dep-central', destinationDepotId: 'dep-regional', items: [{ productId: pids[0], quantity: 1.234 }] }); ok(r.s === 201 || r.s === 200, 'transfer 1.234 Mt between depots', `${r.s} ${r.j.error || ''}`);
const s1 = [await stock(pids[0], 'dep-central'), await stock(pids[0], 'dep-regional')];
ok(near(s0[0] - s1[0], 1.234, 0.0005) && near(s1[1] - s0[1], 1.234, 0.0005), 'source -1.234, destination +1.234', JSON.stringify({ s0, s1 }));
r = await call(admin, 'POST', '/api/inventory/transfers', { sourceDepotId: 'dep-central', destinationDepotId: 'dep-regional', items: [{ productId: pids[0], quantity: 1.2345 }] }); ok(r.s === 400, 'transfer with 4 decimals refused', String(r.s));
r = await call(admin, 'POST', '/api/inventory/transfers', { sourceDepotId: 'dep-central', destinationDepotId: 'dep-regional', items: [{ productId: pcs, quantity: 0.5 }] }); ok(r.s === 400, 'transfer of 0.5 Pcs refused', String(r.s));
r = await call(admin, 'POST', '/api/inventory/adjust', { productId: pids[0], depotId: 'dep-central', deltaQty: 0.125, reason: 'FOUND' }); ok(r.s === 200 || r.s === 201, 'adjust +0.125 Mt', `${r.s} ${r.j.error || ''}`);
r = await call(admin, 'POST', '/api/inventory/adjust', { productId: pids[0], depotId: 'dep-central', deltaQty: -0.25, reason: 'DAMAGED' }); ok(r.s === 200 || r.s === 201, 'adjust -0.250 Mt', `${r.s} ${r.j.error || ''}`);
ok(near(await stock(pids[0], 'dep-central'), s1[0] - 0.125, 0.0005), 'stock after +0.125 and -0.250', String(await stock(pids[0], 'dep-central')));
r = await call(admin, 'POST', '/api/inventory/adjust', { productId: pcs, depotId: 'dep-central', deltaQty: 0.5, reason: 'FOUND' }); ok(r.s === 400, 'adjusting a Pcs product by 0.5 refused', String(r.s));
r = await call(admin, 'POST', '/api/inventory/adjust', { productId: pids[0], depotId: 'dep-central', deltaQty: -9999, reason: 'DAMAGED' }); ok(r.s >= 400, 'removing more than is there refused', String(r.s));
r = await call(admin, 'GET', '/api/inventory/adjustments'); const adj = (r.j.adjustments || r.j).find?.((a) => Number(a.deltaQty) === 0.125); ok(!!adj, 'adjustment history keeps the 0.125 quantity');

suite('Integer quantities and history are unaffected');
const e = await call(admin, 'GET', '/api/invoices?limit=200'); const old = (e.j.invoices || e.j.items || e.j).filter((i) => !i.id.startsWith('cmvb'));
ok(e.s === 200 && old.length > 5, 'historical invoices still load', String(old.length));
const hi = (await call(admin, 'GET', `/api/invoices/${old[old.length - 1].id}`)).j; ok(hi.items?.every((i) => Number.isFinite(Number(i.quantity)) && typeof i.quantity === 'number'), 'old lines have numeric quantities (JSON numbers, not strings)', JSON.stringify(hi.items?.map((i) => i.quantity)));
const pj = await call(admin, 'GET', `/api/document-pdf/TAX_INVOICE/${old[old.length - 1].id}`); ok(pj.s === 200 && pj.buf.slice(0, 4).toString() === '%PDF', 'a historical invoice still renders to PDF');
const pi2 = await call(admin, 'GET', '/api/products?limit=5'); ok(pi2.j.every((p) => typeof p.totalStock === 'number' && p.unit), 'product list: totalStock is a number and every product has a unit');
r = await call(admin, 'POST', '/api/proformas', { customerId: cust.id, items: [{ productId: 'e2e-A', quantity: 3, unitPrice: 200, selectedDepotId: 'dep-central' }] }); ok(r.s === 201 && Number(r.j.items?.[0]?.quantity ?? 3) === 3, 'whole-number quantities (3 Pcs) behave as before');
report(process.env.E2E_OUT);
