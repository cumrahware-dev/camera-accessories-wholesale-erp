/**
 * Full database backup with pg_dump. Only offered when pg_dump exists on THIS server (it usually does not on serverless
 * hosting). Where it is missing, the UI says so and points to the database provider's own backups instead of pretending.
 */
import 'server-only';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);

export async function dumpAvailability(): Promise<{ available: boolean; version?: string; reason?: string }> {
  if (!connection()) return { available: false, reason: 'No database connection string is configured on this server.' };
  try {
    const { stdout } = await run('pg_dump', ['--version'], { timeout: 5000 });
    return { available: true, version: stdout.trim() };
  } catch {
    return { available: false, reason: 'pg_dump is not installed on the server that runs this application (typical for serverless hosting).' };
  }
}

/** Direct (non-pooled) connection when one is configured; credentials go to pg_dump through the environment, not the command line. */
function connection(): Record<string, string> | null {
  const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
    const env: Record<string, string> = {
      PGHOST: u.hostname,
      PGPORT: u.port || '5432',
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
    };
    const ssl = u.searchParams.get('sslmode');
    if (ssl) env.PGSSLMODE = ssl;
    return env;
  } catch {
    return null;
  }
}

/** Starts pg_dump (custom format, restorable with pg_restore) and returns its output as a stream. */
export function startDump(onFinish: (r: { bytes: number; error?: string }) => void): ReadableStream<Uint8Array> {
  const env = connection();
  if (!env) throw new Error('No database connection string is configured.');
  const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-privileges'], { env: Object.assign({ PATH: process.env.PATH || '' }, env) as unknown as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let bytes = 0;
  let stderr = '';
  let settled = false;
  const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60_000);
  child.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-2000); });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on('data', (d: Buffer) => { bytes += d.length; controller.enqueue(new Uint8Array(d)); });
      child.on('error', (e) => { if (settled) return; settled = true; clearTimeout(timer); controller.error(e); onFinish({ bytes, error: e.message }); });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) { controller.close(); onFinish({ bytes }); }
        else { const msg = stderr.replace(/password[^\s]*/gi, '').trim() || `pg_dump exited with code ${code}`; controller.error(new Error(msg)); onFinish({ bytes, error: msg }); }
      });
    },
    cancel() { clearTimeout(timer); child.kill('SIGKILL'); },
  });
}
