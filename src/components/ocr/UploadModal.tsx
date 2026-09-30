'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud, FileText, Image as ImageIcon, X, AlertCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { fmtBytes } from './parts';

const MAX = 15 * 1024 * 1024;
const OK_EXT = /\.(pdf|jpe?g|png)$/i;
const OK_MIME = /^(application\/pdf|image\/(jpeg|png))$/;

type Phase = 'idle' | 'uploading' | 'processing' | 'failed';

export function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const busyRef = useRef(false); // hard guard against double submission
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => { setFile(null); setPhase('idle'); setPct(0); setError(null); setExistingId(null); setFailedId(null); busyRef.current = false; };
  const close = () => { if (phase === 'uploading' || phase === 'processing') return; reset(); onClose(); };

  const choose = (f?: File | null) => {
    if (!f) return;
    setError(null); setExistingId(null); setFailedId(null);
    if (!OK_EXT.test(f.name) || (f.type && !OK_MIME.test(f.type))) return setError('Unsupported file. Upload a PDF, JPG, JPEG or PNG.');
    if (f.size === 0) return setError('The file is empty.');
    if (f.size > MAX) return setError(`File is too large (${fmtBytes(f.size)}). The limit is 15 MB.`);
    setFile(f);
  };

  const start = (allowDuplicate = false) => {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setError(null); setExistingId(null); setFailedId(null); setPhase('uploading'); setPct(0);
    const form = new FormData();
    form.append('file', file);
    if (allowDuplicate) form.append('allowDuplicate', 'true');
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', '/api/ocr-documents');
    xhr.upload.onprogress = (e) => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
    xhr.upload.onload = () => setPhase('processing');
    xhr.timeout = 170000;
    const fail = (msg: string, body?: any) => {
      busyRef.current = false; setPhase('failed'); setError(msg);
      if (body?.existingId) setExistingId(body.existingId);
      else if (body?.id) setFailedId(body.id);
    };
    xhr.ontimeout = () => fail('Reading the document took too long. Try a smaller or clearer file.');
    xhr.onerror = () => fail('Network error. Check your connection and try again.');
    xhr.onload = () => {
      let body: any = null;
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 201 && body?.id) { reset(); onClose(); router.push(`/ocr/${body.id}`); return; }
      fail(body?.error || `Upload failed (HTTP ${xhr.status}).`, body);
    };
    xhr.send(form);
  };

  const busy = phase === 'uploading' || phase === 'processing';
  const Icon = file && /\.pdf$/i.test(file.name) ? FileText : ImageIcon;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Upload Document"
      description="PDF, JPG, JPEG or PNG · up to 15 MB. Nothing is created in the ERP until you review and convert."
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={() => start()} disabled={!file || busy} loading={busy}>
            {phase === 'processing' ? 'Processing document…' : phase === 'uploading' ? 'Uploading…' : 'Start OCR'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!file ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); choose(e.dataTransfer.files?.[0]); }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors ${dragOver ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface'}`}
          >
            <UploadCloud className="h-8 w-8 text-muted" />
            <p className="mt-3 text-sm font-medium text-ink">Drag and drop a document here</p>
            <p className="mt-1 text-xs text-muted">or</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Browse files</Button>
          </div>
        ) : (
          <div className="rounded-xl border border-line p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted"><Icon className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{file.name}</p>
                <p className="text-xs text-muted">{fmtBytes(file.size)} · {file.type || file.name.split('.').pop()?.toUpperCase()}</p>
              </div>
              {!busy && (
                <button type="button" aria-label="Remove file" onClick={reset} className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-ink"><X className="h-4 w-4" /></button>
              )}
            </div>
            {busy && (
              <div className="mt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                  <div className={`h-full rounded-full bg-primary transition-all ${phase === 'processing' ? 'animate-pulse' : ''}`} style={{ width: `${phase === 'processing' ? 100 : pct}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-muted">{phase === 'uploading' ? `Uploading… ${pct}%` : 'Processing document… this can take up to a minute for scanned files.'}</p>
              </div>
            )}
          </div>
        )}
        <input ref={inputRef} type="file" className="hidden" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-soft p-3 text-xs text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>{error}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {existingId && (<>
                  <Button size="sm" variant="outline" onClick={() => { reset(); onClose(); router.push(`/ocr/${existingId}`); }}>Open existing record</Button>
                  <Button size="sm" variant="outline" onClick={() => start(true)}>Upload anyway</Button>
                </>)}
                {failedId && <Button size="sm" variant="outline" onClick={() => { reset(); onClose(); router.push(`/ocr/${failedId}`); }}>Open record to retry</Button>}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
