'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { BUYER_INSURANCE, shipmentRows } from '@/lib/documents/shipment-text';
import { formatDocDate } from '@/lib/utils';

const blank = { awbNumber: '', awbReceivedDate: '', shipmentDate: '', packageCount: '', packingDescription: '', grossWeightKg: '', netWeightKg: '', lengthCm: '', widthCm: '', heightCm: '', remarks: '', buyerResponsibleInsurance: false };
const FIELD_LABEL: Record<string, string> = { awbNumber: 'AWB No.', awbReceivedDate: 'AWB received', shipmentDate: 'Shipment date', packageCount: 'Packages', packingDescription: 'Packing details', grossWeightKg: 'Gross weight', netWeightKg: 'Net weight', lengthCm: 'Length', widthCm: 'Width', heightCm: 'Height', remarks: 'Remarks', buyerResponsibleInsurance: 'Buyer responsible for insurance' };

/**
 * AWB and packing details of an ISSUED tax invoice, added or updated when the airway bill arrives. Saving changes only these
 * fields (never the lines, VAT, totals or number); every change is kept in the history shown below, with who and when.
 */
export function ShipmentDetailsCard({ invoiceId, canEdit, onSaved }: { invoiceId: string; canEdit: boolean; onSaved?: () => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<{ details: any; dispatch: any; history: any[] } | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<typeof blank>(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/invoices/${invoiceId}/shipment-details`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { setData(j); setLoadError(null); } else setLoadError(j.error || 'The shipment details could not be loaded.');
    } catch (e: any) { setLoadError(e?.message || 'Network error'); }
  }, [invoiceId]);
  useEffect(() => { load(); }, [load]);

  const startEdit = () => {
    const d = data?.details;
    setForm(d ? {
      awbNumber: d.awbNumber || '', awbReceivedDate: d.awbReceivedDate || '', shipmentDate: d.shipmentDate || '', packageCount: d.packageCount ?? '', packingDescription: d.packingDescription || '',
      grossWeightKg: d.grossWeightKg ?? '', netWeightKg: d.netWeightKg ?? '', lengthCm: d.lengthCm ?? '', widthCm: d.widthCm ?? '', heightCm: d.heightCm ?? '', remarks: d.remarks || '', buyerResponsibleInsurance: !!d.buyerResponsibleInsurance,
    } as any : blank);
    setError(null); setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/invoices/${invoiceId}/shipment-details`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error || 'The shipment details could not be saved.'); return; }
      setData(j); setEditing(false);
      toast({ title: j.unchanged ? 'No changes to save' : 'Shipment details saved', description: j.unchanged ? undefined : 'The invoice amounts and number are unchanged.', variant: j.unchanged ? 'info' : 'success' } as any);
      onSaved?.();
    } catch (err: any) { setError(err?.message || 'Network error'); } finally { setSaving(false); }
  };

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const rows = shipmentRows(data?.details, formatDocDate as any);
  const insurance = !!data?.details?.buyerResponsibleInsurance;
  const dispatch = data?.dispatch;
  const doc = dispatch?.document;
  const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const docKind = (t: string) => (/pdf/i.test(t) ? 'PDF document' : /image/i.test(t) ? 'Image' : t || 'Document');

  return (
    <Card className="p-5 space-y-3 text-xs" data-testid="shipment-details-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Shipment &amp; Packing Details</h3>
        {canEdit && !editing && !loadError && <Button size="sm" variant="outline" onClick={startEdit}>{data?.details ? 'Update' : 'Add AWB / packing'}</Button>}
      </div>

      {loadError && <div role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-2.5 text-danger">{loadError}</div>}

      {!editing && !loadError && (
        <>
          {rows.length === 0 && !insurance && !dispatch && <p className="text-muted">No AWB or packing details yet. Add them when the airway bill is received; they will print on the Tax Invoice.</p>}
          <dl className="space-y-1.5 text-ink-secondary">
            {/* The courier and dispatch date come from the shipment itself, so this section always shows what was dispatched. */}
            {dispatch && <div className="flex justify-between gap-3"><dt>Courier:</dt><dd className="text-ink font-medium text-right">{dispatch.courierName}</dd></div>}
            {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt>{k}:</dt><dd className="text-ink font-medium text-right whitespace-pre-line">{v}</dd></div>)}
            {dispatch && !rows.some(([k]) => k === 'AWB No.') && <div className="flex justify-between gap-3"><dt>AWB No.:</dt><dd className="text-ink font-medium text-right">{dispatch.awbNumber}</dd></div>}
            {dispatch?.dispatchedAt && <div className="flex justify-between gap-3"><dt>Dispatched:</dt><dd className="text-ink font-medium text-right">{formatDocDate(dispatch.dispatchedAt)}</dd></div>}
            {insurance && <div className="flex justify-between gap-3"><dt>Insurance:</dt><dd className="text-ink font-medium text-right">{BUYER_INSURANCE}</dd></div>}
          </dl>

          {/* The uploaded airway bill, served by the ERP: it opens in the browser's own PDF viewer and can be saved. */}
          {doc && (
            <div className="rounded-lg border border-line-soft bg-surface-muted p-2.5 space-y-1.5" data-testid="awb-document">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink truncate" title={doc.fileName}>{doc.fileName}</p>
                  <p className="text-[11px] text-muted">{docKind(doc.fileType)} · {kb(doc.fileSize)} · uploaded {new Date(doc.uploadedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}{doc.uploadedByName ? ` by ${doc.uploadedByName}` : ''}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <a href={doc.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-surface-muted" data-testid="awb-open">Open AWB</a>
                <a href={`${doc.href}?download=1`} className="inline-flex items-center rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-surface-muted" data-testid="awb-download">Download</a>
              </div>
            </div>
          )}
          {dispatch?.documentMissing && (
            <p className="rounded-lg border border-warning-border bg-warning-soft p-2 text-[11px] text-warning" role="status">
              An airway bill file was recorded for this shipment but is no longer in document storage, so it cannot be opened. Upload it again.
            </p>
          )}

          {data?.details && <p className="text-[11px] text-muted">Last updated by {data.details.updatedByName} · {new Date(data.details.updatedAt).toLocaleString('en-GB')}</p>}
        </>
      )}

      {editing && (
        <form onSubmit={save} className="space-y-3" data-testid="shipment-details-form">
          {error && <div role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-2.5 text-danger">{error}</div>}
          <Input id="sd-awb" label="AWB number" value={form.awbNumber} maxLength={60} onChange={set('awbNumber')} />
          <div className="grid grid-cols-2 gap-3">
            <Input id="sd-awb-date" label="AWB received date" type="date" value={form.awbReceivedDate} onChange={set('awbReceivedDate')} />
            <Input id="sd-ship-date" label="Shipment date" type="date" value={form.shipmentDate} onChange={set('shipmentDate')} />
          </div>
          <Input id="sd-packages" label="Number of packages / cartons" type="number" min={0} step="1" value={form.packageCount as any} onChange={set('packageCount')} />
          <Textarea id="sd-packing" label="Packing details / package description" rows={2} maxLength={500} value={form.packingDescription} onChange={set('packingDescription') as any} />
          <div className="grid grid-cols-2 gap-3">
            <Input id="sd-gross" label="Gross weight (kg)" type="number" min={0} step="0.001" value={form.grossWeightKg as any} onChange={set('grossWeightKg')} />
            <Input id="sd-net" label="Net weight (kg)" type="number" min={0} step="0.001" value={form.netWeightKg as any} onChange={set('netWeightKg')} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input id="sd-l" label="Length (cm)" type="number" min={0} step="0.01" value={form.lengthCm as any} onChange={set('lengthCm')} />
            <Input id="sd-w" label="Width (cm)" type="number" min={0} step="0.01" value={form.widthCm as any} onChange={set('widthCm')} />
            <Input id="sd-h" label="Height (cm)" type="number" min={0} step="0.01" value={form.heightCm as any} onChange={set('heightCm')} />
          </div>
          <Textarea id="sd-remarks" label="Shipping remarks" rows={2} maxLength={1000} value={form.remarks} onChange={set('remarks') as any} />
          <label className="flex items-center gap-2 text-xs text-ink">
            <input type="checkbox" className="h-4 w-4" checked={form.buyerResponsibleInsurance} onChange={(e) => setForm({ ...form, buyerResponsibleInsurance: e.target.checked })} />
            <span>{BUYER_INSURANCE} <span className="text-muted">(printed in the delivery terms)</span></span>
          </label>
          <p className="text-[11px] text-muted">Only these details are saved. The invoice lines, VAT, totals and number cannot be changed here.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" size="sm" loading={saving}>Save details</Button>
          </div>
        </form>
      )}

      {data && data.history.length > 0 && (
        <details className="pt-2 border-t border-line-soft" data-testid="shipment-history">
          <summary className="cursor-pointer text-[11px] font-semibold text-muted">Change history ({data.history.length})</summary>
          <ul className="mt-2 space-y-2">
            {data.history.map((h) => (
              <li key={h.id} className="text-[11px] text-ink-secondary">
                <div className="font-medium text-ink">{h.action === 'CREATED' ? 'Added' : 'Updated'} by {h.changedByName} · {new Date(h.changedAt).toLocaleString('en-GB')}</div>
                <ul className="mt-0.5 list-disc pl-4">
                  {Object.entries(h.changes as Record<string, { from: unknown; to: unknown }>).map(([f, c]) => (
                    <li key={f}>{FIELD_LABEL[f] || f}: {c.from === null || c.from === '' ? '—' : String(c.from)} → {c.to === null || c.to === '' ? '—' : String(c.to)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
