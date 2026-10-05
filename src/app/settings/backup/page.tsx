'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Database, Download, FileJson, FileSpreadsheet, HardDrive, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

interface Overview {
  tables: { key: string; label: string; group: string; count: number }[];
  notIncluded: string[];
  runs: { id: string; kind: string; status: string; fileName: string; sizeBytes: number; rowCounts: Record<string, number> | null; note: string; createdByName: string | null; createdAt: string }[];
  databaseBackup: { available: boolean; version?: string; reason?: string };
}

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const fmtWhen = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function DataBackupPage() {
  const { toast } = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/backup', { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || 'Could not load backup information.'); return; }
      setData(j); setError(null);
    } catch { setError('Network error. Please retry.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const download = async (url: string, body: unknown, key: string, okTitle: string) => {
    setBusy(key);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast({ title: 'Backup failed', description: j.error || `The server answered ${res.status}.`, variant: 'error' });
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'backup';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast({ title: okTitle, description: `${name} (${fmtSize(blob.size)})`, variant: 'success' });
    } catch {
      toast({ title: 'Backup failed', description: 'The download was interrupted. Please try again.', variant: 'error' });
    } finally { setBusy(null); load(); }
  };

  if (error) return <ErrorState title="Could not open Data & Backup" description={error} action={<Link href="/settings" className="text-primary text-sm font-semibold">Back to Settings</Link>} />;
  if (!data) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /></div>;

  const total = data.tables.reduce((s, t) => s + t.count, 0);
  const groups = Array.from(new Set(data.tables.map((t) => t.group)));

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Data & Backup' }]} title="Data & Backup" description="Download your business data. Only Super Admins can see this page." />

      <Card>
        <CardHeader><CardTitle><span className="flex items-center gap-2"><FileJson className="h-4 w-4 text-primary" /> Application Data Export</span></CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div role="note" className="flex gap-2 rounded-lg border border-warning-border bg-warning-soft p-3 text-xs text-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>This exports the <b>business records listed below</b> ({total.toLocaleString()} rows right now). It is <b>not</b> a database backup and cannot restore the system on its own. Passwords, access codes and API secrets are never included.</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <div key={g} className="rounded-lg border border-line p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{g}</div>
                <ul className="mt-1.5 space-y-0.5 text-xs">
                  {data.tables.filter((t) => t.group === g).map((t) => <li key={t.key} className="flex justify-between gap-2"><span className="truncate">{t.label}</span><span className="tabular-nums text-muted">{t.count.toLocaleString()}</span></li>)}
                </ul>
              </div>
            ))}
          </div>
          <details className="text-xs text-ink-secondary">
            <summary className="min-h-[44px] cursor-pointer py-2 font-medium md:min-h-0 md:py-0">What is not included</summary>
            <ul className="mt-2 list-disc space-y-0.5 pl-5">{data.notIncluded.map((n) => <li key={n}>{n}</li>)}</ul>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button iconLeft={<FileJson className="h-4 w-4" />} loading={busy === 'json'} disabled={!!busy} onClick={() => download('/api/backup/export', { format: 'json' }, 'json', 'Data export downloaded')}>Download export (JSON, complete)</Button>
            <Button variant="outline" iconLeft={<FileSpreadsheet className="h-4 w-4" />} loading={busy === 'xlsx'} disabled={!!busy} onClick={() => download('/api/backup/export', { format: 'xlsx' }, 'xlsx', 'Excel workbook downloaded')}>Download workbook (Excel)</Button>
          </div>
          <p className="text-[11px] text-muted">JSON has no size limit and keeps every field. The Excel workbook has one sheet per table and is refused if the data is too large for Excel. Files are created when you click and are not kept on the server: save them somewhere safe.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle><span className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" /> Full Database Backup</span></CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.databaseBackup.available ? (
            <>
              <p className="text-xs text-ink-secondary">Creates a complete copy of the whole database with <span className="font-mono">{data.databaseBackup.version}</span> (restorable with <span className="font-mono">pg_restore</span>). <b>It contains everything, including password hashes</b>: store it privately and never share it.</p>
              <Button iconLeft={<HardDrive className="h-4 w-4" />} loading={busy === 'dump'} disabled={!!busy} onClick={() => download('/api/backup/db-dump', {}, 'dump', 'Database backup downloaded')}>Create and download full backup</Button>
            </>
          ) : (
            <div role="note" className="rounded-lg border border-line bg-surface p-3 text-xs text-ink-secondary">
              <div className="mb-1 flex items-center gap-2"><Badge tone="warning">Not available from this server</Badge></div>
              {data.databaseBackup.reason} A real full backup is made by your database provider: enable its automatic daily backups and point-in-time recovery (for example in the Supabase / Neon / RDS dashboard), and test a restore. The export above is a useful extra copy of your records but does not replace it.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Backup history</span></CardTitle></CardHeader>
        <CardContent>
          {data.runs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">No export or backup has been made yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="bg-surface text-left text-[11px] font-semibold uppercase tracking-wider text-muted"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">File</th><th className="px-3 py-2 text-right">Size</th><th className="px-3 py-2 text-right">Rows</th><th className="px-3 py-2">By</th><th className="px-3 py-2">Result</th></tr></thead>
                <tbody className="divide-y divide-line-soft">
                  {data.runs.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtWhen(r.createdAt)}</td>
                      <td className="px-3 py-2">{r.kind === 'DB_DUMP' ? 'Full database' : 'Data export'}</td>
                      <td className="px-3 py-2 font-mono text-[11px] break-all">{r.fileName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtSize(r.sizeBytes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.rowCounts ? Object.values(r.rowCounts).reduce((a, b) => a + b, 0).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2">{r.createdByName || '—'}</td>
                      <td className="px-3 py-2">{r.status === 'COMPLETED' ? <Badge tone="success">Completed</Badge> : <span title={r.note}><Badge tone="danger">Failed</Badge></span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted">History records who made each export and when. The files themselves are not stored here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
