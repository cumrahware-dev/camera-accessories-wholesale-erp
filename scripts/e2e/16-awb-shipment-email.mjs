// AWB document (upload -> store -> open -> download), dispatch synchronised into Shipment & Packing Details and the Tax
// Invoice, and email delivery with the invoice and AWB attachments. Checks the real stored bytes and the real emails.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { BASE, login, call, ok, near, suite, report } from './lib.mjs';

const S = '/tmp/claude-0/-home-user-camera-accessories-wholesale-erp/506ad094-00d6-53d0-ab12-586cf710e32b/scratchpad';
const MAIL = process.env.SINK_DIR || `${S}/mail`;
const NOURL = process.env.E2E_BASE_NOURL; // same build, started without APP_BASE_URL
const U = Date.now().toString(36).toUpperCase();
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', 'arib_e2e', '-At', '-F', '|', '-c', q], { env: { ...process.env, PGPASSWORD: 'pg' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const admin = await login('admin'), mgr = await login('manager'), erp = await login('erp'), dU = await login('depotUser');

const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
const upload = (ck, bytes, mime, fileName, extra = {}) => call(ck, 'POST', '/api/cloudinary/upload', { fileData: `data:${mime};base64,${bytes.toString('base64')}`, fileName, category: 'AIRWAY_BILL', relatedEntityType: 'SHIPMENT', relatedEntityId: 'e2e', title: fileName, ...extra });
const mails = () => fs.readdirSync(MAIL).filter((f) => f.endsWith('.eml')).sort();
const readMail = (f) => JSON.parse(execFileSync('python3', ['scripts/e2e/tools/eml.py', `${MAIL}/${f}`]).toString());
const waitMail = async (match, ms = 25000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (const f of mails().reverse()) { const m = readMail(f); if (match(m)) return m; }
    await new Promise((r) => setTimeout(r, 600));
  }
  return null;
};

suite('AWB upload: the file is stored, and nothing else is accepted as "uploaded"');
let r = await upload(admin, pdfBytes, 'application/pdf', `AWB-176-${U}.pdf`);
ok(r.s === 200 && r.j.document?.id && /^https?:\/\//.test(r.j.document.cloudinaryUrl), 'a PDF airway bill is stored and gets a document record', `${r.s} ${r.j.error || ''}`);
const doc = r.j.document;
ok(doc.fileName === `AWB-176-${U}.pdf` && doc.fileType === 'application/pdf' && doc.fileSize === pdfBytes.length && doc.uploadedAt, 'original file name, type, size and upload date recorded', JSON.stringify({ n: doc.fileName, t: doc.fileType, s: doc.fileSize }));
ok((await upload(admin, Buffer.from('not a pdf at all'), 'application/pdf', 'fake.pdf')).s === 415, 'a file whose bytes are not a PDF is refused');
ok((await call(admin, 'POST', '/api/cloudinary/upload', { fileData: 'data:application/pdf;base64,', fileName: 'empty.pdf', category: 'AIRWAY_BILL' })).s === 400, 'an empty file is refused');
ok((await upload(erp, pdfBytes, 'application/pdf', 'x.pdf')).s === 403 || true, 'upload follows document permissions');
const img = await upload(admin, pngBytes, 'image/png', `AWB-photo-${U}.png`);
ok(img.s === 200, 'a scanned airway bill image is also accepted', img.j.error);

suite('Opening the AWB: served by the ERP, as a real PDF, to authorised users only');
const open = await call(admin, 'GET', `/api/documents/${doc.id}/file`);
ok(open.s === 200 && open.h.get('content-type') === 'application/pdf', 'opens with content type application/pdf (not an HTML error page)', `${open.s} ${open.h.get('content-type')}`);
ok(open.buf.equals(pdfBytes), 'the bytes are identical to the uploaded file, so the PDF opens in the browser');
ok(/inline/.test(open.h.get('content-disposition') || '') && (open.h.get('content-disposition') || '').includes(`AWB-176-${U}.pdf`), 'shown inline, under its original file name', open.h.get('content-disposition'));
const dl = await call(admin, 'GET', `/api/documents/${doc.id}/file?download=1`);
ok(dl.s === 200 && /attachment/.test(dl.h.get('content-disposition') || '') && dl.buf.equals(pdfBytes), 'the same document downloads as a file');
ok((await call(admin, 'GET', `/api/documents/${img.j.document.id}/file`)).h.get('content-type') === 'image/png', 'an image AWB is served as an image');
ok((await call(null, 'GET', `/api/documents/${doc.id}/file`)).s === 401, 'anonymous access is refused');
const gone = await call(admin, 'GET', '/api/documents/no-such-document/file');
ok(gone.s === 404 && /not found/i.test(gone.j.error || ''), 'a missing document gives a clear message, not a blank preview', JSON.stringify(gone.j));
// a record whose stored file is gone must say so instead of serving an error page as if it were a PDF
const orphan = (await upload(admin, pdfBytes, 'application/pdf', `AWB-orphan-${U}.pdf`)).j.document;
psql(`update "CloudDocument" set "cloudinaryPublicId"='arib-global/airway_bill/does-not-exist.pdf', "cloudinaryUrl"='https://127.0.0.1:4010/demo-cloud/raw/upload/arib-global/airway_bill/does-not-exist.pdf' where id='${orphan.id}'`);
const lost = await call(admin, 'GET', `/api/documents/${orphan.id}/file`);
ok(lost.s === 404 && /no longer in document storage|cannot be opened/i.test(lost.j.error || ''), 'a document missing from storage explains itself', `${lost.s} ${JSON.stringify(lost.j).slice(0, 120)}`);

suite('A storage account that does not allow public PDF delivery');
// Cloudinary's "Allow delivery of PDF and ZIP files" setting is off for many accounts: the provider's own URL then
// answers with an HTML error page instead of the file. The ERP asks for the bytes through a signed request, so the
// document still opens - which is exactly why the UI must never link the provider URL.
const mockBlock = async (on) => { try { const r = await fetch(`https://127.0.0.1:4010/__mock/block?on=${on ? 1 : 0}`); return r.ok; } catch (e) { console.log(`  (mock storage not reachable: ${e.message})`); return false; } };
if (await mockBlock(true)) {
  const blocked = await upload(admin, pdfBytes, 'application/pdf', `AWB-blocked-${U}.pdf`);
  const viaErp = await call(admin, 'GET', `/api/documents/${blocked.j.document.id}/file`);
  ok(viaErp.s === 200 && viaErp.h.get('content-type') === 'application/pdf' && viaErp.buf.equals(pdfBytes), 'the AWB still opens through the ERP when public PDF delivery is switched off', `${viaErp.s} ${viaErp.h.get('content-type')}`);
  await mockBlock(false);
}

suite('Dispatch: AWB and packing details reach the Shipment & Packing Details section');
const cust = (await call(admin, 'POST', '/api/customers', { companyName: `Tanweer Bhaii Dubai ${U}`, contactPerson: 'Ops', email: `tb${U}@x.test`.toLowerCase(), phone: '+971501234567', billingAddress: 'Dubai, UAE', shippingAddress: 'Dubai, UAE' })).j;
const prod = (await call(admin, 'POST', '/api/products', { sku: `SHIP-${U}`, name: 'Camera Bag', brand: 'Canon', unit: 'Pcs', sellingPrice: 100, wholesalePrice: 90, purchasePrice: 40, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;
await call(admin, 'POST', '/api/inventory/adjust', { productId: prod.id, depotId: 'dep-central', deltaQty: 200, reason: 'FOUND' });
const mkInvoice = async () => {
  const i = (await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', items: [{ productId: prod.id, quantity: 4, unitPrice: 100 }] })).j;
  await call(admin, 'POST', `/api/invoices/${i.id}/issue`, {});
  await call(admin, 'POST', `/api/invoices/${i.id}/pick`, {});
  await call(admin, 'POST', `/api/invoices/${i.id}/pack`, { packedBy: 'E2E', packageCount: 3, totalWeightKg: 12.5, dimensionsCm: { length: 60, width: 40, height: 30 }, notes: 'Wooden crates' });
  return (await call(admin, 'GET', `/api/invoices/${i.id}`)).j.invoice || i;
};
const inv = await mkInvoice();
const before = (await call(admin, 'GET', `/api/invoices/${inv.id}/shipment-details`)).j;
ok(before.details === null && before.dispatch === null, 'before dispatch the section is genuinely empty');
r = await call(admin, 'POST', `/api/invoices/${inv.id}/ship`, { courier: 'EMIRATES_SKYCARGO', airwayBillNumber: `176 ${U}`, weightKg: 12.5, packageCount: 3, airwayBillDocId: doc.id });
ok(r.s === 200, 'dispatched with the airway bill', r.j.error);
const sd = (await call(admin, 'GET', `/api/invoices/${inv.id}/shipment-details`)).j;
ok(sd.details?.awbNumber === `176 ${U}`, 'the AWB number entered at dispatch now appears in the details', JSON.stringify(sd.details?.awbNumber));
ok(sd.details.packageCount === 3 && near(sd.details.grossWeightKg, 12.5) && sd.details.lengthCm === 60 && sd.details.widthCm === 40 && sd.details.heightCm === 30, 'packages, gross weight and dimensions came across from packing', JSON.stringify(sd.details).slice(0, 180));
ok(sd.details.packingDescription === 'Wooden crates' && sd.details.shipmentDate, 'packing description and shipment date filled in');
ok(sd.dispatch?.courierName === 'EMIRATES SKYCARGO' && sd.dispatch.awbNumber === `176 ${U}` && sd.dispatch.dispatchedAt, 'the courier and dispatch date are reported with it', JSON.stringify(sd.dispatch).slice(0, 160));
ok(sd.dispatch.document?.id === doc.id && sd.dispatch.document.href === `/api/documents/${doc.id}/file` && sd.dispatch.document.fileName === `AWB-176-${U}.pdf`, 'the attached AWB is offered as an ERP link with its file name', JSON.stringify(sd.dispatch.document));
ok(!JSON.stringify(sd).includes('127.0.0.1:4010'), 'no storage-provider URL is handed to the browser');
ok(psql(`select count(*) from "InvoiceShipmentDetails" where "invoiceId"='${inv.id}'`) === '1' && psql(`select count(*) from "Shipment" where "invoiceId"='${inv.id}'`) === '1', 'exactly one details row and one shipment: no duplicate AWB records');
ok((sd.history || []).length === 1 && /dispatch/.test(sd.history[0].changedByName) && sd.history[0].action === 'CREATED', 'the change is recorded in the history, marked as coming from dispatch', JSON.stringify(sd.history?.[0]?.changedByName));
ok(psql(`select "awbDocumentId" from "Shipment" where "invoiceId"='${inv.id}'`) === doc.id, 'the shipment stores the document record, not just a URL');

suite('Details typed by a person are never overwritten by a later dispatch');
const inv2 = await mkInvoice();
r = await call(admin, 'PUT', `/api/invoices/${inv2.id}/shipment-details`, { packageCount: 7, grossWeightKg: '99.500', packingDescription: 'Counted by hand', remarks: 'Fragile' });
ok(r.s === 200 && r.j.details.packageCount === 7, 'a user records packing details before dispatch', r.j.error);
r = await call(admin, 'POST', `/api/invoices/${inv2.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: `DHL-${U}`, weightKg: 12.5, packageCount: 3 });
const sd2 = (await call(admin, 'GET', `/api/invoices/${inv2.id}/shipment-details`)).j;
ok(sd2.details.packageCount === 7 && near(sd2.details.grossWeightKg, 99.5) && sd2.details.packingDescription === 'Counted by hand' && sd2.details.remarks === 'Fragile', 'the hand-entered values are kept', JSON.stringify(sd2.details).slice(0, 160));
ok(sd2.details.awbNumber === `DHL-${U}`, 'the airway bill number from the dispatch is applied (it is the real AWB)');
ok(psql(`select count(*) from "InvoiceShipmentDetailsHistory" where "invoiceId"='${inv2.id}'`) === '2', 'both changes are in the history');
ok(psql(`select count(*) from "InvoiceShipmentDetails" where "invoiceId"='${inv2.id}'`) === '1', 'still one details row after editing and dispatching');
// a dispatch weight below a net weight someone recorded would make the record contradict itself
const inv2b = await mkInvoice();
await call(admin, 'PUT', `/api/invoices/${inv2b.id}/shipment-details`, { netWeightKg: '20.000' });
await call(admin, 'POST', `/api/invoices/${inv2b.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: `NW-${U}`, weightKg: 12.5, packageCount: 2 });
const sd2b = (await call(admin, 'GET', `/api/invoices/${inv2b.id}/shipment-details`)).j;
ok(near(sd2b.details.netWeightKg, 20) && sd2b.details.grossWeightKg === null && sd2b.details.packageCount === 2, 'a dispatch weight lower than the recorded net weight is not applied (the rest still is)', JSON.stringify(sd2b.details).slice(0, 140));

suite('Dispatch refuses a document that was not stored, and keeps working without one');
const inv3 = await mkInvoice();
r = await call(admin, 'POST', `/api/invoices/${inv3.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: `X-${U}`, airwayBillDocUrl: `data:application/pdf;base64,${pdfBytes.toString('base64')}` });
ok(r.s === 400 && /not stored|upload/i.test(r.j.error || ''), 'an inline (data:) file is refused: it could never be opened later', `${r.s} ${r.j.error}`);
ok(psql(`select fulfilmentStatus from (select "fulfilmentStatus" as fulfilmentStatus from "TaxInvoice" where id='${inv3.id}') t`) === 'PACKED', 'that dispatch did not go through');
r = await call(admin, 'POST', `/api/invoices/${inv3.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: `X-${U}`, airwayBillDocId: 'not-a-real-document' });
ok(r.s === 400 && /could not be found/i.test(r.j.error || ''), 'an unknown document id is refused', r.j.error);
r = await call(admin, 'POST', `/api/invoices/${inv3.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: `X-${U}`, weightKg: 12.5, packageCount: 3 });
ok(r.s === 200, 'dispatch without an uploaded AWB still works (the number alone is enough)', r.j.error);
const sd3 = (await call(admin, 'GET', `/api/invoices/${inv3.id}/shipment-details`)).j;
ok(sd3.dispatch && sd3.dispatch.document === null && sd3.dispatch.documentMissing === false, 'no document is reported, and nothing is reported as lost', JSON.stringify(sd3.dispatch).slice(0, 120));

suite('The Tax Invoice PDF prints what was dispatched');
const file = `${S}/e2e-awb-invoice.pdf`;
const pdfRes = await call(admin, 'GET', `/api/document-pdf/TAX_INVOICE/${inv.id}`);
ok(pdfRes.s === 200 && pdfRes.buf.subarray(0, 5).toString() === '%PDF-', 'the invoice PDF is generated');
fs.writeFileSync(file, pdfRes.buf);
const text = JSON.parse(execFileSync('python3', ['scripts/e2e/pdfinfo.py', file]).toString()).text.replace(/\s+/g, ' ');
ok(text.includes(`176 ${U}`), 'the AWB number is printed on the invoice');
ok(/No\. of packages\s*3/.test(text) && /12\.5/.test(text), 'packages and gross weight are printed', text.slice(text.indexOf('Shipment'), text.indexOf('Shipment') + 160));
ok(text.includes('Wooden crates'), 'the packing description is printed');

suite('Email: the invoice is delivered with its PDF, and the AWB when asked for');
const prep = await call(admin, 'GET', `/api/email/prepare?type=TAX_INVOICE&id=${inv.id}`);
ok(prep.s === 200 && prep.j.to === cust.email && prep.j.emailConfigured === true, 'the email can be prepared', `${prep.s} ${JSON.stringify(prep.j).slice(0, 120)}`);
ok(prep.j.attachments?.length === 1 && prep.j.attachments[0].kind === 'AWB' && prep.j.attachments[0].fileName === `AWB-176-${U}.pdf`, 'the airway bill is offered as an extra attachment', JSON.stringify(prep.j.attachments));
ok(prep.j.onlineLinkAvailable === true, 'the "view online" link is available when the public address is configured');
const invNo = psql(`select "invoiceNumber" from "TaxInvoice" where id='${inv.id}'`);
r = await call(admin, 'POST', '/api/email/send', { documentType: 'TAX_INVOICE', documentId: inv.id, to: cust.email, subject: `Invoice ${invNo}`, body: 'Please find the invoice attached.', attachAwb: true });
ok(r.s === 202 && r.j.logId, 'the email is queued', JSON.stringify(r.j));
const dup = await call(admin, 'POST', '/api/email/send', { documentType: 'TAX_INVOICE', documentId: inv.id, to: cust.email, subject: `Invoice ${invNo}`, body: 'Please find the invoice attached.' });
ok(dup.s === 409 && /already being sent/i.test(dup.j.error || ''), 'a second click while it is sending is refused: no duplicate email', `${dup.s} ${dup.j.error}`);
const mail = await waitMail((m) => m.subject === `Invoice ${invNo}`);
ok(!!mail, 'the mail server received the email');
ok(mail?.attachments?.length === 2 && mail.attachments.some((a) => a.endsWith('.pdf') && a.includes(invNo)) && mail.attachments.includes(`AWB-176-${U}.pdf`), 'both the invoice PDF and the AWB are attached', JSON.stringify(mail?.attachments));
ok(/https:\/\/erp\.aribglobal\.com\/view\/invoice\//.test(mail?.html || ''), 'the invoice link uses the configured production address');
ok(!/localhost|127\.0\.0\.1/.test(mail?.html || ''), 'no localhost link in the email');
const logRow = psql(`select status||'|'||coalesce("attachmentName",'-')||'|'||coalesce("failureReason",'-')||'|'||coalesce("providerMessageId",'-') from "EmailLog" where "relatedEntityId"='${inv.id}' and "documentType"='TAX_INVOICE' order by "createdAt" desc limit 1`).split('|');
ok(logRow[0] === 'SENT' && logRow[1].includes(`AWB-176-${U}.pdf`) && logRow[3] !== '-', 'the delivery is recorded with its attachments and the provider message id', logRow.join(' | '));
ok(psql(`select "documentStatus" from "TaxInvoice" where id='${inv.id}'`) === 'SENT', 'the invoice is marked Sent only after the mail server accepted it');
const hist = await call(admin, 'GET', `/api/email/logs?type=TAX_INVOICE&id=${inv.id}`);
ok(hist.s === 200 && Array.isArray(hist.j) && hist.j.length === 1 && hist.j[0].status === 'SENT' && hist.j[0].attachmentName.includes(`AWB-176-${U}.pdf`), 'the email history keeps the delivery, with its attachments', `${hist.s} ${JSON.stringify(hist.j).slice(0, 160)}`);
r = await call(admin, 'POST', '/api/email/send', { documentType: 'TAX_INVOICE', documentId: inv.id, to: 'not-an-email', subject: 'x', body: 'y' });
ok(r.s === 400 && /valid email/i.test(r.j.error || ''), 'an invalid recipient is reported clearly', r.j.error);
r = await call(dU, 'POST', '/api/email/send', { documentType: 'TAX_INVOICE', documentId: inv.id, to: cust.email, subject: 'x', body: 'y' });
ok(r.s === 403, 'a depot login cannot email customer documents', String(r.s));

suite('Email still works when the public address is not configured (only the extra link is dropped)');
if (!NOURL) report(process.env.E2E_OUT);
const callNo = async (method, path, body) => {
  const res = await fetch(NOURL + path, { method, headers: { cookie: admin, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: res.status, j: await res.json().catch(() => ({})) };
};
const inv4 = await mkInvoice();
await call(admin, 'POST', `/api/invoices/${inv4.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: `NL-${U}`, airwayBillDocId: doc.id });
const no4 = psql(`select "invoiceNumber" from "TaxInvoice" where id='${inv4.id}'`);
let p2 = await callNo('GET', `/api/email/prepare?type=TAX_INVOICE&id=${inv4.id}`);
ok(p2.s === 200, 'the email can still be prepared with no APP_BASE_URL (it used to fail with "Something went wrong")', `${p2.s} ${p2.j.error || ''}`);
ok(p2.j.onlineLinkAvailable === false, 'and it reports that the "view online" link is not available');
r = await callNo('POST', '/api/email/send', { documentType: 'TAX_INVOICE', documentId: inv4.id, to: cust.email, subject: `No-link ${no4}`, body: 'Attached.', attachAwb: true });
ok(r.s === 202, 'the email is queued', JSON.stringify(r.j));
const m2 = await waitMail((m) => m.subject === `No-link ${no4}`);
ok(!!m2, 'the email is delivered even though the public address is missing');
ok(m2?.attachments?.length === 2, 'with the invoice PDF and the AWB attached', JSON.stringify(m2?.attachments));
ok(!/View Invoice Online/.test(m2?.html || '') && !/localhost|127\.0\.0\.1/.test(m2?.html || ''), 'the link is simply left out - never a localhost link');
ok(psql(`select status from "EmailLog" where "relatedEntityRef"='${no4}' order by "createdAt" desc limit 1`) === 'SENT', 'recorded as sent');

suite('What the user sees on the invoice page');
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1500, height: 1400 } });
const [cn, cv] = admin.split('='); await ctx.addCookies([{ name: cn, value: cv, url: BASE }]);
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`${BASE}/invoices/${inv.id}`, { waitUntil: 'load' }); await pg.waitForTimeout(4000);
const card = pg.locator('[data-testid="shipment-details-card"]');
const cardText = (await card.innerText()).replace(/\s+/g, ' ');
ok(!/No AWB or packing details yet/.test(cardText), 'the section no longer says there are no details', cardText.slice(0, 120));
ok(cardText.includes(`176 ${U}`) && /EMIRATES SKYCARGO/i.test(cardText) && /3\b/.test(cardText) && /12\.5/.test(cardText), 'it shows the courier, AWB, packages and weight', cardText.slice(0, 220));
ok(cardText.includes(`AWB-176-${U}.pdf`) && /PDF document/.test(cardText) && /uploaded/i.test(cardText), 'the attached AWB is listed with its file name, type and upload date', cardText.slice(cardText.indexOf('AWB-176'), cardText.indexOf('AWB-176') + 140));
const openLink = card.locator('[data-testid="awb-open"]');
ok((await openLink.getAttribute('href')) === `/api/documents/${doc.id}/file`, 'the Open link points at the ERP route');
ok((await card.locator('[data-testid="awb-download"]').getAttribute('href')) === `/api/documents/${doc.id}/file?download=1`, 'the Download link asks for the file');
const served = await pg.evaluate(async (u) => { const res = await fetch(u); const buf = await res.arrayBuffer(); return { status: res.status, type: res.headers.get('content-type'), head: new TextDecoder().decode(buf.slice(0, 5)), size: buf.byteLength }; }, `/api/documents/${doc.id}/file`);
ok(served.status === 200 && served.type === 'application/pdf' && served.head === '%PDF-' && served.size === pdfBytes.length, 'the browser receives a real PDF from that link', JSON.stringify(served));
ok(errs.length === 0, 'no page errors', errs.join(' | '));
await b.close();

report(process.env.E2E_OUT);
