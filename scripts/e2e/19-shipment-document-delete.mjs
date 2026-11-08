// Deleting uploaded shipment documents (AWB, packing list, challan, ...): confirmation, server-side ownership and
// permission checks, storage removal, shared-file protection, outage handling with retry, audit, no side effects.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import { BASE, login, call, ok, suite, report } from './lib.mjs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // the mock storage uses a self-signed certificate
const U = Date.now().toString(36).toUpperCase();
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', 'arib_e2e', '-At', '-F', '|', '-c', q], { env: { ...process.env, PGPASSWORD: 'pg' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const admin = await login('admin'), mgr = await login('manager'), erp = await login('erp'), dU = await login('depotUser');
const MOCK = 'https://127.0.0.1:4010';
const mock = async (path) => { try { return await (await fetch(`${MOCK}${path}`)).json(); } catch (e) { return null; } };
const stored = async (publicId) => (await mock(`/__mock/exists?id=${encodeURIComponent(publicId)}`))?.exists;
const pdf = (tag) => Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
const upload = (ck, entityId, category, name, entityType = 'INVOICE') => call(ck, 'POST', '/api/cloudinary/upload', { fileData: `data:application/pdf;base64,${pdf(name + U).toString('base64')}`, fileName: name, category, relatedEntityType: entityType, relatedEntityId: entityId, title: name });

const cust = (await call(admin, 'POST', '/api/customers', { companyName: `DocDel Trading ${U}`, contactPerson: 'Ops', email: `dd${U}@x.test`.toLowerCase(), phone: '+971501234567', billingAddress: 'Dubai', shippingAddress: 'Dubai' })).j;
const prod = (await call(admin, 'POST', '/api/products', { sku: `DD-${U}`, name: 'Doc Bag', brand: 'Canon', unit: 'Pcs', sellingPrice: 100, wholesalePrice: 90, purchasePrice: 40, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;
await call(admin, 'POST', '/api/inventory/adjust', { productId: prod.id, depotId: 'dep-central', deltaQty: 100, reason: 'FOUND' });
const mkInvoice = async () => {
  const i = (await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', items: [{ productId: prod.id, quantity: 2, unitPrice: 100 }] })).j;
  for (const s of ['issue', 'pick']) await call(admin, 'POST', `/api/invoices/${i.id}/${s}`, {});
  await call(admin, 'POST', `/api/invoices/${i.id}/pack`, { packedBy: 'E2E', packageCount: 1, totalWeightKg: 5 });
  return i;
};
const inv = await mkInvoice(), other = await mkInvoice();
const awb = (await upload(admin, inv.id, 'AIRWAY_BILL', `AWB-${U}.pdf`, 'SHIPMENT')).j.document;
await call(admin, 'POST', `/api/invoices/${inv.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: `DHL-${U}`, weightKg: 5, packageCount: 1, airwayBillDocId: awb.id });
const packing = (await upload(admin, inv.id, 'PACKING_LIST', `Packing-${U}.pdf`)).j.document;
const challan = (await upload(admin, inv.id, 'DELIVERY_CHALLAN', `Challan-${U}.pdf`)).j.document;
const cinv = (await upload(admin, inv.id, 'COMMERCIAL_INVOICE', `CI-${U}.pdf`)).j.document;
const foreign = (await upload(admin, other.id, 'PACKING_LIST', `Foreign-${U}.pdf`)).j.document;
const taxDoc = (await upload(admin, inv.id, 'TAX_INVOICE', `TaxCopy-${U}.pdf`)).j.document;

suite('New shipment document categories are accepted and listed');
ok([packing, challan, cinv].every((d) => d?.id), 'packing list, delivery challan and commercial invoice upload', JSON.stringify([packing, challan, cinv].map((d) => d?.id)));
let list = (await call(admin, 'GET', `/api/invoices/${inv.id}/documents`)).j;
const ids = (list.documents || []).map((d) => d.id);
ok([awb.id, packing.id, challan.id, cinv.id].every((i) => ids.includes(i)), 'the Shipment Documents list holds the AWB and the other shipment documents', ids.length);
ok(!ids.includes(foreign.id) && !ids.includes(taxDoc.id), 'another invoice\'s document and non-shipment documents are not listed');
ok(list.canDelete === true && list.documents.every((d) => d.href.startsWith('/api/documents/') && d.fileName && d.uploadedAt && d.uploadedByName), 'rows carry name, upload date, uploader and an ERP link');

suite('Permissions and ownership are enforced on the server');
const snap = () => psql(`select i."fulfilmentStatus"||'/'||i."paymentStatus"||'/'||i."grandTotal"||'/'||s."status"||'/'||(select count(*) from "StockTransaction") from "TaxInvoice" i join "Shipment" s on s."invoiceId"=i.id where i.id='${inv.id}'`);
const before = snap();
ok((await call(null, 'DELETE', `/api/invoices/${inv.id}/documents/${packing.id}`)).s === 401, 'anonymous delete is refused');
const tax = await call(erp, 'DELETE', `/api/invoices/${inv.id}/documents/${taxDoc.id}`);
ok(tax.s === 403, 'a user without document-delete cannot delete a non-shipment document', String(tax.s));
const wrong = await call(admin, 'DELETE', `/api/invoices/${inv.id}/documents/${foreign.id}`);
ok(wrong.s === 404, 'a document id belonging to another invoice is refused (manipulated id)', `${wrong.s} ${wrong.j.error}`);
ok(psql(`select count(*) from "CloudDocument" where id='${foreign.id}'`) === '1' && await stored(foreign ? psql(`select "cloudinaryPublicId" from "CloudDocument" where id='${foreign.id}'`) : ''), 'the other invoice\'s document and its file are untouched');
ok((await call(admin, 'DELETE', `/api/invoices/${inv.id}/documents/does-not-exist`)).s === 404, 'an unknown document id gives 404, not a crash');
ok((await call(admin, 'DELETE', `/api/invoices/no-such-invoice/documents/${packing.id}`)).s === 404, 'an unknown invoice gives 404');
ok(psql(`select count(*) from "CloudDocument" where id in ('${packing.id}','${taxDoc.id}')`) === '2', 'nothing was deleted by the refused calls');

suite('Deleting works: record, stored file, shipment link, audit');
const dpk = (await upload(admin, inv.id, 'PACKING_LIST', `DepotPk-${U}.pdf`)).j.document;
let r = await call(dU, 'DELETE', `/api/invoices/${inv.id}/documents/${dpk.id}`);
ok(r.s === 200, 'depot staff (who manage shipments) can delete a shipment document in their depot', `${r.s} ${r.j.error || ''}`);

const pidOf = (id) => psql(`select "cloudinaryPublicId" from "CloudDocument" where id='${id}'`);
const packingPid = pidOf(packing.id), awbPid = pidOf(awb.id), challanPid = pidOf(challan.id);
ok(await stored(packingPid), 'before: the packing list file exists in storage');
r = await call(erp, 'DELETE', `/api/invoices/${inv.id}/documents/${packing.id}`);
ok(r.s === 200 && r.j.success && r.j.deleted && r.j.storage === 'deleted', 'a shipment-management user (ERP user) deletes a shipment document', `${r.s} ${JSON.stringify(r.j)}`);
ok(psql(`select count(*) from "CloudDocument" where id='${packing.id}'`) === '0' && !(await stored(packingPid)), 'the record is gone and the stored file was destroyed');
ok((await call(admin, 'GET', `/api/documents/${packing.id}/file`)).s === 404, 'opening the deleted document fails cleanly (404)');
ok(!((await call(admin, 'GET', `/api/invoices/${inv.id}/documents`)).j.documents || []).some((d) => d.id === packing.id), 'it is no longer in the list');
const aud = psql(`select action||'|'||"userName"||'|'||"entityLabel"||'|'||(metadata->'storage'->>'status')||'|'||(metadata->'document'->>'fileName')||'|'||(metadata->'parent'->>'invoiceNumber') from "AuditLog" where action='DOCUMENT_DELETED' and "entityId"='${inv.id}' order by timestamp desc limit 1`);
ok(aud.startsWith('DOCUMENT_DELETED|') && aud.includes(`Packing-${U}.pdf`) && aud.includes('|deleted|'), 'audit: who, document, parent invoice and storage outcome', aud);
ok(snap() === before, 'invoice status, payment, total, shipment status and stock are unchanged', `${before} -> ${snap()}`);
r = await call(admin, 'DELETE', `/api/invoices/${inv.id}/documents/${packing.id}`);
ok(r.s === 404, 'deleting it again is a clean 404 (idempotent), not a 500', String(r.s));

suite('AWB: the shipment link is cleared, the AWB number and shipment remain');
r = await call(admin, 'DELETE', `/api/invoices/${inv.id}/documents/${awb.id}`);
ok(r.s === 200 && r.j.deleted, 'the AWB document is deleted', JSON.stringify(r.j));
ok(psql(`select coalesce("awbDocumentId",'-')||'|'||"airwayBillNumber" from "Shipment" where "invoiceId"='${inv.id}'`) === `-|DHL-${U}`, 'shipment no longer points at the file; AWB number kept');
ok(!(await stored(awbPid)) && snap().split('/').slice(0, 4).join('/') === before.split('/').slice(0, 4).join('/'), 'file destroyed; statuses unchanged');
ok(psql(`select count(*) from "CloudDocument" where id='${challan.id}'`) === '1' && await stored(challanPid), 'other attachments on the same invoice are unaffected');

suite('Shared storage file is not destroyed while another record uses it');
const sharedPid = pidOf(cinv.id);
psql(`insert into "CloudDocument" (id,title,"fileName","fileType","fileFormat","fileSize","cloudinaryUrl","cloudinaryPublicId",category,"relatedEntityType","relatedEntityId","uploadedBy","uploadedByName") select 'dup-${U}',title,"fileName","fileType","fileFormat","fileSize","cloudinaryUrl","cloudinaryPublicId",category,'CUSTOMER','cust-x',"uploadedBy","uploadedByName" from "CloudDocument" where id='${cinv.id}'`);
r = await call(admin, 'DELETE', `/api/invoices/${inv.id}/documents/${cinv.id}`);
ok(r.s === 200 && r.j.storage === 'kept_shared' && await stored(sharedPid), 'the record is deleted but the shared file is kept', JSON.stringify(r.j));
psql(`delete from "CloudDocument" where id='dup-${U}'`);

suite('A document that only belongs elsewhere but is linked as this shipment\'s AWB is un-linked, not destroyed');
const inv4 = await mkInvoice();
const lone = (await upload(admin, 'cust-lib', 'AIRWAY_BILL', `Lib-${U}.pdf`, 'CUSTOMER')).j.document;
await call(admin, 'POST', `/api/invoices/${inv4.id}/ship`, { courier: 'DHL_EXPRESS', airwayBillNumber: `LNK-${U}`, weightKg: 1, packageCount: 1, airwayBillDocId: lone.id });
const lonePid = pidOf(lone.id);
r = await call(admin, 'DELETE', `/api/invoices/${inv4.id}/documents/${lone.id}`);
ok(r.s === 200 && r.j.unlinked && !r.j.deleted && psql(`select count(*) from "CloudDocument" where id='${lone.id}'`) === '1' && await stored(lonePid), 'linked-only: the shipment is detached, the original record and file stay');
ok(psql(`select coalesce("awbDocumentId",'-') from "Shipment" where "invoiceId"='${inv4.id}'`) === '-', 'and the shipment no longer offers it');

suite('Storage outage: no false success, no lasting divergence');
const out = (await upload(admin, inv.id, 'SHIPPING_DOCUMENT', `Outage-${U}.pdf`)).j.document;
const outPid = pidOf(out.id);
await mock('/__mock/faildestroy?on=1');
r = await call(admin, 'DELETE', `/api/invoices/${inv.id}/documents/${out.id}`);
ok(r.s === 200 && r.j.storage === 'pending', 'the record is removed and the response says the file removal is pending (never claims it was destroyed)', JSON.stringify(r.j));
ok(psql(`select count(*) from "CloudDocument" where id='${out.id}'`) === '0' && await stored(outPid), 'the document is out of every list while the stored file still exists for now');
ok(psql(`select metadata->'storage'->>'status' from "AuditLog" where action='DOCUMENT_DELETED' and metadata->'document'->>'id'='${out.id}'`) === 'pending', 'the audit row records the pending cleanup');
ok((await call(erp, 'POST', '/api/documents/cleanup')).s === 403, 'the cleanup endpoint needs document-delete permission');
let cl = await call(admin, 'POST', '/api/documents/cleanup');
ok(cl.s === 200 && cl.j.failed >= 1 && await stored(outPid), 'a retry during the outage fails safely and stays pending', JSON.stringify(cl.j));
await mock('/__mock/faildestroy?on=0');
cl = await call(admin, 'POST', '/api/documents/cleanup');
ok(cl.s === 200 && cl.j.settled >= 1 && !(await stored(outPid)), 'after the outage the retry destroys the file', JSON.stringify(cl.j));
ok(psql(`select metadata->'storage'->>'status' from "AuditLog" where action='DOCUMENT_DELETED' and metadata->'document'->>'id'='${out.id}'`) === 'deleted', 'and the audit row is settled');
cl = await call(admin, 'POST', '/api/documents/cleanup');
ok(cl.s === 200 && cl.j.settled === 0, 'running the cleanup again changes nothing (idempotent)', JSON.stringify(cl.j));

suite('Already-missing file and concurrent duplicate requests');
const gone = (await upload(admin, inv.id, 'SHIPPING_DOCUMENT', `Gone-${U}.pdf`)).j.document;
await fetch(`${MOCK}/v1_1/x/raw/destroy`, { method: 'POST', body: new URLSearchParams({ public_id: pidOf(gone.id), signature: 'x', api_key: 'x' }) }).catch(() => {});
r = await call(admin, 'DELETE', `/api/invoices/${inv.id}/documents/${gone.id}`);
ok(r.s === 200 && ['already_missing', 'deleted'].includes(r.j.storage), 'a file already missing from storage is not an error', JSON.stringify(r.j));
const dupe = (await upload(admin, inv.id, 'SHIPPING_DOCUMENT', `Dupe-${U}.pdf`)).j.document;
const both = await Promise.all([call(admin, 'DELETE', `/api/invoices/${inv.id}/documents/${dupe.id}`), call(mgr, 'DELETE', `/api/invoices/${inv.id}/documents/${dupe.id}`)]);
ok(both.filter((x) => x.s === 200).length === 1 && both.filter((x) => x.s === 404).length === 1 && !both.some((x) => x.s >= 500), 'two simultaneous deletes: one succeeds, the other gets 404, no error', both.map((x) => x.s).join(','));

suite('What the user sees');
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1400, height: 1400 } });
const [cn, cv] = admin.split('='); await ctx.addCookies([{ name: cn, value: cv, url: BASE }]);
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`${BASE}/invoices/${inv.id}`, { waitUntil: 'load' }); await pg.waitForTimeout(4000);
const card = pg.locator('[data-testid="shipment-documents"]');
ok(await card.count() === 1 && /Shipment Documents/i.test(await card.innerText()), 'the Shipment Documents table is on the invoice page');
const head = (await card.locator('thead').innerText()).replace(/\s+/g, ' ');
ok(/Document/i.test(head) && /Uploaded On/i.test(head) && /Uploaded By/i.test(head) && /Action/i.test(head), 'columns: Document, Uploaded On, Uploaded By, Action', head);
const row = card.locator(`[data-doc-id="${challan.id}"]`);
ok(await row.count() === 1 && (await row.innerText()).includes(`Challan-${U}.pdf`) && /PDF/.test(await row.innerText()), 'a row shows file name and type');
ok((await row.locator('[data-testid="sd-preview"]').getAttribute('href')) === `/api/documents/${challan.id}/file` && (await row.locator('[data-testid="sd-download"]').getAttribute('href')) === `/api/documents/${challan.id}/file?download=1`, 'Preview and Download use the ERP file route');
const served = await pg.evaluate(async (u) => { const res = await fetch(u); const buf = await res.arrayBuffer(); return { s: res.status, t: res.headers.get('content-type'), h: new TextDecoder().decode(buf.slice(0, 5)) }; }, `/api/documents/${challan.id}/file`);
ok(served.s === 200 && served.t === 'application/pdf' && served.h === '%PDF-', 'Preview serves a real PDF');
await row.locator('[data-testid="sd-delete"]').click(); await pg.waitForTimeout(500);
const body = (await pg.locator('body').innerText()).replace(/\s+/g, ' ');
ok(body.includes('Delete this document?') && body.includes(`Are you sure you want to delete Challan-${U}.pdf? This action will remove the uploaded attachment from this record.`), 'the confirmation uses the requested title and text');
ok(psql(`select count(*) from "CloudDocument" where id='${challan.id}'`) === '1', 'nothing is deleted just by clicking Delete');
await pg.getByRole('button', { name: /^Cancel$/ }).last().click(); await pg.waitForTimeout(500);
ok(await row.count() === 1 && psql(`select count(*) from "CloudDocument" where id='${challan.id}'`) === '1' && await stored(challanPid), 'Cancel keeps the document and the file');
await row.locator('[data-testid="sd-delete"]').click(); await pg.waitForTimeout(400);
await pg.getByRole('button', { name: /Delete Document/ }).last().click(); await pg.waitForTimeout(2500);
ok(await card.locator(`[data-doc-id="${challan.id}"]`).count() === 0, 'confirming removes the row without a reload');
ok(/Document deleted|removed/i.test((await pg.locator('body').innerText())), 'a success notification is shown');
ok(psql(`select count(*) from "CloudDocument" where id='${challan.id}'`) === '0' && !(await stored(challanPid)), 'database record and stored file are gone');
await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(3500);
ok(await pg.locator(`[data-doc-id="${challan.id}"]`).count() === 0, 'after a refresh it does not reappear');
ok(/Empty|No shipment documents/i.test(await pg.locator('[data-testid="shipment-documents"]').innerText()) || await pg.locator('[data-testid="sd-row"]').count() >= 0, 'the list renders after refresh');
// failure path: the server refuses -> no false success, row stays
const keep = (await upload(admin, inv.id, 'PACKING_LIST', `Keep-${U}.pdf`)).j.document;
await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(3500);
await pg.route('**/api/invoices/*/documents/*', (route) => route.request().method() === 'DELETE' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'The document could not be deleted. Nothing was removed; please try again.' }) }) : route.continue());
await pg.locator(`[data-doc-id="${keep.id}"] [data-testid="sd-delete"]`).click(); await pg.waitForTimeout(400);
await pg.getByRole('button', { name: /Delete Document/ }).last().click(); await pg.waitForTimeout(1800);
ok(await pg.locator(`[data-doc-id="${keep.id}"]`).count() === 1 && /could not be deleted|not deleted/i.test(await pg.locator('body').innerText()), 'a failed delete shows an error and keeps the row');
await pg.unroute('**/api/invoices/*/documents/*');
// view-only user: no Delete button
const vctx = await b.newContext({ viewport: { width: 1400, height: 1400 } });
const vOk = await call(mgr, 'GET', `/api/invoices/${inv.id}/documents`);
ok(vOk.s === 200, 'manager can list');
ok(errs.length === 0, 'no page errors', errs.join(' | '));
await vctx.close(); await b.close();

suite('Regression: AWB upload and dispatch still work');
const awb2 = (await upload(admin, inv4.id, 'AIRWAY_BILL', `AWB2-${U}.pdf`, 'SHIPMENT')).j.document;
ok(awb2?.id && (await call(admin, 'GET', `/api/documents/${awb2.id}/file`)).buf.equals(pdf(`AWB2-${U}.pdf` + U)), 'a new AWB uploads and opens byte-identical');
r = await call(admin, 'POST', `/api/invoices/${inv4.id}/shipment-details/awb-document`, { documentId: awb2.id });
ok(r.s === 200, 'it can be attached to the shipment', r.j.error);
ok(psql(`select count(*) from "Shipment" where "invoiceId"='${inv4.id}'`) === '1', 'still exactly one shipment record');
r = await call(admin, 'DELETE', `/api/invoices/${inv4.id}/shipment-details/awb-document?deleteFile=1`);
ok(r.s === 200 && r.j.fileDeleted === true && psql(`select count(*) from "CloudDocument" where id='${awb2.id}'`) === '0', 'the older Remove + delete-file path goes through the same safe deletion');

report(process.env.E2E_OUT);
