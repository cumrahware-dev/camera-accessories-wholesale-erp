'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScanText, Upload, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { SearchInput } from '@/components/ui/Input';
import { PillSelect } from '@/components/ui/FilterBar';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useDebounce } from '@/hooks/useDebounce';
import { hasPermission } from '@/lib/rbac';
import { DOC_TYPE_OPTIONS, docTypeLabel } from '@/lib/ocr/doc-types';
import { UploadModal } from '@/components/ocr/UploadModal';
import { OcrStatusBadge, fmtDate, fmtDateTime, fmtMoney, useCan } from '@/components/ocr/parts';

const PAGE_SIZE = 20;
const STATUS_OPTIONS = ['UPLOADED', 'PROCESSING', 'PROCESSED', 'NEEDS_REVIEW', 'CONFIRMED', 'FAILED'].map((v) => ({ value: v, label: v.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));
const CONVERSION_OPTIONS = [{ value: 'NOT_CONVERTED', label: 'Not converted' }, { value: 'CONVERTED', label: 'Converted' }, { value: 'FAILED', label: 'Conversion failed' }];

export default function OcrPage() {
  const router = useRouter();
  const { toast } = useToast();
  const role = useCan();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const [type, setType] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [conversion, setConversion] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);

  const canUpload = hasPermission(role, 'ocr.write');
  const canDelete = hasPermission(role, 'ocr.delete');
  const filtered = !!(q || type !== 'ALL' || status !== 'ALL' || conversion !== 'ALL' || from || to);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (q) p.set('q', q);
      if (type !== 'ALL') p.set('type', type);
      if (status !== 'ALL') p.set('status', status);
      if (conversion !== 'ALL') p.set('conversion', conversion);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const res = await fetch(`/api/ocr-documents?${p}`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const j = await res.json();
      setRows(j.items); setTotal(j.total); setError(false);
    } catch { setError(true); } finally { setLoading(false); }
  }, [page, q, type, status, conversion, from, to]);

  useEffect(() => { setPage(1); }, [q, type, status, conversion, from, to]);
  useEffect(() => { load(); }, [load]);
  // keep "Processing" rows fresh without a manual refresh
  useEffect(() => {
    if (!rows.some((r) => r.processingStatus === 'PROCESSING' || r.processingStatus === 'UPLOADED')) return;
    const t = setInterval(() => { if (!document.hidden) load(true); }, 4000);
    return () => clearInterval(t);
  }, [rows, load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const remove = async () => {
    if (!deleting) return;
    const url = `/api/ocr-documents/${deleting.id}${deleting.conversionStatus === 'CONVERTED' ? '?confirmConverted=true' : ''}`;
    const res = await fetch(url, { method: 'DELETE' });
    if (res.ok) { toast({ title: 'OCR record deleted', variant: 'success' }); setDeleting(null); load(true); }
    else { const j = await res.json().catch(() => ({})); toast({ title: 'Could not delete', description: j.error, variant: 'error' }); setDeleting(null); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document OCR"
        description="Upload a document and convert it into an ERP transaction."
        actions={canUpload ? <Button iconLeft={<Upload className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>Upload Document</Button> : undefined}
      />

      <div className="flex flex-col gap-3">
        <SearchInput placeholder="Search file name, document number, customer or supplier" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <PillSelect label="Document type" value={type} options={DOC_TYPE_OPTIONS} onChange={setType} />
          <PillSelect label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
          <PillSelect label="Conversion" value={conversion} options={CONVERSION_OPTIONS} onChange={setConversion} />
          <label className="flex items-center gap-1.5 text-xs text-muted">From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 md:h-9 rounded-full border border-line bg-white px-3 text-xs text-ink" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 md:h-9 rounded-full border border-line bg-white px-3 text-xs text-ink" />
          </label>
          {filtered && <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setType('ALL'); setStatus('ALL'); setConversion('ALL'); setFrom(''); setTo(''); }}>Clear filters</Button>}
        </div>
      </div>

      {loading ? <SkeletonTable rows={6} cols={8} /> : error ? (
        <ErrorState title="Could not load OCR documents" description="Check your connection and try again." action={<Button variant="outline" onClick={() => load()}>Retry</Button>} />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white">
          <EmptyState
            icon={ScanText}
            title={filtered ? 'No documents match these filters' : 'No OCR documents yet'}
            description={filtered ? 'Try a different search or clear the filters.' : 'Upload an invoice, quotation or other document. It is read by OCR, then you review it before anything is created in the ERP.'}
            action={!filtered && canUpload ? <Button iconLeft={<Upload className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>Upload Document</Button> : undefined}
          />
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableHead>Document</TableHead><TableHead>Detected Type</TableHead><TableHead>Supplier / Customer</TableHead>
              <TableHead>Document Number</TableHead><TableHead>Date</TableHead><TableHead align="right">Amount</TableHead>
              <TableHead>Status</TableHead><TableHead>Created At</TableHead><TableHead align="right">Actions</TableHead>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const party = ['PURCHASE_BILL', 'PURCHASE_INVOICE'].includes(r.documentType) ? r.supplierName : r.customerName;
                return (
                  <TableRow key={r.id} onClick={() => router.push(`/ocr/${r.id}`)}>
                    <TableCell><span className="block max-w-[220px] truncate font-medium text-ink" title={r.fileName}>{r.fileName}</span></TableCell>
                    <TableCell>{r.processingStatus === 'FAILED' || r.processingStatus === 'UPLOADED' ? <span className="text-muted">—</span> : docTypeLabel(r.documentType)}</TableCell>
                    <TableCell><span className="block max-w-[200px] truncate">{party || <span className="text-muted">—</span>}</span></TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{r.documentNumber || <span className="text-muted">—</span>}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.documentDate)}</TableCell>
                    <TableCell align="right" className="tabular-nums">{r.totalAmount ? fmtMoney(r.totalAmount, r.currency) : <span className="text-muted">—</span>}</TableCell>
                    <TableCell><OcrStatusBadge processing={r.processingStatus} conversion={r.conversionStatus} /></TableCell>
                    <TableCell className="text-xs text-muted whitespace-nowrap">{fmtDateTime(r.createdAt)}</TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="outline" onClick={() => router.push(`/ocr/${r.id}`)}>{r.conversionStatus === 'CONVERTED' ? 'View' : 'Review'}</Button>
                        {canDelete && <IconButton label="Delete" variant="ghost" onClick={() => setDeleting(r)}><Trash2 className="h-4 w-4" /></IconButton>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{total} document{total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} iconLeft={<ChevronLeft className="h-3.5 w-3.5" />}>Prev</Button>
              <span>Page {page} of {pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)} iconRight={<ChevronRight className="h-3.5 w-3.5" />}>Next</Button>
            </div>
          </div>
        </>
      )}

      <UploadModal open={uploadOpen} onClose={() => { setUploadOpen(false); load(true); }} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete OCR record?"
        description={deleting?.conversionStatus === 'CONVERTED' ? `This only removes the OCR record and its history. The ERP document ${deleting.convertedDocumentNumber} is not affected.` : 'The uploaded file, extracted data and history will be removed. This cannot be undone.'}
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}
