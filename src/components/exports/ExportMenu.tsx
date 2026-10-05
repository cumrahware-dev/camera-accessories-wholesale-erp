'use client';

import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileText, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/DropdownMenu';
import { useToast } from '@/components/ui/Toast';

/** Downloads a file from the server. A failure is reported to the user instead of navigating to a JSON error page. */
export async function downloadFrom(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, error: j.error || `The download failed (${res.status}).` };
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'download';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Network error. Please try again.' };
  }
}

export interface ExportMenuProps {
  label: string;
  /** Builds the download URL for a format, using the screen's CURRENT filters. */
  urlFor: (format: 'xlsx' | 'csv') => string;
  /** Extra items (e.g. PDF) shown under the spreadsheet formats. */
  extra?: { label: string; onSelect: () => void | Promise<void> }[];
  size?: 'sm' | 'md';
  disabled?: boolean;
}

export function ExportMenu({ label, urlFor, extra, size, disabled }: ExportMenuProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (format: 'xlsx' | 'csv') => {
    setBusy(true);
    const r = await downloadFrom(urlFor(format));
    setBusy(false);
    if (!r.ok) toast({ title: 'Download failed', description: r.error, variant: 'error' });
    else toast({ title: `${format.toUpperCase()} downloaded`, variant: 'success' });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} loading={busy} disabled={disabled} iconLeft={<Download className="h-4 w-4" />} iconRight={<ChevronDown className="h-3.5 w-3.5" />}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => run('xlsx')}><FileSpreadsheet className="h-4 w-4 text-success" /> Excel (.xlsx)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('csv')}><FileText className="h-4 w-4 text-muted" /> CSV (.csv)</DropdownMenuItem>
        {extra?.map((e) => (
          <DropdownMenuItem key={e.label} onSelect={() => { void e.onSelect(); }}><FileText className="h-4 w-4 text-danger" /> {e.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
