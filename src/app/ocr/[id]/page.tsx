'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, ArrowDown, ArrowUp, Calculator, Download, Loader2, Pencil, Plus, RefreshCw, Save, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { hasPermission } from '@/lib/rbac';
import { DOC_TYPE_OPTIONS, OcrDocType, docTypeLabel, partyFor } from '@/lib/ocr/doc-types';
import { ConfidenceBadge, HistoryTimeline, OcrStatusBadge, fmtBytes, fmtMoney, useCan } from '@/components/ocr/parts';
import { PartyPickerModal, ProductPickerModal, Cand } from '@/components/ocr/Pickers';
import { ConvertPanel } from '@/components/ocr/ConvertPanel';

interface FormLine { description: string; sku: string; quantity: string; unit: string; unitPrice: string; discount: string; taxRate: string; taxAmount: string; total: string; matchedProductId: string | null; matchedProduct?: { id: string; name: string; sku: string } | null; suggestions?: Cand[]; lowConfidence?: boolean }
interface Form {
  documentType: string; documentNumber: string; documentDate: string; dueDate: string; supplierName: string; customerName: string; vatNumber: string; currency: string;
  subtotal: string; discountAmount: string; taxAmount: string; freightAmount: string; otherCharges: string; totalAmount: string;
  paymentTerms: string; contactEmail: string; contactPhone: string; billingAddress: string; paidAmount: string; balanceAmount: string;
  issuerAddress: string; issuerPhone: string; issuerEmail: string; issuerVat: string; issuerCorporateTax: string; issuerTradeLicense: string; issuerDuns: string; matchedCustomerId: string | null; matchedSupplierId: string | null; lineItems: FormLine[];
}
const s = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const num = (v: string) => (v.trim() === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

function toForm(d: any): Form {
  return {
    documentType: d.documentType, documentNumber: d.documentNumber, documentDate: d.documentDate?.slice(0, 10) ?? '', dueDate: d.dueDate?.slice(0, 10) ?? '',
    supplierName: d.supplierName, customerName: d.customerName, vatNumber: d.vatNumber, currency: d.currency,
    subtotal: s(d.subtotal), discountAmount: s(d.discountAmount), taxAmount: s(d.taxAmount), freightAmount: s(d.freightAmount), otherCharges: s(d.otherCharges), totalAmount: s(d.totalAmount),
    paymentTerms: d.paymentTerms, contactEmail: d.contactEmail, contactPhone: d.contactPhone, billingAddress: d.billingAddress, paidAmount: s(d.paidAmount), balanceAmount: s(d.balanceAmount),
    issuerAddress: d.issuerAddress, issuerPhone: d.issuerPhone, issuerEmail: d.issuerEmail, issuerVat: d.issuerVat, issuerCorporateTax: d.issuerCorporateTax, issuerTradeLicense: d.issuerTradeLicense, issuerDuns: d.issuerDuns,
    matchedCustomerId: d.matchedCustomerId, matchedSupplierId: d.matchedSupplierId,
    lineItems: d.lineItems.map((l: any) => ({ description: l.description, sku: l.sku, quantity: s(l.quantity), unit: l.unit, unitPrice: s(l.unitPrice), discount: s(l.discount), taxRate: s(l.taxRate), taxAmount: s(l.taxAmount), total: s(l.total), matchedProductId: l.matchedProductId, matchedProduct: l.matchedProduct, suggestions: l.suggestions, lowConfidence: l.lowConfidence })),
  };
}
const editable = (f: Form) => JSON.stringify({ ...f, lineItems: f.lineItems.map(({ matchedProduct, suggestions, lowConfidence, ...rest }) => rest) });

function toPatch(f: Form) {
  return {
    documentType: f.documentType, documentNumber: f.documentNumber, documentDate: f.documentDate || null, dueDate: f.dueDate || null,
    supplierName: f.supplierName, customerName: f.customerName, vatNumber: f.vatNumber, currency: f.currency,
    subtotal: num(f.subtotal), discountAmount: num(f.discountAmount), taxAmount: num(f.taxAmount), freightAmount: num(f.freightAmount), otherCharges: num(f.otherCharges), totalAmount: num(f.totalAmount),
    paymentTerms: f.paymentTerms, contactEmail: f.contactEmail, contactPhone: f.contactPhone, billingAddress: f.billingAddress, paidAmount: num(f.paidAmount), balanceAmount: num(f.balanceAmount),
    issuerAddress: f.issuerAddress, issuerPhone: f.issuerPhone, issuerEmail: f.issuerEmail, issuerVat: f.issuerVat, issuerCorporateTax: f.issuerCorporateTax, issuerTradeLicense: f.issuerTradeLicense, issuerDuns: f.issuerDuns,
    matchedCustomerId: f.matchedCustomerId, matchedSupplierId: f.matchedSupplierId,
    lineItems: f.lineItems.map((l) => ({ description: l.description, sku: l.sku, unit: l.unit, quantity: num(l.quantity), unitPrice: num(l.unitPrice), discount: num(l.discount), taxRate: num(l.taxRate), taxAmount: num(l.taxAmount), total: num(l.total), matchedProductId: l.matchedProductId })),
  };
}
const EMPTY_LINE: FormLine = { description: '', sku: '', quantity: '1', unit: '', unitPrice: '0', discount: '0', taxRate: '0', taxAmount: '0', total: '0', matchedProductId: null };

export default function OcrDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const role = useCan();
  const canWrite = hasPermission(role, 'ocr.write');
  const canConvert = hasPermission(role, 'ocr.convert');
  const canDelete = hasPermission(role, 'ocr.delete');
  const canCreateParty = hasPermission(role, 'customers.write');
  const canCreateProduct = hasPermission(role, 'products.write');

  const [doc, setDoc] = useState<any>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [base, setBase] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [partyOpen, setPartyOpen] = useState(false);
  const [productLine, setProductLine] = useState<number | null>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (opts: { keepForm?: boolean } = {}) => {
    try {
      const res = await fetch(`/api/ocr-documents/${id}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || 'Could not load this document.'); return; }
      setDoc(j); setError(null);
      if (!opts.keepForm) { const f = toForm(j); setForm(f); setBase(editable(f)); }
    } catch { setError('Network error. Please retry.'); } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (doc?.processingStatus !== 'PROCESSING' && doc?.processingStatus !== 'UPLOADED') return;
    const t = setInterval(() => load(), 3000);
    return () => clearInterval(t);
  }, [doc?.processingStatus, load]);

  const dirty = !!form && editable(form) !== base;
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const locked = !doc || doc.conversionStatus === 'CONVERTED' || doc.conversionStatus === 'CONVERTING' || doc.processingStatus === 'PROCESSING' || doc.processingStatus === 'UPLOADED' || !canWrite;
  const reviewSet = useMemo(() => new Set<string>(doc?.reviewFields ?? []), [doc]);
  const conf = (k: string) => doc?.fieldConfidence?.[k] as number | undefined;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setLine = (i: number, patch: Partial<FormLine>, recalc = false) => setForm((f) => {
    if (!f) return f;
    const lines = f.lineItems.map((l, idx) => {
      if (idx !== i) return l;
      const n = { ...l, ...patch };
      if (recalc) {
        const net = num(n.quantity) * num(n.unitPrice) - num(n.discount);
        n.taxAmount = String(r2((net * num(n.taxRate)) / 100));
        n.total = String(r2(net + num(n.taxAmount)));
      }
      return n;
    });
    return { ...f, lineItems: lines };
  });
  const moveLine = (i: number, d: -1 | 1) => setForm((f) => {
    if (!f) return f; const j = i + d; if (j < 0 || j >= f.lineItems.length) return f;
    const lines = [...f.lineItems]; [lines[i], lines[j]] = [lines[j], lines[i]]; return { ...f, lineItems: lines };
  });
  const recalcTotals = () => setForm((f) => {
    if (!f) return f;
    const sub = r2(f.lineItems.reduce((a, l) => a + num(l.quantity) * num(l.unitPrice), 0));
    const tax = r2(f.lineItems.reduce((a, l) => a + num(l.taxAmount), 0));
    const total = r2(sub - num(f.discountAmount) + tax + num(f.freightAmount) + num(f.otherCharges));
    return { ...f, subtotal: String(sub), taxAmount: String(tax), totalAmount: String(total) };
  });

  const save = async (confirm = false) => {
    if (!form || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ocr-documents/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...toPatch(form), ...(confirm ? { confirm: true } : {}) }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: 'Could not save', description: j.error, variant: 'error' }); return; }
      toast({ title: confirm ? 'Data confirmed' : 'Changes saved', variant: 'success' });
      await load();
    } finally { setSaving(false); }
  };

  const reprocess = async () => {
    setConfirmReprocess(false); setReprocessing(true);
    try {
      const res = await fetch(`/api/ocr-documents/${id}/reprocess`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) toast({ title: 'Reprocessing failed', description: j.error, variant: 'error' });
      else toast({ title: 'Document reprocessed', description: 'The record was refreshed. No ERP document was created.', variant: 'success' });
      await load();
    } finally { setReprocessing(false); }
  };

  const remove = async () => {
    const res = await fetch(`/api/ocr-documents/${id}${doc.conversionStatus === 'CONVERTED' ? '?confirmConverted=true' : ''}`, { method: 'DELETE' });
    if (res.ok) { toast({ title: 'OCR record deleted', variant: 'success' }); router.push('/ocr'); }
    else { const j = await res.json().catch(() => ({})); toast({ title: 'Could not delete', description: j.error, variant: 'error' }); setConfirmDelete(false); }
  };

  if (loading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-[60vh]" /><Skeleton className="h-[60vh]" /></div></div>;
  if (error || !doc || !form) return <ErrorState title="Could not open this document" description={error ?? undefined} action={<Button variant="outline" onClick={() => router.push('/ocr')}>Back to OCR</Button>} />;

  const party = partyFor(form.documentType as OcrDocType);
  const matchedParty = party === 'supplier' ? doc.matchedSupplier : doc.matchedCustomer;
  const partyName = party === 'supplier' ? form.supplierName : form.customerName;
  const partySuggestions: Cand[] = (party === 'supplier' ? doc.suggestions.supplier : doc.suggestions.customer).map((c: any) => c);
  const isPdf = doc.fileType === 'application/pdf';
  const previewUrl = `/api/ocr-documents/${id}/file`;
  const flagged = (k: string) => reviewSet.has(k) && !locked;
  const fieldProps = (k: keyof Form & string) => {
    const m = doc.fieldMeta?.[k] as { confidence: number | null; level: string; page: number | null } | undefined;
    const c = m?.confidence ?? conf(k);
    const lvl = c === undefined || c === null ? '' : c >= 0.85 ? 'High' : c >= 0.6 ? 'Medium' : 'Low';
    const info = c !== undefined && c !== null ? `${lvl} confidence (${Math.round(c * 100)}%)${m?.page ? ` · page ${m.page}` : ''}` : '';
    return { disabled: locked, className: flagged(k) ? 'border-warning bg-warning-soft' : '', hint: flagged(k) ? `Check against the original${info ? ' · ' + info : ''}` : info && !locked ? info : undefined };
  };
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'OCR', href: '/ocr' }, { label: doc.fileName }]}
        title={<span className="break-all">{doc.fileName}</span>}
        description={<span className="flex flex-wrap items-center gap-2"><OcrStatusBadge processing={doc.processingStatus} conversion={doc.conversionStatus} /><span>{fmtBytes(doc.fileSize)} · {doc.pageCount} page{doc.pageCount === 1 ? '' : 's'}</span></span>}
        actions={<>
          {dirty && canWrite && <Button onClick={() => save(false)} loading={saving} iconLeft={<Save className="h-4 w-4" />}>Save changes</Button>}
          {canWrite && !locked && <Button variant="outline" iconLeft={<Pencil className="h-4 w-4" />} onClick={() => fieldsRef.current?.scrollIntoView({ behavior: 'smooth' })}>Edit OCR Data</Button>}
          {canWrite && doc.conversionStatus !== 'CONVERTED' && doc.processingStatus !== 'PROCESSING' && doc.processingStatus !== 'UPLOADED' && <Button variant="outline" iconLeft={<RefreshCw className={`h-4 w-4 ${reprocessing ? 'animate-spin' : ''}`} />} loading={reprocessing} onClick={() => setConfirmReprocess(true)}>Reprocess OCR</Button>}
          <Button variant="outline" iconLeft={<Download className="h-4 w-4" />} onClick={() => { window.location.href = `${previewUrl}?download=1`; }}>Download Original</Button>
          {canDelete && <Button variant="outline" iconLeft={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>Delete</Button>}
        </>}
      />

      {(doc.processingStatus === 'PROCESSING' || doc.processingStatus === 'UPLOADED') && (
        <div className="flex items-center gap-3 rounded-xl border border-warning-border bg-warning-soft p-4 text-sm text-warning"><Loader2 className="h-5 w-5 animate-spin" /> {doc.processingStatus === 'UPLOADED' ? 'Waiting in the OCR queue…' : 'Processing document…'} This page updates automatically.</div>
      )}
      {doc.processingStatus === 'FAILED' && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div><p className="font-semibold">OCR could not read this document</p><p className="mt-0.5">{doc.failureReason || 'Unknown error.'}</p>{canWrite && <Button className="mt-3" size="sm" variant="outline" onClick={() => setConfirmReprocess(true)}>Try again</Button>}</div>
        </div>
      )}
      {doc.conversionStatus === 'FAILED' && doc.failureReason && (
        <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger"><p className="font-semibold">The last conversion attempt failed</p><p className="mt-0.5">{doc.failureReason}</p></div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* LEFT: original document */}
        <div className="lg:sticky lg:top-2 lg:self-start">
          <Card>
            <CardHeader><CardTitle>Original document</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[60vh] overflow-hidden rounded-lg border border-line bg-surface-muted lg:h-[calc(100dvh-14rem)]">
                {isPdf
                  ? <iframe title="Original document" src={`${previewUrl}#toolbar=1&view=FitH`} className="h-full w-full" />
                  : <img alt="Original document" src={previewUrl} className="h-full w-full object-contain" />}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: extracted data */}
        <div className="min-w-0 space-y-6" ref={fieldsRef}>
          <Card>
            <CardHeader><CardTitle>Document type</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">Detected:</span><span className="font-semibold text-ink">{docTypeLabel(doc.detectedDocumentType)}</span>
                <span className="text-muted">Confidence:</span><ConfidenceBadge value={doc.typeConfidence} />
                {doc.confidence > 0 && <><span className="text-muted">Read quality:</span><ConfidenceBadge value={doc.confidence} /></>}
              </div>
              <Select label="Document Type" value={form.documentType} disabled={locked} onChange={(e) => set('documentType', e.target.value)} options={DOC_TYPE_OPTIONS} hint="The classification is a suggestion. Change it if it is wrong." />
              {form.documentType !== doc.detectedDocumentType && <p className="text-xs text-warning">Changed from the detected type. Save to apply.</p>}
            </CardContent>
          </Card>

          {(doc.warnings?.length > 0) && (
            <div className="rounded-xl border border-warning-border bg-warning-soft p-4">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-warning"><AlertTriangle className="h-4 w-4" /> OCR warnings</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-secondary">{doc.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}

          {party !== 'none' && (
            <Card>
              <CardHeader><CardTitle>{party === 'supplier' ? 'Supplier' : 'Customer'} match</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {matchedParty ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-success-border bg-success-soft p-3">
                    <div className="min-w-0"><Badge tone="success">Matched {party}</Badge><p className="mt-1 truncate text-sm font-semibold text-ink">{matchedParty.companyName ?? matchedParty.name}</p><p className="truncate text-xs text-muted">{matchedParty.email}</p></div>
                    {!locked && <Button size="sm" variant="outline" onClick={() => setPartyOpen(true)}>Change</Button>}
                  </div>
                ) : (
                  <div className="rounded-lg border border-warning-border bg-warning-soft p-3">
                    <Badge tone="warning">{party === 'supplier' ? 'Supplier' : 'Customer'} not found</Badge>
                    <p className="mt-1 text-sm text-ink">Extracted name: <span className="font-medium">{partyName || '—'}</span></p>
                    {!locked && <Button className="mt-2" size="sm" onClick={() => setPartyOpen(true)}>Select or create {party}</Button>}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Company details (from the document header)</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="Company Address" value={form.issuerAddress} onChange={(e) => set('issuerAddress', e.target.value)} {...fieldProps('issuerAddress')} />
                <Input label="Phone" value={form.issuerPhone} onChange={(e) => set('issuerPhone', e.target.value)} {...fieldProps('issuerPhone')} />
                <Input label="Email" type="email" value={form.issuerEmail} onChange={(e) => set('issuerEmail', e.target.value)} {...fieldProps('issuerEmail')} />
                <Input label="VAT / TRN" value={form.issuerVat} onChange={(e) => set('issuerVat', e.target.value)} {...fieldProps('issuerVat')} />
                <Input label="Corporate Tax No." value={form.issuerCorporateTax} onChange={(e) => set('issuerCorporateTax', e.target.value)} {...fieldProps('issuerCorporateTax')} />
                <Input label="Trade Licence No." value={form.issuerTradeLicense} onChange={(e) => set('issuerTradeLicense', e.target.value)} {...fieldProps('issuerTradeLicense')} />
                <Input label="D-U-N-S No." value={form.issuerDuns} onChange={(e) => set('issuerDuns', e.target.value)} {...fieldProps('issuerDuns')} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Extracted information</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="Document Number" value={form.documentNumber} onChange={(e) => set('documentNumber', e.target.value)} {...fieldProps('documentNumber')} />
                <Input label="Document Date" type="date" value={form.documentDate} onChange={(e) => set('documentDate', e.target.value)} {...fieldProps('documentDate')} />
                <Input label="Supplier" value={form.supplierName} onChange={(e) => set('supplierName', e.target.value)} {...fieldProps('supplierName')} />
                <Input label="Customer" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} {...fieldProps('customerName')} />
                <Input label="Customer VAT / TRN" value={form.vatNumber} onChange={(e) => set('vatNumber', e.target.value)} {...fieldProps('vatNumber')} />
                <Input label="Currency" maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} {...fieldProps('currency')} />
                <Input label="Due Date" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} disabled={locked} />
                <Input label="Payment Terms" value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} disabled={locked} />
                <Input label="Customer Address" value={form.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} {...fieldProps('billingAddress')} />
                <Input label="Customer Email" type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} {...fieldProps('contactEmail')} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {([['subtotal', 'Subtotal'], ['discountAmount', 'Discount'], ['taxAmount', 'VAT / Tax'], ['freightAmount', 'Freight'], ['otherCharges', 'Other charges'], ['totalAmount', 'Total'], ['paidAmount', 'Paid'], ['balanceAmount', 'Balance']] as [keyof Form & string, string][]).map(([k, l]) => (
                  <Input key={k} label={l} type="number" min="0" step="0.01" inputMode="decimal" value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} {...fieldProps(k)} />
                ))}
              </div>
              {!locked && <Button className="mt-3" size="sm" variant="outline" iconLeft={<Calculator className="h-3.5 w-3.5" />} onClick={recalcTotals}>Recalculate totals from lines</Button>}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Line items: full width so the table has room */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Line items {flagged('lineItems') && <span className="ml-1 text-[10px] font-semibold text-warning">Check</span>}</CardTitle>
          {!locked && <Button size="sm" variant="outline" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={() => set('lineItems', [...form.lineItems, { ...EMPTY_LINE }])}>Add line</Button>}
        </CardHeader>
        <CardContent>
          {form.lineItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">No line items were found. {locked ? '' : 'Add them manually.'}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[1250px] border-collapse text-sm">
                <thead className="bg-surface text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <tr>{['#', 'Product / Description', 'SKU', 'Qty', 'Unit', 'Unit price', 'Discount', 'Tax %', 'Tax amt', 'Total', 'Product match', ''].map((h) => <th key={h} className="px-2 py-2.5">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {form.lineItems.map((l, i) => {
                    const cell = 'h-11 md:h-9 rounded-md border bg-white px-2 text-sm disabled:bg-surface-muted ' + (l.lowConfidence && !locked ? 'border-warning bg-warning-soft' : 'border-line');
                    const numIn = (k: keyof FormLine, recalc: boolean, w = 'w-24') => (
                      <input type="number" min="0" step="any" inputMode="decimal" disabled={locked} className={`${cell} ${w} tabular-nums`} value={l[k] as string} onChange={(e) => setLine(i, { [k]: e.target.value } as any, recalc)} />
                    );
                    return (
                      <tr key={i} className="align-top">
                        <td className="px-2 py-2 text-xs text-muted">{i + 1}</td>
                        <td className="px-2 py-2"><input disabled={locked} className={`${cell} min-w-[200px]`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                        <td className="px-2 py-2"><input disabled={locked} className={`${cell} w-32 font-mono text-xs`} value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value })} /></td>
                        <td className="px-2 py-2">{numIn('quantity', true, 'w-20')}</td>
                        <td className="px-2 py-2"><input disabled={locked} className={`${cell} w-20`} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
                        <td className="px-2 py-2">{numIn('unitPrice', true, 'w-28')}</td>
                        <td className="px-2 py-2">{numIn('discount', true)}</td>
                        <td className="px-2 py-2">{numIn('taxRate', true, 'w-20')}</td>
                        <td className="px-2 py-2">{numIn('taxAmount', false)}</td>
                        <td className="px-2 py-2">{numIn('total', false, 'w-28')}</td>
                        <td className="px-2 py-2 min-w-[190px]">
                          {l.matchedProductId ? (
                            <div className="flex items-center justify-between gap-2"><div className="min-w-0"><Badge tone="success">Matched</Badge><p className="mt-0.5 truncate text-xs text-ink" title={l.matchedProduct?.name}>{l.matchedProduct?.name ?? 'Selected product'}</p><p className="truncate font-mono text-[10px] text-muted">{l.matchedProduct?.sku}</p></div>
                              {!locked && <Button size="sm" variant="ghost" onClick={() => setProductLine(i)}>Change</Button>}</div>
                          ) : (
                            <div><Badge tone="warning">Product not found</Badge>{!locked && <div className="mt-1"><Button size="sm" variant="outline" onClick={() => setProductLine(i)}>Select / create</Button></div>}</div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {!locked && <div className="flex items-center">
                            <IconButton label="Move up" variant="ghost" onClick={() => moveLine(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" /></IconButton>
                            <IconButton label="Move down" variant="ghost" onClick={() => moveLine(i, 1)} disabled={i === form.lineItems.length - 1}><ArrowDown className="h-4 w-4" /></IconButton>
                            <IconButton label="Delete line" variant="ghost" onClick={() => set('lineItems', form.lineItems.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></IconButton>
                          </div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Convert to ERP document</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!locked && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface p-3">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <span className="text-xs text-ink-secondary">Review every highlighted field, then confirm the data. Nothing is created until you convert.</span>
                {doc.processingStatus !== 'CONFIRMED' && <Button size="sm" variant="outline" onClick={() => save(true)} loading={saving} disabled={!canWrite}>{dirty ? 'Save & confirm data' : 'Confirm data'}</Button>}
              </div>
            )}
            <ConvertPanel doc={{ ...doc, documentType: form.documentType }} dirty={dirty} canConvert={canConvert} onChanged={() => load({ keepForm: true })} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>History</CardTitle></CardHeader>
          <CardContent><HistoryTimeline events={doc.events} /></CardContent>
        </Card>
      </div>

      <PartyPickerModal kind={party === 'supplier' ? 'supplier' : 'customer'} open={partyOpen} onClose={() => setPartyOpen(false)} initialName={partyName} initialEmail={form.contactEmail} suggestions={partySuggestions} canCreate={canCreateParty}
        onPick={async (c) => {
          setPartyOpen(false);
          // Save the selection immediately so it is recorded in the audit trail and validation reruns.
          const patch: any = party === 'supplier' ? { matchedSupplierId: c.id } : { matchedCustomerId: c.id };
          const res = await fetch(`/api/ocr-documents/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
          if (!res.ok) toast({ title: 'Could not save the selection', variant: 'error' });
          if (dirty) { set(party === 'supplier' ? 'matchedSupplierId' : 'matchedCustomerId', c.id); await load({ keepForm: true }); } else await load();
        }} />
      {productLine !== null && form.lineItems[productLine] && (
        <ProductPickerModal open onClose={() => setProductLine(null)} line={form.lineItems[productLine]} suggestions={form.lineItems[productLine].suggestions ?? []} canCreate={canCreateProduct}
          onPick={(c) => { const [sku] = c.sub.split(' · '); setLine(productLine, { matchedProductId: c.id, matchedProduct: { id: c.id, name: c.label, sku } }); setProductLine(null); }} />
      )}
      <ConfirmDialog open={confirmReprocess} onClose={() => setConfirmReprocess(false)} onConfirm={reprocess} title="Reprocess this document?" confirmLabel="Reprocess OCR"
        description="The original file is read again and the extracted data, line items and matches on this record are replaced. Your manual edits will be lost. No ERP document is created." />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={remove} title="Delete OCR record?" confirmLabel="Delete" destructive
        description={doc.conversionStatus === 'CONVERTED' ? `This removes only the OCR record and its history. The ERP document ${doc.convertedDocumentNumber} is not affected.` : 'The uploaded file, extracted data and history will be removed. This cannot be undone.'} />
    </div>
  );
}
