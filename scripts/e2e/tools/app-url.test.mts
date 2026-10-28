// Unit checks for lib/app-url (development fallback vs production rules). Run: npx tsx scripts/e2e/tools/app-url.test.mts
import { appBaseUrl, appLink, AppUrlError } from '../../../src/lib/app-url.ts';
let bad = 0;
const t = (label: string, env: Record<string, string | undefined>, expect: string | 'throws') => {
  const keep = { ...process.env };
  for (const k of ['APP_BASE_URL', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'NODE_ENV', 'APP_ENV', 'PORT']) delete (process.env as any)[k];
  Object.assign(process.env, env);
  let got: string; try { got = appLink('/quote/x'); } catch (e: any) { got = e instanceof AppUrlError ? 'throws' : `error ${e.message}`; }
  process.env = keep;
  if (got !== expect) { bad++; console.log(`FAIL ${label}: got ${got}, want ${expect}`); } else console.log(`PASS ${label}`);
};
t('production + APP_BASE_URL', { NODE_ENV: 'production', APP_BASE_URL: 'https://erp.aribglobal.com/' }, 'https://erp.aribglobal.com/quote/x');
t('production, older APP_URL still honoured', { NODE_ENV: 'production', APP_URL: 'https://erp.aribglobal.com' }, 'https://erp.aribglobal.com/quote/x');
t('APP_BASE_URL wins over NEXT_PUBLIC_APP_URL', { NODE_ENV: 'production', APP_BASE_URL: 'https://erp.aribglobal.com', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }, 'https://erp.aribglobal.com/quote/x');
t('production, not set', { NODE_ENV: 'production' }, 'throws');
t('production, localhost', { NODE_ENV: 'production', APP_BASE_URL: 'https://localhost:3000' }, 'throws');
t('production, http', { NODE_ENV: 'production', APP_BASE_URL: 'http://erp.aribglobal.com' }, 'throws');
t('production, 127.0.0.1', { NODE_ENV: 'production', APP_URL: 'https://127.0.0.1' }, 'throws');
t('production, garbage', { NODE_ENV: 'production', APP_BASE_URL: 'erp.aribglobal' }, 'throws');
t('development fallback', { NODE_ENV: 'development' }, 'http://localhost:3000/quote/x');
t('development port', { NODE_ENV: 'development', PORT: '3001' }, 'http://localhost:3001/quote/x');
t('development with explicit dev URL', { NODE_ENV: 'development', APP_BASE_URL: 'http://localhost:4000' }, 'http://localhost:4000/quote/x');
process.exit(bad ? 1 : 0);
