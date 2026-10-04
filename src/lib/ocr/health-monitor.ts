/**
 * Automatic OCR health check: pings the OCR service every OCR_HEALTH_INTERVAL_MINUTES (default 10) and logs the
 * result. The ping also keeps a sleeping host (e.g. Render free tier) warm so the next upload is not a cold start.
 * Needs a long-running Node server; on serverless hosts use an external cron/uptime monitor on the OCR /health URL.
 */
import 'server-only';
import { checkOcrHealth, type OcrHealthResult } from '@/lib/ocr-client';

export interface OcrHealthSnapshot { at: string; connected: boolean; reason: string; detail: string; ms: number }
const g = globalThis as unknown as { __ocrHealth?: { timer?: ReturnType<typeof setInterval>; last?: OcrHealthSnapshot } };
const state = (g.__ocrHealth ??= {});

export const lastOcrHealth = () => state.last ?? null;

export async function runOcrHealthCheck(): Promise<OcrHealthSnapshot> {
  const t0 = Date.now();
  let h: OcrHealthResult;
  try { h = await checkOcrHealth(); } catch (e: any) { h = { connected: false, reason: 'OCR service unavailable', detail: e?.message || 'check failed' } as OcrHealthResult; }
  const snap = { at: new Date().toISOString(), connected: h.connected, reason: h.reason, detail: h.detail, ms: Date.now() - t0 };
  const changed = state.last && state.last.connected !== snap.connected;
  state.last = snap;
  const line = `[OCR health] ${snap.connected ? 'OK' : 'DOWN'} | ${snap.reason} | ${snap.detail} | ${snap.ms}ms`;
  if (snap.connected) console.log(changed ? `${line} | RECOVERED` : line); else console.warn(line);
  return snap;
}

export function startOcrHealthMonitor() {
  if (state.timer) return;
  if (!process.env.OCR_API_URL?.trim()) return; // OCR not configured: nothing to monitor
  const minutes = Math.max(1, Number(process.env.OCR_HEALTH_INTERVAL_MINUTES) || 10);
  void runOcrHealthCheck();
  state.timer = setInterval(() => { void runOcrHealthCheck(); }, minutes * 60_000);
  state.timer.unref?.();
  console.log(`[OCR health] automatic check every ${minutes} min`);
}
