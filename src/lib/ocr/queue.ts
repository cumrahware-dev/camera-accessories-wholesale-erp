/**
 * In-process OCR job queue.
 *
 * The database is the source of truth: a record in UPLOADED status is a queued job and PROCESSING is a
 * running one. The in-memory array only decides the order, so a restart loses nothing - `recoverJobs()`
 * re-queues whatever the database still shows as waiting or stuck.
 *
 * Default concurrency is 1 so that a small server never runs more than one OCR job at a time.
 */
import 'server-only';
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { processDocument, addEvent } from './service';

interface Job { id: string; user: { id: string; name: string }; mode: 'initial' | 'reprocess'; done: () => void }
interface QueueState { jobs: Job[]; running: number; recovered: boolean; active: Set<string> }

const g = globalThis as unknown as { __ocrQueue?: QueueState };
const state: QueueState = (g.__ocrQueue ??= { jobs: [], running: 0, recovered: false, active: new Set<string>() });
const MAX = Math.max(1, Number(process.env.OCR_MAX_CONCURRENT_JOBS || 1));
const STALE_MS = 6 * 60 * 1000;

/** True while this server process is holding the job (waiting or running). */
export const isQueued = (id: string) => state.jobs.some((j) => j.id === id) || state.active.has(id);

export function enqueue(id: string, user: Job['user'], mode: Job['mode'] = 'initial') {
  if (isQueued(id)) return;
  let done!: () => void;
  const finished = new Promise<void>((r) => { done = r; });
  state.jobs.push({ id, user, mode, done });
  console.log(`[OCR] OCR JOB QUEUED | id=${id} | mode=${mode}`);
  // `after` keeps a serverless invocation alive until the job settles; without it the platform freezes the
  // process once the response is sent and the job would sit in the queue forever.
  try { after(() => finished); } catch { /* not inside a request (tests, scripts): the in-process pump is enough */ }
  setImmediate(pump);
}

function pump() {
  while (state.running < MAX && state.jobs.length) {
    const job = state.jobs.shift()!;
    state.running++;
    state.active.add(job.id);
    processDocument(job.id, job.user, job.mode)
      .catch((e) => console.warn(`[OCR queue] job ${job.id} ended with an error: ${e?.message}`))
      .finally(() => { state.running--; state.active.delete(job.id); job.done(); setImmediate(pump); });
  }
}

/** Re-queue jobs a previous server process left behind. Safe to call often. */
export async function recoverJobs() {
  if (state.recovered) return;
  state.recovered = true;
  try {
    const stuck = await prisma.ocrDocument.findMany({
      where: { OR: [{ processingStatus: 'UPLOADED' }, { processingStatus: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - STALE_MS) } }], conversionStatus: { not: 'CONVERTED' } },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    for (const d of stuck) {
      if (d.processingStatus === 'PROCESSING') {
        await prisma.ocrDocument.update({ where: { id: d.id }, data: { processingStatus: 'UPLOADED' } });
        await addEvent(d.id, 'OCR_QUEUED', 'Re-queued after the server restarted', null);
      }
      enqueue(d.id, { id: d.createdById, name: d.createdByName });
    }
  } catch (e: any) {
    state.recovered = false;
    console.warn('[OCR queue] recovery failed:', e?.message);
  }
}

export const queueStats = () => ({ waiting: state.jobs.length, running: state.running });
