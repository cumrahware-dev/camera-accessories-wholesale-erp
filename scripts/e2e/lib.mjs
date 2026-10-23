// Shared helpers for the API end-to-end suites. Target: E2E_BASE (default http://127.0.0.1:3108), an ISOLATED database copy.
import fs from 'fs';
export const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3108';
export const CREDS = JSON.parse(fs.readFileSync(process.env.E2E_CREDS, 'utf8'));
const stats = { pass: 0, fail: 0, blocked: 0, failures: [], blockedList: [] };
export const suite = (name) => console.log(`\n=== ${name} ===`);
export const ok = (cond, name, extra = '') => { if (cond) stats.pass++; else { stats.fail++; stats.failures.push(name + (extra ? ' -> ' + extra : '')); } console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  -> ' + extra : ''}`); return !!cond; };
export const blocked = (name, why) => { stats.blocked++; stats.blockedList.push(`${name}: ${why}`); console.log(`BLOCKED  ${name}  (${why})`); };
export const report = (file) => { console.log(`\nRESULT ${JSON.stringify({ pass: stats.pass, fail: stats.fail, blocked: stats.blocked })}`); if (stats.failures.length) console.log('FAILURES:\n - ' + stats.failures.join('\n - ')); if (file) fs.writeFileSync(file, JSON.stringify(stats, null, 2)); return stats; };
export async function login(role) {
  const c = CREDS[role];
  const url = c.depot ? '/api/auth/depot-login' : '/api/auth/login';
  const r = await fetch(BASE + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: c.code }) });
  const ck = (r.headers.getSetCookie()[0] || '').split(';')[0];
  if (!ck) throw new Error(`login ${role} failed ${r.status}`);
  return ck;
}
export async function call(ck, method, url, body, extra = {}) {
  const r = await fetch(BASE + url, { method, headers: { ...(ck ? { cookie: ck } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const buf = Buffer.from(await r.arrayBuffer());
  let j = {}; try { j = JSON.parse(buf.toString()); } catch {}
  return { s: r.status, j, buf, h: r.headers };
}
export const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const near = (a, b, t = 0.011) => Math.abs(Number(a) - Number(b)) <= t;
