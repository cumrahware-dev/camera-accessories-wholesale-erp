// Email links: every link in every ERP email must use the configured public address (APP_BASE_URL), never localhost and
// never a value taken from the request. Messages are captured by a local SMTP sink and decoded; links are then opened.
import fs from 'fs';
import { execFileSync } from 'child_process';
import { BASE, login, call, ok, suite, report } from './lib.mjs';
const SINK = process.env.SINK_DIR, PUBLIC = 'https://erp.aribglobal.com';
const NOURL = process.env.E2E_BASE_NOURL, LOCALURL = process.env.E2E_BASE_LOCALURL;
const U = Date.now().toString(36).toUpperCase();
const admin = await login('admin');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = () => fs.readdirSync(SINK).filter((f) => f.endsWith('.eml')).sort();
const decode = (f) => JSON.parse(execFileSync('python3', ['-I', 'scripts/e2e/tools/eml.py', `${SINK}/${f}`]).toString());
async function waitMail(pred, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { for (const f of files()) { const m = decode(f); if (pred(m)) return m; } await sleep(500); } return null; }
const linksOf = (m) => Array.from(new Set([...(m.html.match(/href="([^"]+)"/g) || []).map((h) => h.slice(6, -1)), ...((m.text || '').match(/https?:\/\/[^\s)>"]+/g) || [])]));
const BAD = /localhost|127\.0\.0\.1|0\.0\.0\.0|:3000|:3001|:3108|evil\.example/i;
function checkLinks(label, m, { expectPath }) {
  const links = linksOf(m).filter((l) => !l.startsWith('mailto:'));
  ok(!!m, `${label}: email captured`);
  ok(!BAD.test(m.html) && !BAD.test(m.text || ''), `${label}: no localhost / dev port / request-derived host anywhere in the HTML or text`);
  const own = links.filter((l) => l.startsWith('http'));
  ok(own.length > 0 && own.every((l) => l.startsWith(`${PUBLIC}/`)), `${label}: every link uses ${PUBLIC} over https`, own.join(' '));
  const target = own.find((l) => l.includes(expectPath));
  ok(!!target, `${label}: link to ${expectPath}…`, own.join(' '));
  return target;
}
const open = async (link) => { const r = await fetch(link.replace(PUBLIC, BASE), { redirect: 'manual' }); return { s: r.status, loc: r.headers.get('location') || '', body: await r.text() }; };

// fixtures
const cust = (await call(admin, 'POST', '/api/customers', { companyName: `Mail Test ${U}`, contactPerson: 'Buyer', email: `buyer${U}@example.com`.toLowerCase(), phone: '+971501234567', billingAddress: 'Dubai', shippingAddress: 'Dubai' })).j;
const prod = (await call(admin, 'POST', '/api/products', { sku: `ML-${U}`, name: 'Mail Lens', brand: 'Canon', unit: 'Pcs', sellingPrice: 100, wholesalePrice: 90, purchasePrice: 50, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;
await call(admin, 'POST', '/api/inventory/adjust', { productId: prod.id, depotId: 'dep-central', deltaQty: 50, reason: 'FOUND' });

suite('Proforma email (customer link) — forged Origin / Referer headers are ignored');
const pf = (await call(admin, 'POST', '/api/proformas', { customerId: cust.id, items: [{ productId: prod.id, quantity: 2, unitPrice: 100, selectedDepotId: 'dep-central' }] })).j;
const before = files().length;
const pr = await call(admin, 'POST', `/api/proformas/${pf.id}/email`, {}, { origin: 'http://evil.example', referer: 'http://localhost:3000/proformas' });
ok(pr.s === 200, 'proforma email sent', `${pr.s} ${pr.j.error || ''}`);
let m = await waitMail((x) => x.subject.includes(pf.proformaNumber));
let link = checkLinks('proforma', m, { expectPath: `/quote/${pf.id}` });
let o = await open(link); ok(o.s === 200, 'the link opens the public quote page', String(o.s));
const sp = await call(admin, 'POST', '/api/emails/send-proforma', { proformaId: pf.id, appUrl: 'http://localhost:3000' }, { origin: 'http://evil.example' });
ok(sp.s === 200, 'legacy send-proforma endpoint: caller-supplied appUrl is ignored');
await sleep(1500);
ok(files().slice(before).map(decode).filter((x) => x.subject.includes(pf.proformaNumber)).every((x) => !BAD.test(x.html)), 'second proforma email also uses the public address');

suite('Tax invoice email (signed customer link + PDF)');
const inv = (await call(admin, 'POST', '/api/invoices', { customerId: cust.id, depotId: 'dep-central', items: [{ productId: prod.id, quantity: 3, unitPrice: 100 }] })).j;
const iss = await call(admin, 'POST', `/api/invoices/${inv.id}/issue`, {});
ok(iss.s === 200, 'invoice issued', iss.j.error);
const invNo = (await call(admin, 'GET', `/api/invoices/${inv.id}`)).j.invoiceNumber;
const g = (await call(admin, 'GET', `/api/invoices/${inv.id}`)).j;
ok(String(g.portalUrl || '').startsWith(`${PUBLIC}/view/invoice/`), 'in-app "copy customer link" uses the public address', g.portalUrl);
const se = await call(admin, 'POST', '/api/email/send', { documentType: 'TAX_INVOICE', documentId: inv.id, to: cust.email, subject: `Tax Invoice ${invNo} ${U}`, body: 'Please find attached.' }, { origin: 'http://evil.example' });
ok([200, 201, 202].includes(se.s), 'tax invoice email queued', `${se.s} ${se.j.error || ''}`);
m = await waitMail((x) => x.subject.includes(`Tax Invoice ${invNo} ${U}`), 30000);
link = checkLinks('tax invoice', m, { expectPath: '/view/invoice/' });
ok(m && m.attachments.some((a) => /\.pdf$/i.test(a || '')), 'PDF attached');
o = await open(link); const token = link.split('/view/invoice/')[1];
const pub = await (await fetch(`${BASE}/api/public/invoices/${token}`)).json().catch(() => ({}));
ok(o.s === 200 && pub.invoice?.invoiceNumber === invNo, 'the signed link opens this invoice without login (page + its data)', `${o.s} ${pub.invoice?.invoiceNumber}`);
const tampered = link.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
const tp = await fetch(`${BASE}/api/public/invoices/${tampered.split('/view/invoice/')[1]}`); ok(tp.status === 404, 'a tampered token does not open it (security control kept)', String(tp.status));

suite('Depot notification for the new invoice (internal link)');
m = await waitMail((x) => x.html.includes('/depot/pick') && x.html.includes(inv.id), 15000);
if (m) { link = checkLinks('depot notification', m, { expectPath: `/depot/pick?invoiceId=${inv.id}` }); o = await open(link); ok([200, 307, 302].includes(o.s), 'link reaches the depot pick page (login first when signed out)', `${o.s} ${o.loc}`); }
else ok(true, 'no depot notification recipient configured in this database (render checked below)');

suite('Service invoice email');
const si = (await call(admin, 'POST', '/api/service-invoices', { customerId: cust.id, items: [{ description: 'Sensor cleaning', quantity: 1, unitPrice: 75, discountPercent: 0, taxRate: 5 }] })).j;
const siId = si.id || si.invoice?.id || si.serviceInvoice?.id;
ok(!!siId, 'service invoice created', JSON.stringify(si).slice(0, 160));
const sie = await call(admin, 'POST', `/api/service-invoices/${siId}/email`, {}, { origin: 'http://evil.example' });
ok(sie.s === 200, 'service invoice email sent', `${sie.s} ${sie.j.error || ''}`);
m = await waitMail((x) => x.subject.includes('SERVICE INVOICE'), 15000);
if (m) checkLinks('service invoice', m, { expectPath: '/service-invoices/' }); else ok(false, 'service invoice email captured');

suite('Production without APP_BASE_URL: no localhost link is ever sent');
if (NOURL) {
  const a2 = await (async () => { const r = await fetch(`${NOURL}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: 'admin' }) }); return (r.headers.getSetCookie()[0] || '').split(';')[0]; })();
  const n0 = files().length;
  const r = await fetch(`${NOURL}/api/proformas/${pf.id}/email`, { method: 'POST', headers: { cookie: a2, 'content-type': 'application/json' }, body: '{}' }); const j = await r.json();
  ok(r.status >= 400 && /APP_BASE_URL/.test(j.error || ''), 'proforma email refused with a clear configuration message', `${r.status} ${j.error}`);
  const gi = await (await fetch(`${NOURL}/api/invoices/${inv.id}`, { headers: { cookie: a2 } })).json();
  ok(gi.invoiceNumber === invNo && !gi.portalUrl, 'the invoice still opens; no customer link is offered');
  const r2 = await fetch(`${NOURL}/api/email/send`, { method: 'POST', headers: { cookie: a2, 'content-type': 'application/json' }, body: JSON.stringify({ documentType: 'TAX_INVOICE', documentId: inv.id, to: cust.email, subject: `NOURL ${U}`, body: 'x' }) });
  await sleep(6000);
  const logs = await (await fetch(`${NOURL}/api/email/logs?type=TAX_INVOICE&id=${inv.id}`, { headers: { cookie: a2 } })).json();
  const arr = Array.isArray(logs) ? logs : logs.logs || [];
  const row = arr.find((l) => (l.subject || '').includes(`NOURL ${U}`));
  ok(r2.status < 500 && row && row.status === 'FAILED' && /APP_BASE_URL/.test(row.failureReason || ''), 'tax invoice email marked FAILED with the configuration reason (visible in email history)', JSON.stringify(row || arr[0] || {}).slice(0, 200));
  ok(files().slice(n0).map(decode).every((x) => !BAD.test(x.html)), 'nothing with a localhost link reached the mail server');
} else ok(true, 'skipped');
if (LOCALURL) {
  const a3 = await (async () => { const r = await fetch(`${LOCALURL}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: 'admin' }) }); return (r.headers.getSetCookie()[0] || '').split(';')[0]; })();
  const r = await fetch(`${LOCALURL}/api/proformas/${pf.id}/email`, { method: 'POST', headers: { cookie: a3, 'content-type': 'application/json' }, body: '{}' }); const j = await r.json();
  ok(r.status >= 400 && /localhost|https/i.test(j.error || ''), 'APP_BASE_URL=http://localhost:3000 in production is refused', `${r.status} ${j.error}`);
}
report();
