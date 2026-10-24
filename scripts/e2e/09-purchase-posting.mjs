// Posting a purchase invoice: readiness check, specific errors, all-or-nothing under an injected database failure, safe retry, exactly once.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import { BASE, login, call, ok, near, suite, report } from './lib.mjs';
const U = Date.now().toString(36).toUpperCase();
const admin = await login('admin'), erp = await login('erp'), mgr = await login('manager');
const psql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', 'arib_e2e', '-At', '-F', '|', '-c', q], { env: { ...process.env, PGPASSWORD: 'pg' } }).toString().trim();
const dep = (await call(erp, 'GET', '/api/purchase-invoices/depots')).j[0];
const mkSup = async (name) => { const r = (await call(admin, 'POST', '/api/suppliers', { name, email: `p${Math.random().toString(36).slice(2)}@x.test` })).j; return r.supplier || r; };
const mkProd = async (i) => (await call(admin, 'POST', '/api/products', { sku: `PP-${U}-${i}`, name: `Post ${U} ${i}`, brand: 'T', unit: 'Mt', sellingPrice: 3000, wholesalePrice: 3000, purchasePrice: 100, trackSerial: false, useDefaultTax: false, taxRate: 5 })).j.product;
const prods = []; for (let i = 0; i < 5; i++) prods.push(await mkProd(i));
const qtys = [54.62, 45.65, 55.2, 60.21, 45.96];
let seq = 0;
const draft = async (sup) => (await call(erp, 'POST', '/api/purchase-invoices', { supplierId: sup.id, supplierInvoiceNumber: `PP-${U}-${++seq}`, invoiceDate: '2026-10-01', depotId: dep.id, currency: 'AED', items: prods.map((p, i) => ({ productId: p.id, quantity: qtys[i], unitCost: 2950, taxRate: 5 })) })).j;
const state = (inv) => {
  const ids = prods.map((p) => `'${p.id}'`).join(',');
  return { status: psql(`select status from "PurchaseInvoice" where id='${inv.id}'`), stock: Number(psql(`select coalesce(sum(quantity),0) from "DepotInventory" where "productId" in (${ids})`)), moves: Number(psql(`select count(*) from "StockTransaction" where "referenceNumber"='${inv.purchaseNumber}'`)), journals: Number(psql(`select count(*) from "JournalEntry" where "sourceId"='${inv.id}'`)), total: Number(psql(`select coalesce(sum("totalStock"),0) from "Product" where id in (${ids})`)), cost: Number(psql(`select coalesce(sum("purchasePrice"),0) from "Product" where id in (${ids})`)) };
};

suite('Readiness check');
const supA = await mkSup(`Bonn Metals ${U}`);
let inv = await draft(supA);
ok(inv.id && near(inv.grandTotal, 810429.9), 'draft saved: gross 810,429.90', JSON.stringify([inv.subtotal, inv.taxAmount, inv.grandTotal]));
let rc = await call(erp, 'GET', `/api/purchase-invoices/${inv.id}/post-check`);
ok(rc.s === 200 && rc.j.ready === true && rc.j.problems.length === 0 && near(rc.j.financials.inventoryCost, 771838), 'a valid draft is ready to post', JSON.stringify(rc.j.problems));
let st0 = state(inv);
ok(st0.status === 'DRAFT' && st0.stock === 0 && st0.moves === 0 && st0.journals === 0, 'draft touched neither stock nor accounting');

suite('Missing / inactive accounting head is named, nothing changes, retry works');
psql(`update "AccountingHead" set "isActive"=false where id='acc-1410'`);
try {
  rc = await call(erp, 'GET', `/api/purchase-invoices/${inv.id}/post-check`);
  ok(rc.j.ready === false && rc.j.problems.some((m) => /Input VAT \(1410\).*inactive/.test(m)), 'check names the inactive Input VAT head', JSON.stringify(rc.j.problems));
  const r = await call(mgr, 'POST', `/api/purchase-invoices/${inv.id}/post`, {});
  ok(r.s === 409 && /Input VAT/.test(r.j.error) && !/went wrong/i.test(r.j.error), 'post refused with that specific reason', r.j.error);
  const st = state(inv); ok(st.status === 'DRAFT' && st.stock === 0 && st.moves === 0 && st.journals === 0, 'nothing was posted');
  const ck = mgr.split('='); const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } }); await ctx.addCookies([{ name: ck[0], value: ck[1], url: BASE }]);
  const pg = await ctx.newPage(); await pg.goto(`${BASE}/purchases/${inv.id}`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
  await pg.getByRole('button', { name: /Post & receive stock/ }).click(); await pg.waitForTimeout(1500);
  const dlg = pg.getByRole('dialog');
  ok(/cannot be posted yet/.test(await dlg.innerText()) && /Input VAT/.test(await dlg.innerText()), 'confirmation dialog explains the problem');
  ok(await dlg.getByRole('button', { name: 'Post invoice' }).isDisabled(), 'and the Post button is disabled');
  await b.close();
} finally { psql(`update "AccountingHead" set "isActive"=true where id='acc-1410'`); }
rc = await call(erp, 'GET', `/api/purchase-invoices/${inv.id}/post-check`);
ok(rc.j.ready === true, 'after the head is active again the invoice is ready');

suite('A database failure part-way through posting rolls everything back');
const supB = await mkSup(`INJECT Metals ${U}`);
const inv2 = await draft(supB); const b2 = state(inv2);
psql(`create or replace function _inject() returns trigger as $$ begin if new.narration like '%INJECT%' then raise exception 'injected database failure'; end if; return new; end $$ language plpgsql`);
psql(`create trigger _inject_t before insert on "JournalEntry" for each row execute function _inject()`);
let failed;
try { failed = await call(mgr, 'POST', `/api/purchase-invoices/${inv2.id}/post`, {}); } finally { psql(`drop trigger if exists _inject_t on "JournalEntry"`); psql(`drop function if exists _inject()`); }
ok(failed.s >= 400 && failed.s < 600 && /ref [A-Z0-9]{6}/.test(failed.j.error || '') && !/^Something went wrong/.test(failed.j.error), 'the UI gets a specific message with a reference code', `${failed.s} ${failed.j.error}`);
const a2 = state(inv2);
ok(a2.status === 'DRAFT' && a2.stock === b2.stock && a2.moves === 0 && a2.journals === 0 && a2.total === b2.total && near(a2.cost, b2.cost, 0.0001), 'rolled back: still DRAFT, no stock, no movements, no journal, product totals and costs unchanged', JSON.stringify([b2, a2]));
const retry = await Promise.all([1, 2, 3].map(() => call(mgr, 'POST', `/api/purchase-invoices/${inv2.id}/post`, {})));
ok(retry.filter((x) => x.s === 200).length === 1, 'retry after the fault is cleared: three simultaneous posts, exactly one succeeds', retry.map((x) => x.s).join());
const a3 = state(inv2);
ok(a3.status === 'POSTED' && near(a3.stock - b2.stock, 261.64, 0.0005) && a3.moves === 5 && a3.journals === 1, 'posted once: +261.640 Mt, 5 movements, 1 journal', JSON.stringify(a3));
ok(near(a3.total - b2.total, 261.64, 0.0005), 'product totals match the depot stock');

suite('Default accounts missing from the chart (restored data) are restored, then posting works');
const supC = await mkSup(`Leiden Building Materials ${U}`);
const inv3 = await draft(supC);
const codes = ['1300', '1410', '2100'];
for (const c of codes) psql(`update "AccountingHead" set code='X${c}' where code='${c}'`);
try {
  ok(psql(`select count(*) from "AccountingHead" where code in ('1300','1410','2100')`) === '0', 'setup: the three accounts are absent under their codes');
  const rc3 = await call(erp, 'GET', `/api/purchase-invoices/${inv3.id}/post-check`);
  ok(rc3.j.ready === true, 'readiness does not block on accounts that posting restores', JSON.stringify(rc3.j.problems));
  const p3 = await call(mgr, 'POST', `/api/purchase-invoices/${inv3.id}/post`, {});
  ok(p3.s === 200, 'posted; the missing accounts were restored', `${p3.s} ${p3.j.error || ''}`);
  ok(psql(`select count(*) from "AccountingHead" where code in ('1300','1410','2100') and "isActive"`) === '3', 'accounts 1300, 1410, 2100 exist again and are active');
  const j3 = psql(`select l."accountCode", l.debit, l.credit from "JournalLine" l join "JournalEntry" e on e.id=l."journalEntryId" where e."sourceId"='${inv3.id}'`).split('\n').map((r) => r.split('|'));
  ok(j3.length === 3 && near(j3.reduce((x, r) => x + Number(r[1]) - Number(r[2]), 0), 0), 'journal balances', JSON.stringify(j3));
} finally {
  // put the original accounts back under their codes (the restored copies are removed only if unused)
  psql(`delete from "AccountingHead" h where h.code in ('1300','1410','2100') and not exists (select 1 from "JournalLine" l where l."accountingHeadId"=h.id)`);
  for (const c of codes) psql(`update "AccountingHead" set code='${c}' where code='X${c}' and not exists (select 1 from "AccountingHead" z where z.code='${c}')`);
}

suite('Posting a valid invoice');
const t0 = Date.now(); const good = await call(mgr, 'POST', `/api/purchase-invoices/${inv.id}/post`, {}); const ms = Date.now() - t0;
ok(good.s === 200 && good.j.status === 'POSTED', `posted (${ms} ms)`, `${good.s} ${good.j.error || ''}`);
const jl = psql(`select l."accountCode", l.debit, l.credit from "JournalLine" l join "JournalEntry" e on e.id=l."journalEntryId" where e."sourceId"='${inv.id}'`).split('\n').map((r) => r.split('|'));
ok(jl.length === 3 && near(jl.reduce((s, r) => s + Number(r[1]) - Number(r[2]), 0), 0) && jl.some((r) => r[0] === '1300' && near(r[1], 771838)) && jl.some((r) => r[0] === '1410' && near(r[1], 38591.9)) && jl.some((r) => r[0] === '2100' && near(r[2], 810429.9)), 'journal balances: Dr 1300 771,838.00 / Dr 1410 38,591.90 / Cr 2100 810,429.90', JSON.stringify(jl));
const again = await call(mgr, 'POST', `/api/purchase-invoices/${inv.id}/post`, {}); const a4 = state(inv);
ok(again.s === 409 && a4.moves === 5 && a4.journals === 1, 'a second post is refused; no duplicate movements or entries');
ok((await call(erp, 'POST', `/api/purchase-invoices/${inv.id}/post`, {})).s === 403, 'ERP user cannot post (permission unchanged)');
ok((await call(mgr, 'PUT', `/api/purchase-invoices/${inv.id}`, { supplierId: supA.id })).s === 409, 'posted invoice stays locked');
report();
