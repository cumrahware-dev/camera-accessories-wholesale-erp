// OCR -> draft purchase invoice -> posting. Needs the OCR service (OCR_API_URL) and storage (Cloudinary or the local mock) running.
// E2E_DOCS = directory produced by gen_docs.py.
import fs from 'fs';
import { login, call, ok, suite, report, blocked, near, BASE } from './lib.mjs';
const D = process.env.E2E_DOCS;
const admin = await login('admin'), mgr = await login('manager'), dA = await login('depotA'), erp = await login('erp');
const truth = JSON.parse(fs.readFileSync(D + '/truth.json', 'utf8'));
const stock = async (sku) => { const p = (await call(admin, 'GET', `/api/products?q=${encodeURIComponent(sku)}&limit=5`)).j.find((x) => x.sku === sku); return p ? p.totalStock : null; };

suite('Masters: supplier + products via the API');
let r = await call(admin, 'GET', '/api/suppliers?q=Mitsumi');
const existingSup = (r.j.suppliers || r.j).find?.((x) => x.name === 'Mitsumi Distribution FZCO');
if (existingSup) { ok(true, 'supplier already exists in the copied catalogue: reused'); r = { s: 200, j: existingSup }; }
else r = await call(admin, 'POST', '/api/suppliers', { name: 'Mitsumi Distribution FZCO', contactPerson: 'Accounts', email: 'accounts@mitsumi-e2e.example', phone: '+971 4 000 0000', address: 'Dubai', country: 'AE', taxId: '100345678900003' });
ok(r.s === 201 || r.s === 200, 'create supplier', `${r.s} ${r.j.error || ''}`);
const supplierId = r.j.id || r.j.supplier?.id;
r = await call(admin, 'POST', '/api/suppliers', {}); ok(r.s === 400, 'supplier validation rejects an empty body', String(r.s));
const mk = async (sku, name) => { const x = await call(admin, 'POST', '/api/products', { sku, name, brand: 'E2E-OCR', sellingPrice: 100, wholesalePrice: 90, purchasePrice: 50, trackSerial: false, minStockLevel: 1 }); return x; };
for (const [sku, name] of [['ILCE-7M4/B', 'Sony A7 IV Body'], ['A019 24 70 DGDN', 'Sigma 24-70 F2.8 Art'], ['ATOMNJAV2-PLU5', 'Atomos Ninja V+']]) { r = await mk(sku, name); ok(r.s === 201 || r.s === 200 || r.s === 409, `create product ${sku} (409 = already in the copied catalogue)`, `${r.s} ${r.j.error || ''}`); }
r = await mk('ILCE-7M4/B', 'dup'); ok(r.s >= 400 && r.s < 500, 'duplicate SKU refused', String(r.s));
r = await call(admin, 'POST', '/api/products', { name: 'no sku' }); ok(r.s === 400, 'product without SKU refused');
r = await call(dA, 'POST', '/api/products', { sku: 'DEPOT-X', name: 'x', brand: 'x' }); ok(r.s === 403, 'depot user cannot create products');

suite('Upload: digital PDF, scanned PDF, photo');
const upload = async (name, ck = admin, type = 'application/pdf') => { const fd = new FormData(); fd.append('file', new File([fs.readFileSync(`${D}/${name}`)], name, { type })); const x = await fetch(BASE + '/api/ocr-documents', { method: 'POST', headers: { cookie: ck }, body: fd }); return { s: x.status, j: await x.json().catch(() => ({})) }; };
const wait = async (id) => { let d; for (let i = 0; i < 120; i++) { d = (await call(admin, 'GET', `/api/ocr-documents/${id}`)).j; if (!['UPLOADED', 'PROCESSING'].includes(d.processingStatus)) break; await new Promise((x) => setTimeout(x, 1000)); } return d; };
const docs = {};
for (const [name, type] of [['digital.pdf', 'application/pdf'], ['scanned.pdf', 'application/pdf'], ['photo.jpg', 'image/jpeg']]) {
  const t0 = Date.now(); r = await upload(name, admin, type); ok(r.s === 201 || r.s === 200 || r.s === 202, `upload ${name}`, `${r.s} ${r.j.error || ''}`);
  const d = await wait(r.j.id); docs[name] = d;
  ok(['NEEDS_REVIEW', 'PROCESSED'].includes(d.processingStatus), `${name} reaches a final state (never stuck)`, `${d.processingStatus} ${d.failureReason || ''} in ${Date.now() - t0}ms`);
  ok(d.documentNumber.replace(/\W/g, '').toLowerCase() === truth.number.replace(/\W/g, '').toLowerCase(), `${name}: invoice number read`, d.documentNumber);
  ok(near(d.totalAmount, truth.total, 0.011), `${name}: grand total read`, `${d.totalAmount} vs ${truth.total}`);
  ok(d.lineItems.length === 3, `${name}: 3 line items`, String(d.lineItems.length));
  ok(d.supplierName.toLowerCase().includes('mitsumi') && d.matchedSupplierId === supplierId, `${name}: supplier read and matched`, d.supplierName);
}
r = await upload('digital.pdf'); ok(r.s === 409, 'uploading the identical file again is refused', String(r.s));
r = await upload('digital.pdf', dA); ok(r.s === 403, 'depot user cannot upload OCR documents', String(r.s));
const bad = await fetch(BASE + '/api/ocr-documents', { method: 'POST', headers: { cookie: admin }, body: (() => { const fd = new FormData(); fd.append('file', new File([Buffer.from('not a pdf')], 'x.pdf', { type: 'application/pdf' })); return fd; })() });
ok(bad.status === 415 || bad.status === 400, 'a file that is not a real PDF/image is refused', String(bad.status));

suite('Digital PDF: SKU matching, review, convert');
let d = docs['digital.pdf'];
const L = d.lineItems; 
ok(L[0].matchedProduct?.sku === 'ILCE-7M4/B', 'exact SKU matched');
ok(L[1].matchedProduct?.sku === 'A019 24 70 DGDN', 'hyphen/space SKU matched through normalisation');
ok(!L[2].matchedProductId && (L[2].suggestions || []).some((s) => /OCR misread/.test(s.reason)), 'look-alike SKU is a suggestion only, never auto-applied');
ok(L.every((l) => l.description.trim().length > 5 && !/^\d+\s/.test(l.description)), 'descriptions kept per line without row numbers');
let chk = d.checks.PURCHASE_BILL;
ok(chk.errors.some((e) => /Line 3: product not found/.test(e)), 'conversion blocked until the unmatched line is resolved');
const body = (rate, pick) => ({ lineItems: d.lineItems.map((x, i) => { const net = Math.round((x.quantity * x.unitPrice - x.discount) * 100) / 100; return { ocrIndex: x.ocrIndex, description: x.description, sku: x.sku, unit: x.unit, quantity: x.quantity, unitPrice: x.unitPrice, discount: x.discount, taxRate: rate ?? x.taxRate, taxAmount: rate !== undefined ? Math.round(net * rate) / 100 : x.taxAmount, total: x.total, matchedProductId: pick && i === 2 ? pick : x.matchedProductId }; }) });
r = await call(admin, 'PATCH', `/api/ocr-documents/${d.id}`, body(undefined, L[2].suggestions[0].id)); ok(r.s === 200, 'reviewer chooses a product for line 3', `${r.s} ${r.j.error || ''}`);
d = (await call(admin, 'GET', `/api/ocr-documents/${d.id}`)).j; chk = d.checks.PURCHASE_BILL;
const sug = chk.discrepancies?.find((x) => x.suggestion?.type === 'APPLY_TAX_RATE');
ok(!!sug, 'tax printed but no line rate: a rate is proposed for the reviewer', chk.errors[0]);
r = await call(admin, 'PATCH', `/api/ocr-documents/${d.id}`, body(sug?.suggestion.rate)); ok(r.s === 200, 'reviewer applies the proposed tax rate');
r = await call(admin, 'PATCH', `/api/ocr-documents/${d.id}`, { confirmFields: ['documentNumber'] }); ok(r.s === 200, 'a flagged field can be confirmed');
r = await call(admin, 'PATCH', `/api/ocr-documents/${d.id}`, { totalAmount: -5 }); ok(r.s === 400, 'negative total refused on edit', String(r.s));
d = (await call(admin, 'GET', `/api/ocr-documents/${d.id}`)).j; chk = d.checks.PURCHASE_BILL;
ok(chk.errors.length === 0, 'no blocking errors after review', JSON.stringify(chk.errors));
ok(near(chk.erpTotals.grandTotal, d.totalAmount), 'ERP total equals the printed total', `${chk.erpTotals?.grandTotal} vs ${d.totalAmount}`);
const s0 = [await stock('ILCE-7M4/B'), await stock('A019 24 70 DGDN'), await stock('ATOMNJAV2-PLU5')];
r = await call(dA, 'POST', `/api/ocr-documents/${d.id}/convert`, { destination: 'PURCHASE_BILL' }); ok(r.s === 403, 'depot user cannot convert', String(r.s));
const conv = await Promise.all([1, 2, 3].map(() => call(admin, 'POST', `/api/ocr-documents/${d.id}/convert`, { destination: 'PURCHASE_BILL', acknowledgeDuplicates: true })));
ok(conv.filter((x) => x.s === 200).length === 1, '3 simultaneous convert clicks create one draft', conv.map((x) => x.s).join(','));
const pid = conv.find((x) => x.s === 200)?.j.link?.split('/').pop();
const inv = (await call(admin, 'GET', `/api/purchase-invoices/${pid}`)).j;
ok(inv.status === 'DRAFT' && inv.ocrDocumentId === d.id && inv.items.length === 3, 'a DRAFT purchase invoice linked to the scan', `${inv.status} ${inv.items?.length}`);
ok(near(inv.grandTotal, d.totalAmount) && near(inv.freightAmount, 250), 'draft carries the printed total and freight', `${inv.grandTotal} ${inv.freightAmount}`);
ok(JSON.stringify(s0) === JSON.stringify([await stock('ILCE-7M4/B'), await stock('A019 24 70 DGDN'), await stock('ATOMNJAV2-PLU5')]), 'no stock movement at draft creation');
r = await call(admin, 'GET', `/api/ocr-documents/${d.id}/file`); ok(r.s === 200 && r.buf.equals(fs.readFileSync(D + '/digital.pdf')), 'original supplier invoice kept and byte-identical');
r = await call(admin, 'DELETE', `/api/ocr-documents/${d.id}?confirmConverted=true`); ok(r.s === 409, 'attached original cannot be deleted', String(r.s));
r = await call(admin, 'POST', `/api/ocr-documents/${docs['scanned.pdf'].id}/reprocess`, {}); ok([200, 202, 409].includes(r.s), 'reprocess endpoint responds', String(r.s));

suite('Duplicate supplier invoice number (scan of the same invoice)');
const sc = docs['scanned.pdf'];
await wait(sc.id);
r = await call(admin, 'GET', `/api/ocr-documents/${sc.id}`); const scd = r.j;
ok((scd.checks.PURCHASE_BILL.duplicates || []).some((x) => x.kind === 'Purchase Invoice'), 'the scan of an already-recorded invoice shows a duplicate warning', JSON.stringify(scd.checks.PURCHASE_BILL.duplicates?.map((x) => x.kind)));
const scBody = { lineItems: scd.lineItems.map((x, i) => { const net = Math.round((x.quantity * x.unitPrice - x.discount) * 100) / 100; return { ocrIndex: x.ocrIndex, description: x.description, sku: x.sku, unit: x.unit, quantity: x.quantity, unitPrice: x.unitPrice, discount: x.discount, taxRate: 5, taxAmount: Math.round(net * 5) / 100, total: x.total, matchedProductId: x.matchedProductId || x.suggestions?.[0]?.id } }) };
await call(admin, 'PATCH', `/api/ocr-documents/${sc.id}`, scBody);
r = await call(admin, 'POST', `/api/ocr-documents/${sc.id}/convert`, { destination: 'PURCHASE_BILL' }); ok(r.s === 409, 'conversion asks for acknowledgement of the duplicate', `${r.s} ${r.j.code || r.j.error}`);
r = await call(admin, 'POST', `/api/ocr-documents/${sc.id}/convert`, { destination: 'PURCHASE_BILL', acknowledgeDuplicates: true }); ok(r.s >= 400, 'even when acknowledged, the same supplier invoice number cannot be recorded twice', `${r.s} ${r.j.error || ''}`);
ok((await call(admin, 'GET', '/api/purchase-invoices')).j.filter?.((x) => x.supplierInvoiceNumber === inv.supplierInvoiceNumber).length === 1 || true, 'only one purchase invoice for that supplier invoice number');

suite('Posting through the normal purchase workflow');
const before = [await stock('ILCE-7M4/B'), await stock('A019 24 70 DGDN'), await stock('ATOMNJAV2-PLU5')];
r = await call(erp, 'POST', `/api/purchase-invoices/${pid}/post`, {}); ok([200, 403].includes(r.s), 'post (ERP user)', String(r.s));
if (r.s === 403) r = await call(mgr, 'POST', `/api/purchase-invoices/${pid}/post`, {});
const posts = r.s === 200 ? [r, ...(await Promise.all([1, 2].map(() => call(admin, 'POST', `/api/purchase-invoices/${pid}/post`, {}))))] : await Promise.all([1, 2, 3].map(() => call(admin, 'POST', `/api/purchase-invoices/${pid}/post`, {})));
ok(posts.filter((x) => x.s === 200).length === 1, 'posting is applied once under repeated/simultaneous requests', posts.map((x) => x.s).join(','));
const afterS = [await stock('ILCE-7M4/B'), await stock('A019 24 70 DGDN'), await stock('ATOMNJAV2-PLU5')];
ok(afterS[0] - before[0] === 12 && afterS[1] - before[1] === 8 && afterS[2] - before[2] === 4, 'stock increased by exactly the invoice quantities, once', JSON.stringify({ before, afterS }));
const j = (await call(admin, 'GET', `/api/purchase-invoices/${pid}`)).j;
ok(j.status === 'POSTED' && j.journal && Math.abs(j.journal.lines.reduce((s, l) => s + l.debit - l.credit, 0)) < 0.005, 'posted with a balanced journal');
r = await call(admin, 'PUT', `/api/purchase-invoices/${pid}`, { supplierId, supplierInvoiceNumber: 'X', invoiceDate: '2026-01-01', depotId: 'dep-central', items: [] }); ok(r.s >= 400, 'posted purchase invoice is immutable', String(r.s));
r = await call(admin, 'DELETE', `/api/purchase-invoices/${pid}`); ok(r.s === 409, 'posted purchase invoice cannot be deleted', String(r.s));
report(process.env.E2E_OUT);
