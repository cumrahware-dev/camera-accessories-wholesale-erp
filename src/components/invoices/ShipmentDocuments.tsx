'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import CloudinaryUploadModal from '@/components/documents/CloudinaryUploadModal';

export const SHIPMENT_DOCS_CHANGED = 'shipment-docs-changed';

interface Doc { id: string; title: string; fileName: string; fileType: string; fileSize: number; category: string; categoryLabel: string; uploadedAt: string; uploadedByName: string; href: string; isAwb: boolean }

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const kind = (t: string) => (/pdf/i.test(t) ? 'PDF' : /image/i.test(t) ? 'Image' : t || 'File');
const when = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const btn = 'inline-flex items-center rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-surface-muted';

/**
 * Every shipment document attached to an invoice (airway bills, packing lists, delivery challans, commercial invoices,
 * other attachments) with Preview / Download / Delete. It reads and deletes the existing document records - there is no
 * second document store. Delete always asks first and only reports success after the server confirmed it.
 */
export function ShipmentDocuments({ invoiceId, invoiceNumber, canUpload, onChanged }: { invoiceId: string; invoiceNumber?: string; canUpload: boolean; onChanged?: () => void }) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<Doc | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/invoices/${invoiceId}/documents`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setLoadError(j.error || 'The shipment documents could not be loaded.'); return; }
      setDocs(j.documents || []); setCanDelete(!!j.canDelete); setLoadError(null);
    } catch (e: any) { setLoadError(e?.message || 'Network error'); }
  }, [invoiceId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener(SHIPMENT_DOCS_CHANGED, h);
    return () => window.removeEventListener(SHIPMENT_DOCS_CHANGED, h);
  }, [load]);

  const confirmDelete = async () => {
    if (!target || deleting) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/invoices/${invoiceId}/documents/${target.id}`, { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404) {
        // already gone (another tab / user): show the truth instead of an error
        setTarget(null); await load();
        toast({ title: 'Already deleted', description: j.error || 'This document no longer exists.', variant: 'info' } as any);
        return;
      }
      if (!r.ok) { toast({ title: 'Document not deleted', description: j.error || 'The document could not be deleted.', variant: 'error' } as any); return; }
      setDocs((cur) => (cur || []).filter((d) => d.id !== target.id));
      setTarget(null);
      toast({ title: 'Document deleted', description: j.storage === 'pending' ? 'It was removed from this record. The stored file will be cleared automatically shortly.' : `${target.fileName} was removed.`, variant: 'success' } as any);
      window.dispatchEvent(new Event(SHIPMENT_DOCS_CHANGED));
      await load();
      onChanged?.();
    } catch (e: any) {
      toast({ title: 'Document not deleted', description: e?.message || 'Network error - nothing was removed.', variant: 'error' } as any);
    } finally { setDeleting(false); }
  };

  return (
    <Card className="p-5 space-y-3 text-xs" data-testid="shipment-documents">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Shipment Documents</h3>
        {canUpload && <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)} data-testid="sd-upload">Upload document</Button>}
      </div>
      {loadError && <div role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-2.5 text-danger">{loadError}</div>}
      {docs && docs.length === 0 && !loadError && <p className="text-muted" data-testid="sd-empty">No shipment documents uploaded yet.</p>}
      {docs && docs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left" data-testid="sd-table">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted">
                <th className="py-1.5 pr-3 font-semibold">Document</th>
                <th className="py-1.5 pr-3 font-semibold whitespace-nowrap">Uploaded On</th>
                <th className="py-1.5 pr-3 font-semibold">Uploaded By</th>
                <th className="py-1.5 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-t border-line-soft align-top" data-testid="sd-row" data-doc-id={d.id}>
                  <td className="py-2 pr-3 min-w-[160px]">
                    <p className="font-semibold text-ink break-all" title={d.fileName}>{d.fileName}</p>
                    <p className="text-[11px] text-muted">{d.categoryLabel} · {kind(d.fileType)} · {kb(d.fileSize)}</p>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-ink">{when(d.uploadedAt)}</td>
                  <td className="py-2 pr-3 text-ink">{d.uploadedByName || '—'}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <a href={d.href} target="_blank" rel="noopener noreferrer" className={btn} data-testid="sd-preview">Preview</a>
                      <a href={`${d.href}?download=1`} className={btn} data-testid="sd-download">Download</a>
                      {canDelete && <button type="button" onClick={() => setTarget(d)} className="inline-flex items-center rounded-md border border-danger-border px-2 py-1 text-[11px] font-semibold text-danger hover:bg-danger-soft" data-testid="sd-delete">Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!target}
        onClose={() => { if (!deleting) setTarget(null); }}
        onConfirm={confirmDelete}
        title="Delete this document?"
        description={`Are you sure you want to delete ${target?.fileName || 'this document'}? This action will remove the uploaded attachment from this record.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete Document'}
        cancelLabel="Cancel"
        destructive
        loading={deleting}
      />

      {uploadOpen && (
        <CloudinaryUploadModal
          isOpen={true}
          onClose={() => setUploadOpen(false)}
          defaultCategory="PACKING_LIST"
          defaultEntityType="INVOICE"
          defaultEntityId={invoiceId}
          defaultEntityLabel={invoiceNumber ? `Shipment document for ${invoiceNumber}` : 'Shipment document'}
          onUploaded={() => { setUploadOpen(false); load(); window.dispatchEvent(new Event(SHIPMENT_DOCS_CHANGED)); }}
        />
      )}
    </Card>
  );
}
