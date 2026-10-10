'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, XCircle, ArrowRightCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { DESTINATIONS, DestinationKey, OcrDocType, destinationsFor, docTypeLabel, partyFor } from '@/lib/ocr/doc-types';
import { fmtMoney } from './parts';

export function ConvertPanel({ doc, dirty, canConvert, onChanged, onReload }: { doc: any; dirty: boolean; canConvert: boolean; onChanged: () => void; onReload?: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const options = destinationsFor(doc.documentType as OcrDocType);
  const [dest, setDest] = useState<DestinationKey | ''>('');
  const [ackDup, setAckDup] = useState(false);
  const [ackFlow, setAckFlow] = useState(false);
  const [depotId, setDepotId] = useState('');
  const [depots, setDepots] = useState<{ value: string; label: string }[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ message: string; errors?: string[] } | null>(null);

  useEffect(() => { setDest(options.find((o) => o.available)?.key ?? options[0]?.key ?? ''); setAckDup(false); setAckFlow(false); }, [doc.documentType]); // eslint-disable-line
  useEffect(() => {
    if ((dest !== 'TAX_INVOICE' && dest !== 'PURCHASE_BILL') || depots.length) return;
    fetch('/api/depots?status=ACTIVE').then((r) => r.json()).then((j) => {
      const list = (Array.isArray(j) ? j : j.depots ?? []).map((d: any) => ({ value: d.id, label: d.name }));
      setDepots(list); setDepotId(list[0]?.value ?? '');
    }).catch(() => {});
  }, [dest, depots.length]);

  const chosen = dest ? DESTINATIONS[dest] : null;
  const check = (dest && doc.checks?.[dest]) || { errors: [], warnings: [], duplicates: [] };
  const hasDup = (check.duplicates || []).length > 0;
  const blockers: string[] = useMemo(() => {
    const b: string[] = [...(check.errors || [])];
    if (dirty) b.unshift('You have unsaved changes. Save them first so the checks below reflect your edits.');
    return b;
  }, [check, dirty]);
  const ready = !!chosen?.available && blockers.length === 0 && (!hasDup || ackDup) && (dest !== 'TAX_INVOICE' || ackFlow) && (dest !== 'PURCHASE_BILL' || !depots.length || !!depotId) && canConvert;
  const isPurchase = partyFor(doc.documentType) === 'supplier';

  // The supplier's own tax rate, applied to every line only when a person clicks (the document printed tax but no line has a %).
  const applyTaxRate = async (rate: number) => {
    setBusy(true);
    try {
      const lines = doc.lineItems.map((l: any) => {
        const net = Math.round((l.quantity * l.unitPrice - l.discount) * 100) / 100;
        return { ocrIndex: l.ocrIndex ?? null, description: l.description, sku: l.sku, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRate: rate, taxAmount: Math.round(net * rate) / 100, total: l.total, matchedProductId: l.matchedProductId };
      });
      const res = await fetch(`/api/ocr-documents/${doc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineItems: lines }) });
      if (!res.ok) { toast({ title: 'Could not apply the tax rate', variant: 'error' }); return; }
      toast({ title: `Tax ${rate}% applied to every line`, variant: 'success' });
      (onReload ?? onChanged)();
    } finally { setBusy(false); }
  };

  const convert = async () => {
    if (busy || !dest) return;
    setBusy(true); setServerError(null);
    try {
      const res = await fetch(`/api/ocr-documents/${doc.id}/convert`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: dest, acknowledgeDuplicates: ackDup, acknowledgeInvoiceWorkflow: ackFlow, depotId: depotId || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setServerError({ message: j.error || 'Conversion failed.', errors: j.errors }); setConfirming(false); onChanged(); return; }
      toast({ title: `${chosen?.label} ${j.number} created`, description: 'Opening the new document…', variant: 'success' });
      router.push(j.link);
    } catch { setServerError({ message: 'Network error. Nothing was confirmed; check the OCR record and try again.' }); setConfirming(false); }
    finally { setBusy(false); }
  };

  if (doc.conversionStatus === 'CONVERTED') {
    const isTax = doc.convertedDocumentType === 'TAX_INVOICE';
    const isPurch = doc.convertedDocumentType === 'PURCHASE_INVOICE';
    const isService = doc.convertedDocumentType === 'SERVICE_INVOICE';
    const href = isTax
      ? `/invoices/${doc.convertedDocumentId}`
      : isPurch
      ? `/purchases/${doc.convertedDocumentId}`
      : isService
      ? `/service-invoices/${doc.convertedDocumentId}`
      : `/proformas/${doc.convertedDocumentId}`;
    const lbl = isTax
      ? 'Tax Invoice'
      : isPurch
      ? 'Purchase Invoice'
      : isService
      ? 'Service Invoice'
      : 'Proforma';
    return (
      <div className="flex items-start gap-3 rounded-xl border border-success-border bg-success-soft p-4 text-sm">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div><p className="font-semibold text-ink">Converted to {lbl} {doc.convertedDocumentNumber}</p>
          <Link href={href} className="text-primary hover:underline">View the ERP document</Link></div>
      </div>
    );
  }
  if (doc.processingStatus === 'FAILED' || doc.processingStatus === 'UPLOADED' || doc.processingStatus === 'PROCESSING') {
    return <p className="text-sm text-muted">Conversion is available once the document has been processed successfully.</p>;
  }
  if (options.length === 0) {
    return <p className="text-sm text-muted">There is no ERP destination for a document of type “{docTypeLabel(doc.documentType)}”. Choose the correct document type above if it was misdetected.</p>;
  }

  return (
    <div className="space-y-4">
      <Select label="Convert To" value={dest} onChange={(e) => { setDest(e.target.value as DestinationKey); setAckDup(false); setAckFlow(false); setServerError(null); }}
        options={options.map((o) => ({ value: o.key, label: o.available ? o.label : `${o.label} (not available)` }))} />
      {chosen && <p className="text-xs text-ink-secondary">{chosen.note}</p>}

      {(dest === 'TAX_INVOICE' || dest === 'PURCHASE_BILL') && chosen?.available && depots.length > 0 && (
        <Select label={dest === 'PURCHASE_BILL' ? 'Receiving depot' : 'Fulfilment depot'} value={depotId} onChange={(e) => setDepotId(e.target.value)} options={depots} />
      )}

      {blockers.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-danger"><XCircle className="h-4 w-4" /> Fix these before converting</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-danger">{blockers.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {(check.discrepancies || []).length > 0 && (
        <div className="rounded-lg border border-warning-border bg-warning-soft p-3 text-xs">
          <p className="mb-1 font-semibold text-warning">Differences between the document and the arithmetic</p>
          <ul className="space-y-1.5">
            {check.discrepancies.map((d: any, i: number) => (
              <li key={i} className="text-ink-secondary">
                <span className="font-medium text-ink">{d.scope === 'line' ? `Line ${d.line}` : d.field === 'totalAmount' ? 'Grand total' : d.field === 'subtotal' ? 'Subtotal' : 'Lines'}:</span>{' '}
                expected <span className="font-mono">{Number(d.expected).toFixed(2)}</span>, document shows <span className="font-mono">{Number(d.actual).toFixed(2)}</span>
                <span className="block text-muted">{d.message}</span>
                {d.suggestion?.type === 'APPLY_TAX_RATE' && !dirty && canConvert && <Button size="sm" variant="outline" className="mt-1" loading={busy} onClick={() => applyTaxRate(d.suggestion.rate)}>Apply {d.suggestion.rate}% tax to every line</Button>}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-muted">Nothing is changed automatically. Correct the wrong value above (check it against the original) and the totals are re-checked.</p>
        </div>
      )}
      {(check.warnings || []).length > 0 && (
        <div className="rounded-lg border border-warning-border bg-warning-soft p-3">
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-warning">{check.warnings.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {hasDup && (
        <div className="rounded-lg border border-warning-border bg-warning-soft p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-warning"><AlertTriangle className="h-4 w-4" /> Possible duplicate document found.</p>
          <ul className="space-y-1 text-xs text-ink-secondary">
            {check.duplicates.map((d: any) => (
              <li key={d.kind + d.id}><Link className="font-medium text-primary hover:underline" href={d.link} target="_blank">{d.kind} {d.number}</Link> — {d.reason}</li>
            ))}
          </ul>
          <label className="mt-2 flex min-h-[44px] items-center gap-2 text-xs text-ink"><input type="checkbox" className="h-4 w-4" checked={ackDup} onChange={(e) => setAckDup(e.target.checked)} /> I have reviewed the existing document(s); this is not a duplicate.</label>
        </div>
      )}
      {dest === 'TAX_INVOICE' && chosen?.available && (
        <label className="flex min-h-[44px] items-start gap-2 text-xs text-ink"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={ackFlow} onChange={(e) => setAckFlow(e.target.checked)} /> I understand this creates a live Tax Invoice that appears in the Depot queue and notifies the Depot team.</label>
      )}
      {serverError && (
        <div role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-3 text-xs text-danger">
          <p>{serverError.message}</p>
          {serverError.errors && <ul className="mt-1 list-disc pl-5">{serverError.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>
      )}
      {!canConvert && <p className="text-xs text-muted">Your role can review this document but cannot convert it.</p>}

      <Button iconLeft={<ArrowRightCircle className="h-4 w-4" />} disabled={!ready} onClick={() => setConfirming(true)}>Convert…</Button>

      <Modal open={confirming} onClose={() => !busy && setConfirming(false)} title="Convert this OCR document?" size="lg"
        footer={<><Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button><Button onClick={convert} loading={busy}>Convert &amp; Create</Button></>}>
        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">Document</dt><dd className="font-medium text-ink break-all">{doc.documentNumber}</dd>
          <dt className="text-muted">Type</dt><dd>{docTypeLabel(doc.documentType)}</dd>
          <dt className="text-muted">{isPurchase ? 'Supplier' : 'Customer'}</dt><dd>{isPurchase ? doc.matchedSupplier?.name : doc.matchedCustomer?.companyName}</dd>
          <dt className="text-muted">Items</dt><dd>{doc.lineItems.length}</dd>
          <dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{fmtMoney(doc.subtotal, doc.currency)}</dd>
          <dt className="text-muted">Tax / VAT</dt><dd className="tabular-nums">{fmtMoney(doc.taxAmount, doc.currency)}</dd>
          <dt className="text-muted">Total</dt><dd className="font-semibold tabular-nums">{fmtMoney(doc.totalAmount, doc.currency)}</dd>
          <dt className="text-muted">Destination</dt><dd className="font-semibold text-primary">{chosen?.label}</dd>
        </dl>
        {check.erpTotals && <p className="mt-3 text-xs text-muted">The ERP will record a total of {fmtMoney(check.erpTotals.grandTotal, doc.currency)} using its own numbering, tax and discount rules.</p>}
      </Modal>
    </div>
  );
}
