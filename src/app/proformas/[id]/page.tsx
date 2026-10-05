'use client';

import EditInvoiceItemsModal from '@/components/invoices/EditInvoiceItemsModal';
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FileCheck2,
  ArrowLeft,
  Printer,
  Mail,
  CheckCircle2,
  Receipt,
  Building2,
  Send,
  AlertCircle,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  ExternalLink,
  FileText,
  Zap,
  Download,
  Truck,
  Check,
  Trash2,
  Edit2,
  Scale,
  PieChart,
  MoreHorizontal,
  Eye,
  RotateCcw,
} from 'lucide-react';
const fireConfetti = (opts: Record<string, unknown>) => {
  import('canvas-confetti').then((m) => m.default(opts as any)).catch(() => {});
};
import { formatUSD, formatDate } from '@/lib/utils';
import { Proforma, Depot } from '@/types/erp';
import { TermsFields } from '@/components/documents/TermsFields';
import { incotermLine, printableDelivery } from '@/lib/documents/terms';
import { fetchSettingsCached, fetchCurrentUserCached, getCurrentUserCachedSync } from '@/lib/client-cache';
import { hasPermission } from '@/lib/rbac';
import { SendEmailModal, EmailDocType } from '@/components/email/SendEmailModal';
import { EmailHistory } from '@/components/email/EmailHistory';
import PrintableDocumentModal from '@/components/pdf/PrintableDocumentModal';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, Drawer } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { FreightSummaryPanel } from '@/components/freight/FreightSummaryPanel';
import { FreightAllocationModal, FreightAllocationItem } from '@/components/freight/FreightAllocationModal';
import { FreightAllocationMethod } from '@/lib/freight';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu';
import { allowedNextStatuses, STATUS_LABELS, ProformaStatus } from '@/lib/proforma-workflow';

export default function ProformaDetailPage() {
  const { toast } = useToast();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [proforma, setProforma] = useState<Proforma | null>(null);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [isConverting, setIsConverting] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [pendingCancel, setPendingCancel] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [emailResult, setEmailResult] = useState<{
    simulated: boolean;
    message: string;
    recipient?: string;
  } | null>(null);
  const [isSmtpConfigured, setIsSmtpConfigured] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [liveNotification, setLiveNotification] = useState<string | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [conversionSuccess, setConversionSuccess] = useState(false);
  const [generatedInvoice, setGeneratedInvoice] = useState<{ id: string; number: string } | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isEditItemsOpen, setIsEditItemsOpen] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editTerms, setEditTerms] = useState({
    paymentTerms: '',
    paymentMethod: '',
    incoterm: '',
    incotermPlace: '',
    deliveryTerms: '',
    discountPercent: 0,
    shippingCost: 0,
    notes: '',
  });
  const [freightRatePerKg, setFreightRatePerKg] = useState(0);
  const [additionalFreightCharges, setAdditionalFreightCharges] = useState(0);
  const [isFreightManualOverride, setIsFreightManualOverride] = useState(false);
  const [manualTotalFreight, setManualTotalFreight] = useState(0);
  const [isAllocateModalOpen, setIsAllocateModalOpen] = useState(false);
  const [isSavingAllocation, setIsSavingAllocation] = useState(false);

  const [emailTarget, setEmailTarget] = useState<{ type: EmailDocType; id: string } | null>(null);
  const [emailRefresh, setEmailRefresh] = useState(0);
  const [role, setRole] = useState<string | undefined>(() => getCurrentUserCachedSync()?.user?.role);
  useEffect(() => {
    fetchCurrentUserCached().then((a: any) => a?.user?.role && setRole(a.user.role)).catch(() => {});
  }, []);

  const prevStatusRef = useRef<string | null>(null);

  const loadData = async (silent = false) => {
    try {
      const res = await fetch(`/api/proformas/${id}`, { cache: 'no-store' });
      if (!res.ok) {
        if (!silent) setProforma(null);
        return;
      }
      const data = await res.json();

      if (prevStatusRef.current && prevStatusRef.current !== data.status) {
        if (data.status === 'CONFIRMED') {
          fireConfetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#4f46e5', '#10b981', '#3b82f6', '#f59e0b'],
          });
          setLiveNotification('🎉 Live Update: Customer confirmed and accepted this quotation!');
        } else if (data.status === 'CONVERTED') {
          setLiveNotification('✅ Live Update: Quotation converted to Tax Invoice.');
        } else {
          setLiveNotification(`⚡ Live Update: Status changed to ${data.status}`);
        }
      }
      prevStatusRef.current = data.status;

      setProforma(data);
      setEditTerms({
        paymentTerms: data.paymentTerms || '',
        paymentMethod: data.paymentMethod || '',
        incoterm: data.incoterm || '',
        incotermPlace: data.incotermPlace || '',
        deliveryTerms: printableDelivery(data.deliveryTerms),
        discountPercent: data.discountPercent || 0,
        shippingCost: data.shippingCost || 0,
        notes: data.notes || '',
      });
      setFreightRatePerKg(data.freightRatePerKg || 0);
      setAdditionalFreightCharges(data.additionalFreightCharges || 0);
      setIsFreightManualOverride(Boolean(data.freightIsManualOverride));
      setManualTotalFreight(data.freightIsManualOverride ? data.shippingCost || 0 : 0);

      // Only ACTIVE depots can be chosen for dispatch; a deactivated depot stays on documents that already use it.
      const depsRes = await fetch('/api/depots?status=ACTIVE', { cache: 'no-store' });
      if (depsRes.ok) {
        const activeDepots = await depsRes.json();
        setDepots(activeDepots);
        const onDoc = data.items[0]?.selectedDepotId;
        setSelectedDepotId((cur: string) => cur || (activeDepots.some((d: any) => d.id === onDoc) ? onDoc : activeDepots[0]?.id || ''));
      } else {
        setDepots([]);
      }

      fetchSettingsCached()
        .then((s: any) => {
          if (s && typeof s.isSmtpConfigured === 'boolean') {
            setIsSmtpConfigured(s.isSmtpConfigured);
          }
        })
        .catch(() => {});
    } catch (error) {
      if (!silent) {
        console.error('Error loading proforma:', error);
        setProforma(null);
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(false);

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`/api/events?id=${id}`);
      eventSource.onopen = () => setIsLiveConnected(true);
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'PROFORMA_UPDATED' || payload.type === 'PROFORMA_CONFIRMED') {
            if (payload.id === id || payload.proformaNumber === id || !payload.id) {
              loadData(true);
            }
          }
        } catch {}
      };
      eventSource.onerror = () => setIsLiveConnected(false);
    } catch {}

    return () => {
      if (eventSource) eventSource.close();
    };
  }, [id]);

  if (isLoading) {
    return (
      <div className="py-24 text-center space-y-4">
        <div className="text-muted text-xs">Loading proforma document...</div>
      </div>
    );
  }

  if (!proforma) {
    return (
      <div className="py-24 text-center space-y-4">
        <div className="text-muted text-sm font-semibold">Proforma Quotation Not Found</div>
        <LinkButton href="/proformas" variant="outline" size="sm">
          Back to Proformas
        </LinkButton>
      </div>
    );
  }

  const handleStatusChange = async (status: Proforma['status']) => {
    setIsChangingStatus(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/proformas/${proforma.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // The server owns the lifecycle rules — surface its reason verbatim.
        throw new Error(data?.error || 'Could not update the status.');
      }

      setProforma(data);
      prevStatusRef.current = data.status;
      toast({
        title: `Status changed to ${STATUS_LABELS[status as ProformaStatus] ?? status}`,
        variant: 'success',
      });
    } catch (error: any) {
      setErrorMessage(error?.message || 'Could not update the status.');
      toast({ title: 'Status change failed', description: error?.message, variant: 'error' });
    } finally {
      setIsChangingStatus(false);
      setPendingCancel(false);
    }
  };

  // Derived from the shared workflow rules, so the menu can only ever offer
  // transitions the API will actually accept.
  const statusOptions: ProformaStatus[] = allowedNextStatuses(proforma.status as ProformaStatus);
  const hasFreightAllocation = (proforma.items || []).some((it) => (it.allocatedFreight || 0) > 0);
  const canAllocateFreight = (proforma.shippingCost || 0) > 0 && (proforma.items?.length || 0) > 0;

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingEdit(true);
    try {
      const { shippingCost: _unusedShippingCost, ...termsWithoutShipping } = editTerms;
      const res = await fetch(`/api/proformas/${proforma.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...termsWithoutShipping,
          freight: {
            actualWeightKg: proforma.actualWeightKg || 0,
            volumetricWeightKg: proforma.volumetricWeightKg || 0,
            freightRatePerKg,
            additionalFreightCharges,
            isManualOverride: isFreightManualOverride,
            manualTotalFreight,
          },
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to update quotation');
      }
      toast({ title: 'Quotation updated successfully', variant: 'success' });
      setIsEditOpen(false);
      loadData(true);
    } catch (err: any) {
      toast({ title: err.message || 'Update failed', variant: 'error' });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteProforma = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/proformas/${proforma.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to delete proforma');
      }
      toast({ title: 'Proforma quotation deleted', variant: 'success' });
      router.push('/proformas');
    } catch (err: any) {
      toast({ title: err.message || 'Delete failed', variant: 'error' });
      setIsDeleting(false);
    }
  };

  const handleConvert = async () => {
    setIsConverting(true);
    setErrorMessage('');

    try {
      const res = await fetch(`/api/proformas/${proforma.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depotId: selectedDepotId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 409) loadData(true); // already converted elsewhere: the page then shows that invoice
        throw new Error(err.error || 'Conversion failed');
      }

      const newInvoice = await res.json();

      fireConfetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#4f46e5', '#059669', '#0284c7', '#d97706'],
      });

      setGeneratedInvoice({ id: newInvoice.id, number: newInvoice.invoiceNumber });
      setConversionSuccess(true);
      setIsConverting(false);

      toast({
        title: `Tax Invoice ${newInvoice.invoiceNumber} created successfully.`,
        description: 'The depot has been notified.',
        variant: 'success',
      });

      loadData(true);
    } catch (err: any) {
      setErrorMessage(err.message || 'Conversion failed');
      setIsConverting(false);
    }
  };

  const canWrite = hasPermission(role, 'proformas.write');
  const canConvert = hasPermission(role, 'invoices.write');
  const st = proforma.status as ProformaStatus;
  const pdfUrl = `/api/document-pdf/PROFORMA/${proforma.id}`;
  const canEmail = canWrite && (st === 'DRAFT' || st === 'SENT' || st === 'CONFIRMED');
  const wasEmailed = st !== 'DRAFT' || Boolean((proforma as any).lastEmailedAt);
  const openEmail = (type: EmailDocType, docId: string) => setEmailTarget({ type, id: docId });

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-16">
      {/* Live Notification Banner */}
      {liveNotification && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs text-emerald-800 font-semibold shadow-xs">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-emerald-600 animate-pulse" />
            <span>{liveNotification}</span>
          </div>
          <button onClick={() => setLiveNotification(null)} className="text-xs text-emerald-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-3 border-b border-line">
        <div className="flex items-center gap-3">
          <Link
            href="/proformas"
            className="flex h-11 w-11 shrink-0 items-center justify-center md:h-auto md:w-auto md:p-2 rounded-md border border-line bg-white text-muted hover:text-ink hover:bg-surface transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-ink font-mono">
                {proforma.proformaNumber}
              </h1>
              <StatusBadge status={proforma.status} />
              {isLiveConnected && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                  Live Sync
                </span>
              )}
            </div>
            <p className="text-xs text-muted mt-0.5">
              Customer: <strong className="text-ink">{proforma.customerCompany}</strong> · Created: {formatDate(proforma.issueDate)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {st === 'DRAFT' && canWrite && (
            <Button size="sm" variant="outline" iconLeft={<Edit2 className="h-3.5 w-3.5" />} onClick={() => setIsEditItemsOpen(true)}>
              Edit
            </Button>
          )}
          <Button size="sm" variant="outline" className="hidden sm:inline-flex" iconLeft={<Eye className="h-3.5 w-3.5 text-muted" />} onClick={() => setIsPrintModalOpen(true)}>
            Preview
          </Button>
          <a href={pdfUrl} className="hidden sm:inline-flex">
            <Button size="sm" variant="outline" iconLeft={<Download className="h-3.5 w-3.5 text-muted" />}>Download PDF</Button>
          </a>
          {canEmail && (
            <Button size="sm" variant={st === 'DRAFT' ? 'primary' : 'outline'} iconLeft={<Mail className="h-3.5 w-3.5" />} onClick={() => openEmail('PROFORMA', proforma.id)}>
              {wasEmailed ? 'Resend Email' : 'Send Email'}
            </Button>
          )}
          {st === 'SENT' && canWrite && (
            <Button size="sm" loading={isChangingStatus} iconLeft={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => handleStatusChange('CONFIRMED')}>
              Mark as Confirmed
            </Button>
          )}
          {st === 'CONFIRMED' && canConvert && (
            <Button size="sm" iconLeft={<Sparkles className="h-3.5 w-3.5" />} onClick={() => { setConversionSuccess(false); setErrorMessage(''); setIsConvertModalOpen(true); }}
              className="bg-[#15803D] hover:bg-[#166534] text-white font-bold text-xs">
              Convert to Tax Invoice
            </Button>
          )}
          {st === 'CONVERTED' && proforma.convertedToInvoiceId && (
            <>
              <LinkButton href={`/invoices/${proforma.convertedToInvoiceId}`} size="sm" iconLeft={<Receipt className="h-3.5 w-3.5" />}>
                View Tax Invoice
              </LinkButton>
              {canConvert && (
                <Button size="sm" variant="outline" iconLeft={<Mail className="h-3.5 w-3.5" />} onClick={() => openEmail('TAX_INVOICE', proforma.convertedToInvoiceId!)}>
                  Send Invoice
                </Button>
              )}
            </>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" iconLeft={<MoreHorizontal className="h-3.5 w-3.5" />}>More</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem className="sm:hidden" onSelect={() => setIsPrintModalOpen(true)}><Eye className="h-3.5 w-3.5" /> Preview</DropdownMenuItem>
              <DropdownMenuItem className="sm:hidden" onSelect={() => { window.location.href = pdfUrl; }}><Download className="h-3.5 w-3.5" /> Download PDF</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => window.open(`/quote/${proforma.id}`, '_blank')}><ExternalLink className="h-3.5 w-3.5" /> Customer portal</DropdownMenuItem>
              {st === 'DRAFT' && canWrite && (
                <DropdownMenuItem onSelect={() => setIsEditOpen(true)}><Edit2 className="h-3.5 w-3.5" /> Edit terms &amp; freight</DropdownMenuItem>
              )}
              {canWrite && statusOptions.filter((o) => o !== 'CANCELLED').length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Change status</DropdownMenuLabel>
                  {statusOptions.filter((o) => o !== 'CANCELLED').map((o) => (
                    <DropdownMenuItem key={o} onSelect={() => handleStatusChange(o)}>
                      {o === 'DRAFT' ? <RotateCcw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {o === 'DRAFT' ? 'Reopen as Draft' : `Mark as ${STATUS_LABELS[o]}`}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {canWrite && statusOptions.includes('CANCELLED') && (
                <DropdownMenuItem destructive onSelect={() => setPendingCancel(true)}><AlertTriangle className="h-3.5 w-3.5" /> Cancel proforma</DropdownMenuItem>
              )}
              {canWrite && (st === 'DRAFT' || st === 'CANCELLED') && (
                <DropdownMenuItem destructive onSelect={() => setIsDeleteOpen(true)}><Trash2 className="h-3.5 w-3.5" /> Delete</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Document Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Items & Financials */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-line-soft bg-surface flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                Quotation Line Items ({proforma.items?.length || 0})
              </h3>
              <span className="text-xs font-mono font-semibold text-ink-secondary">Currency: USD ($)</span>
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface border-b border-line text-muted uppercase tracking-wider font-semibold text-[11px]">
                  <tr>
                    <th className="py-2.5 px-4">Equipment / Model</th>
                    <th className="py-2.5 px-4 text-center">Qty</th>
                    <th className="py-2.5 px-4 text-right">Unit Price</th>
                    <th className="py-2.5 px-4 text-right">Discount</th>
                    <th className="py-2.5 px-4 text-right">Line Total</th>
                    {hasFreightAllocation && <th className="py-2.5 px-4 text-right">Allocated Freight</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {proforma.items?.map((item) => (
                    <tr key={item.id} className="hover:bg-surface transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-ink">{item.productName}</div>
                        <div className="text-[11px] font-mono text-muted mt-0.5">
                          SKU: {item.productSku} · Brand: {item.brand}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-ink">
                        {item.quantity}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-ink-secondary">
                        {formatUSD(item.unitPrice)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-muted">
                        {item.discountPercent > 0 ? `${item.discountPercent}%` : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-ink">
                        {formatUSD(item.totalPrice)}
                      </td>
                      {hasFreightAllocation && (
                        <td className="py-3 px-4 text-right font-mono text-ink-secondary">
                          {item.allocatedFreight ? formatUSD(item.allocatedFreight) : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-line-soft">
              {proforma.items?.map((item) => (
                <div key={item.id} className="p-4 space-y-2 text-xs">
                  <div className="font-semibold text-ink text-sm">{item.productName}</div>
                  <div className="text-[11px] font-mono text-muted">
                    SKU: {item.productSku} · Brand: {item.brand}
                  </div>
                  <div className="flex items-center justify-between pt-1.5 border-t border-line-soft">
                    <span className="text-muted">
                      Qty <span className="font-mono font-bold text-ink">{item.quantity}</span> × {formatUSD(item.unitPrice)}
                      {item.discountPercent > 0 && <span className="text-muted"> (-{item.discountPercent}%)</span>}
                    </span>
                    <span className="font-mono font-bold text-ink">{formatUSD(item.totalPrice)}</span>
                  </div>
                  {hasFreightAllocation && (
                    <div className="flex items-center justify-between text-muted">
                      <span>Allocated Freight</span>
                      <span className="font-mono text-ink-secondary">
                        {item.allocatedFreight ? formatUSD(item.allocatedFreight) : '—'}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Financial Summary */}
            <div className="p-4 bg-surface border-t border-line-soft flex flex-col items-end space-y-1.5 text-xs font-mono">
              <div className="flex justify-between w-full sm:w-64 text-ink-secondary">
                <span>Subtotal:</span>
                <span className="text-ink font-medium">{formatUSD(proforma.subtotal)}</span>
              </div>
              {proforma.discountAmount > 0 && (
                <div className="flex justify-between w-full sm:w-64 text-rose-600">
                  <span>Special Discount:</span>
                  <span>-{formatUSD(proforma.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between w-full sm:w-64 text-ink-secondary">
                <span>VAT / Tax (5%):</span>
                <span className="text-ink">{formatUSD(proforma.taxAmount)}</span>
              </div>
              <div className="flex justify-between w-full sm:w-64 text-ink-secondary items-center">
                <span className="flex items-center gap-1.5">
                  Shipping / Freight:
                  {proforma.freightIsManualOverride && <Badge tone="warning">Manual Override</Badge>}
                </span>
                <span className="text-ink">{formatUSD(proforma.shippingCost)}</span>
              </div>
              <div className="flex justify-between w-full sm:w-64 pt-2 border-t border-line text-sm font-bold text-ink">
                <span>Grand Total (USD):</span>
                <span className="text-primary font-bold">{formatUSD(proforma.grandTotal)}</span>
              </div>
            </div>
          </Card>

          {/* Prompt Section 15: Converted State Banner */}
          {proforma.status === 'CONVERTED' && (
            <Card className="p-5 bg-emerald-50/50 border-emerald-200 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-bold text-emerald-900">Tax Invoice Created</h3>
              </div>
              <p className="text-xs text-emerald-700">
                Converted to Tax Invoice <strong className="font-mono">{proforma.convertedToInvoiceNumber}</strong>. The order is in the depot fulfilment queue.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {proforma.convertedToInvoiceId && (
                  <LinkButton href={`/invoices/${proforma.convertedToInvoiceId}`} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs">
                    View Invoice
                  </LinkButton>
                )}
                {proforma.convertedToInvoiceId && (
                  <a href={`/api/document-pdf/TAX_INVOICE/${proforma.convertedToInvoiceId}`}>
                    <Button size="sm" variant="outline" iconLeft={<Download className="h-3.5 w-3.5" />}>Invoice PDF</Button>
                  </a>
                )}
                {proforma.convertedToInvoiceId && canConvert && (
                  <Button size="sm" variant="outline" iconLeft={<Mail className="h-3.5 w-3.5" />} onClick={() => openEmail('TAX_INVOICE', proforma.convertedToInvoiceId!)}>
                    Send Invoice
                  </Button>
                )}
                <LinkButton href="/depot" size="sm" variant="secondary" iconLeft={<Truck className="h-3.5 w-3.5" />}>
                  Go to Depot Fulfilment
                </LinkButton>
              </div>
            </Card>
          )}
        </div>

        {/* Right Column: Customer & Terms */}
        <div className="space-y-6">
          <EmailHistory documentType="PROFORMA" documentId={proforma.id} refreshKey={emailRefresh} canSend={canWrite} onChanged={() => loadData(true)} />
          <Card className="p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Customer Details</h3>
            <div>
              <h4 className="text-sm font-bold text-ink">{proforma.customerCompany}</h4>
              <p className="text-xs text-muted mt-0.5">{proforma.customerName}</p>
              <p className="text-xs text-muted">{proforma.customerEmail}</p>
            </div>
            <div className="pt-3 border-t border-line-soft space-y-2 text-xs text-ink-secondary">
              <div>
                <span className="font-semibold text-ink-secondary block mb-0.5">Billing Address:</span>
                <span className="text-[11px] leading-relaxed text-muted">{proforma.billingAddress}</span>
              </div>
              <div>
                <span className="font-semibold text-ink-secondary block mb-0.5">Shipping Address:</span>
                <span className="text-[11px] leading-relaxed text-muted">{proforma.shippingAddress}</span>
              </div>
            </div>
          </Card>

          <Card className="p-5 space-y-3 text-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Commercial Terms</h3>
            <div className="space-y-2 text-ink-secondary">
              <div className="flex justify-between">
                <span>Payment Terms:</span>
                <span className="text-ink font-medium">{proforma.paymentTerms || 'Not specified'}</span>
              </div>
              <div className="flex justify-between">
                <span>Payment Method:</span>
                <span className="text-ink font-medium">{proforma.paymentMethod || 'Not specified'}</span>
              </div>
              <div className="flex justify-between">
                <span>Incoterms:</span>
                <span className="text-ink font-medium">{incotermLine(proforma.incoterm, proforma.incotermPlace) || 'Not specified'}</span>
              </div>
              {printableDelivery(proforma.deliveryTerms) && (
                <div className="flex justify-between">
                  <span>Delivery note:</span>
                  <span className="text-ink font-medium">{printableDelivery(proforma.deliveryTerms)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Expiry Date:</span>
                <span className="text-ink font-mono">{formatDate(proforma.expiryDate)}</span>
              </div>
            </div>
          </Card>

          {((proforma.chargeableWeightKg || 0) > 0 || canAllocateFreight) && (
            <Card className="p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <Scale className="h-3.5 w-3.5 text-muted" /> Freight Breakdown
                </h3>
                {proforma.freightIsManualOverride && <Badge tone="warning">Manual Override</Badge>}
              </div>
              {(proforma.chargeableWeightKg || 0) > 0 && (
                <div className="space-y-2 text-ink-secondary">
                  <div className="flex justify-between">
                    <span>Actual Weight:</span>
                    <span className="text-ink font-mono">{(proforma.actualWeightKg || 0).toFixed(2)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Volumetric Weight:</span>
                    <span className="text-ink font-mono">{(proforma.volumetricWeightKg || 0).toFixed(2)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Chargeable Weight:</span>
                    <span className="text-ink font-mono font-semibold">{(proforma.chargeableWeightKg || 0).toFixed(2)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Freight Rate:</span>
                    <span className="text-ink font-mono">{formatUSD(proforma.freightRatePerKg || 0)} / kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Freight Charge:</span>
                    <span className="text-ink font-mono">{formatUSD(proforma.freightCharge || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Additional Shipping Charges:</span>
                    <span className="text-ink font-mono">{formatUSD(proforma.additionalFreightCharges || 0)}</span>
                  </div>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-line-soft font-semibold">
                <span className="text-ink">Total Freight:</span>
                <span className="text-primary font-mono">{formatUSD(proforma.shippingCost)}</span>
              </div>
              {canAllocateFreight && (
                <Button
                  variant="outline"
                  size="sm"
                  iconLeft={<PieChart className="h-3.5 w-3.5 text-primary" />}
                  onClick={() => setIsAllocateModalOpen(true)}
                  className="w-full"
                >
                  Allocate Freight to Products
                </Button>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Proforma -> Tax Invoice confirmation */}
      {isConvertModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in overflow-y-auto">
          <div className="relative w-full max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain max-w-lg rounded-xl border border-line bg-white shadow-2xl p-4 sm:p-6 space-y-5">
            {conversionSuccess ? (
              <div className="space-y-5">
                <div className="flex flex-col items-center text-center gap-2 py-2">
                  <div className="h-12 w-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <p className="text-base font-semibold text-ink">
                    Tax Invoice <span className="font-mono">{generatedInvoice?.number}</span> created successfully.
                  </p>
                  <p className="text-xs text-muted max-w-xs">Proforma {proforma.proformaNumber} is now Converted. The order is in the depot fulfilment queue.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-4 border-t border-line-soft">
                  <LinkButton href={`/invoices/${generatedInvoice?.id}`} size="sm">View Invoice</LinkButton>
                  <a href={`/api/document-pdf/TAX_INVOICE/${generatedInvoice?.id}`} className="contents">
                    <Button size="sm" variant="outline" iconLeft={<Download className="h-3.5 w-3.5" />}>Download PDF</Button>
                  </a>
                  <Button size="sm" variant="outline" iconLeft={<Mail className="h-3.5 w-3.5" />}
                    onClick={() => { setIsConvertModalOpen(false); if (generatedInvoice) openEmail('TAX_INVOICE', generatedInvoice.id); }}>
                    Send Invoice
                  </Button>
                  <LinkButton href="/depot" size="sm" variant="secondary" iconLeft={<Truck className="h-3.5 w-3.5" />}>Go to Depot</LinkButton>
                </div>
                <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => setIsConvertModalOpen(false)}>Close</Button></div>
              </div>
            ) : (
              <div className="space-y-4 text-sm text-ink-secondary">
                <div className="flex items-start justify-between pb-3 border-b border-line-soft">
                  <h3 className="text-lg font-semibold tracking-tight text-ink">Convert Proforma to Tax Invoice?</h3>
                  <button onClick={() => setIsConvertModalOpen(false)} className="text-muted hover:text-ink-secondary h-8 w-8 -mr-2" aria-label="Close">✕</button>
                </div>
                <div className="rounded-lg border border-line divide-y divide-line-soft text-sm">
                  <SummaryRow k="Proforma Number"><span className="font-mono font-semibold text-ink">{proforma.proformaNumber}</span></SummaryRow>
                  <SummaryRow k="Customer"><span className="font-semibold text-ink">{proforma.customerCompany}</span></SummaryRow>
                  <div className="px-3.5 py-2.5">
                    <div className="text-muted mb-1.5">Products ({proforma.items?.length || 0})</div>
                    <ul className="space-y-1 max-h-36 overflow-y-auto text-xs">
                      {proforma.items?.map((it) => (
                        <li key={it.id} className="flex justify-between gap-3">
                          <span className="text-ink truncate">{it.productName} <span className="font-mono text-muted">{it.productSku}</span></span>
                          <span className="font-mono text-ink shrink-0">× {it.quantity}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="px-3.5 py-2.5 space-y-1.5">
                    <label className="block text-muted">Depot</label>
                    <select value={selectedDepotId} onChange={(e) => setSelectedDepotId(e.target.value)}
                      className="w-full rounded-md border border-line bg-white px-3 h-10 text-sm text-ink">
                      {!depots.some((d) => d.id === selectedDepotId) && <option value="">Select an active depot…</option>}
                      {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    {depots.length === 0 && <p className="text-[11px] text-warning">No active depot is available. Activate or create one under Depots.</p>}
                  </div>
                  <SummaryRow k="Subtotal">{formatUSD(proforma.subtotal)}</SummaryRow>
                  {proforma.discountAmount > 0 && <SummaryRow k="Discount">-{formatUSD(proforma.discountAmount)}</SummaryRow>}
                  <SummaryRow k="Tax">{formatUSD(proforma.taxAmount)}</SummaryRow>
                  {proforma.shippingCost > 0 && <SummaryRow k="Freight">{formatUSD(proforma.shippingCost)}</SummaryRow>}
                  <SummaryRow k="Total"><span className="font-bold text-primary">{formatUSD(proforma.grandTotal)}</span></SummaryRow>
                </div>
                <p className="text-xs leading-relaxed">
                  Customer, addresses, products, prices, discounts, tax, freight, payment terms and notes are carried over.
                  The invoice is issued with the next invoice number and sent to the selected depot for fulfilment.
                </p>
                {errorMessage && <div className="p-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md">{errorMessage}</div>}
                <div className="flex items-center justify-end gap-2 pt-3 border-t border-line-soft">
                  <Button variant="outline" onClick={() => setIsConvertModalOpen(false)} disabled={isConverting}>Cancel</Button>
                  <Button loading={isConverting} onClick={handleConvert} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                    Convert to Tax Invoice
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {emailTarget && (
        <SendEmailModal
          open
          onClose={() => setEmailTarget(null)}
          documentType={emailTarget.type}
          documentId={emailTarget.id}
          onDelivered={() => { setEmailRefresh((n) => n + 1); loadData(true); }}
        />
      )}

      {/* PDF Modal */}
      {isPrintModalOpen && (
        <PrintableDocumentModal
          isOpen={true}
          onClose={() => setIsPrintModalOpen(false)}
          documentType="PROFORMA"
          data={proforma}
        />
      )}

      <ConfirmDialog
        open={pendingCancel}
        onClose={() => setPendingCancel(false)}
        onConfirm={() => handleStatusChange('CANCELLED')}
        title={`Cancel ${proforma.proformaNumber}?`}
        description="The quotation will be marked as cancelled. You can reopen it as a draft later if the customer comes back."
        confirmLabel="Cancel Proforma"
        cancelLabel="Keep Active"
        destructive
        loading={isChangingStatus}
      />

      <ConfirmDialog
        open={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleDeleteProforma}
        title={`Delete Proforma ${proforma.proformaNumber}?`}
        description="Are you sure you want to permanently delete this quotation? This cannot be undone."
        confirmLabel="Delete Proforma"
        destructive
        loading={isDeleting}
      />

      {proforma.status === 'DRAFT' && (
        <EditInvoiceItemsModal
          invoice={proforma}
          subject="proforma"
          docNumber={proforma.proformaNumber}
          endpoint={`/api/proformas/${proforma.id}/items`}
          open={isEditItemsOpen}
          onClose={() => setIsEditItemsOpen(false)}
          onSaved={() => {
            toast({ title: 'Quotation items saved', variant: 'success' });
            loadData(true);
          }}
        />
      )}

      <Drawer
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title="Edit Quotation Terms"
        description="Update commercial parameters and special instructions."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setIsEditOpen(false)} disabled={isSavingEdit}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} loading={isSavingEdit}>
              Save Terms
            </Button>
          </div>
        }
      >
        <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
          <TermsFields
            value={{ paymentTerms: editTerms.paymentTerms, paymentMethod: editTerms.paymentMethod, incoterm: editTerms.incoterm, incotermPlace: editTerms.incotermPlace, deliveryTerms: editTerms.deliveryTerms }}
            onChange={(next) => setEditTerms({ ...editTerms, ...next })}
          />
          <Input
            label="Discount (%)"
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={editTerms.discountPercent}
            onChange={(e) => setEditTerms({ ...editTerms, discountPercent: Number(e.target.value) })}
            wrapperClassName="max-w-[10rem]"
          />

          <div className="pt-2 border-t border-line-soft">
            <FreightSummaryPanel
              compact
              actualWeightKg={proforma.actualWeightKg || 0}
              volumetricWeightKg={proforma.volumetricWeightKg || 0}
              volumetricDivisor={proforma.freightVolumetricDivisor || 0}
              freightRatePerKg={freightRatePerKg}
              onFreightRateChange={setFreightRatePerKg}
              additionalFreightCharges={additionalFreightCharges}
              onAdditionalChargesChange={setAdditionalFreightCharges}
              isManualOverride={isFreightManualOverride}
              onManualOverrideChange={setIsFreightManualOverride}
              manualTotalFreight={manualTotalFreight}
              onManualTotalFreightChange={setManualTotalFreight}
            />
            <p className="text-[11px] text-muted mt-2">
              Actual/Volumetric Weight were set when this quotation was created. To change them, adjust the
              product weights and dimensions from a new quotation, or contact an administrator.
            </p>
          </div>

          <Textarea
            label="Internal Notes / Remarks"
            value={editTerms.notes}
            onChange={(e) => setEditTerms({ ...editTerms, notes: e.target.value })}
            rows={3}
            placeholder="Special handling instructions..."
          />
        </form>
      </Drawer>

      {isAllocateModalOpen && (
        <FreightAllocationModal
          isOpen={isAllocateModalOpen}
          onClose={() => setIsAllocateModalOpen(false)}
          documentLabel={proforma.proformaNumber}
          totalFreight={proforma.shippingCost}
          isSaving={isSavingAllocation}
          items={(proforma.items || []).map(
            (it): FreightAllocationItem => ({
              id: it.id,
              label: it.productName,
              sku: it.productSku,
              quantity: it.quantity,
              unitWeightKg: it.unitWeightKg || 0,
              totalPrice: it.totalPrice,
              allocatedFreight: it.allocatedFreight,
            })
          )}
          onSave={async (method: FreightAllocationMethod, allocations) => {
            setIsSavingAllocation(true);
            try {
              const res = await fetch(`/api/proformas/${proforma.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  freightAllocation: {
                    method,
                    allocations: allocations.map((a) => ({ itemId: a.id, allocatedFreight: a.allocatedFreight })),
                  },
                }),
              });
              if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || 'Failed to save freight allocation');
              }
              toast({ title: 'Freight allocation saved', variant: 'success' });
              setIsAllocateModalOpen(false);
              loadData(true);
            } catch (err: any) {
              toast({ title: err.message || 'Could not save allocation', variant: 'error' });
            } finally {
              setIsSavingAllocation(false);
            }
          }}
        />
      )}
    </div>
  );
}

function SummaryRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 px-3.5 py-2.5">
      <span className="text-muted">{k}</span>
      <span className="text-ink text-right">{children}</span>
    </div>
  );
}
