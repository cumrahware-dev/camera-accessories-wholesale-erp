'use client';

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
} from 'lucide-react';
const fireConfetti = (opts: Record<string, unknown>) => {
  import('canvas-confetti').then((m) => m.default(opts as any)).catch(() => {});
};
import { formatUSD, formatDate } from '@/lib/utils';
import { Proforma, Depot } from '@/types/erp';
import { fetchSettingsCached } from '@/lib/client-cache';
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
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editTerms, setEditTerms] = useState({
    paymentTerms: '',
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
        deliveryTerms: data.deliveryTerms || '',
        discountPercent: data.discountPercent || 0,
        shippingCost: data.shippingCost || 0,
        notes: data.notes || '',
      });
      setFreightRatePerKg(data.freightRatePerKg || 0);
      setAdditionalFreightCharges(data.additionalFreightCharges || 0);
      setIsFreightManualOverride(Boolean(data.freightIsManualOverride));
      setManualTotalFreight(data.freightIsManualOverride ? data.shippingCost || 0 : 0);

      const depsRes = await fetch('/api/depots');
      if (depsRes.ok) {
        const allDepots = await depsRes.json();
        setDepots(allDepots);
        if (!selectedDepotId) {
          setSelectedDepotId(data.items[0]?.selectedDepotId || allDepots[0]?.id || 'dep-dxb');
        }
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
        const err = await res.json();
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
        title: 'Invoice Created Successfully',
        description: `${newInvoice.invoiceNumber || 'INV-XXXX'} · Depot notification queued`,
        variant: 'success',
      });

      loadData(true);
    } catch (err: any) {
      setErrorMessage(err.message || 'Conversion failed');
      setIsConverting(false);
    }
  };

  const handleSendEmail = async () => {
    if (!proforma) return;
    try {
      setIsSendingEmail(true);
      setErrorMessage('');
      // Only the identifier is sent — the server reads line items and totals
      // from the database so the email always matches the stored document.
      const res = await fetch('/api/emails/send-proforma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proformaId: proforma.id,
          appUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to send email. Check your SMTP settings.');
      }

      await loadData(true);
      const isSimulated = Boolean(data.simulated);
      setEmailResult({
        simulated: isSimulated,
        message:
          data.message ||
          (isSimulated
            ? 'SMTP is not configured, so the email was logged but not delivered. Add SMTP credentials in Settings.'
            : `Quotation delivered to ${proforma.customerEmail}`),
        recipient: data.recipient || proforma.customerEmail,
      });

      toast({
        title: isSimulated ? 'Email Logged (SMTP not configured)' : 'Proforma Sent Successfully',
        description:
          data.message ||
          (isSimulated
            ? 'SMTP is not configured, so the email was logged but not delivered. Add SMTP credentials in Settings.'
            : `Quotation delivered to ${proforma.customerEmail}`),
        variant: isSimulated ? 'warning' : 'success',
      });
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to send email.');
      toast({ title: 'Email failed', description: error?.message, variant: 'error' });
    } finally {
      setIsSendingEmail(false);
    }
  };

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
          <Button
            size="sm"
            variant="outline"
            iconLeft={<Printer className="h-3.5 w-3.5 text-muted" />}
            onClick={() => setIsPrintModalOpen(true)}
          >
            Print PDF
          </Button>

          <LinkButton
            href={`/quote/${proforma.id}`}
            target="_blank"
            variant="outline"
            size="sm"
            iconLeft={<ExternalLink className="h-3.5 w-3.5 text-primary" />}
          >
            Customer Portal
          </LinkButton>

          {proforma.status !== 'CONVERTED' && (
            <Button
              size="sm"
              variant="outline"
              iconLeft={<Mail className="h-3.5 w-3.5 text-primary" />}
              onClick={() => {
                setEmailResult(null);
                setErrorMessage('');
                setIsEmailModalOpen(true);
              }}
            >
              Email Quote
            </Button>
          )}

          {/* 1. APPROVE PROFORMA BUTTON (When status is DRAFT, SENT, or PENDING) */}
          {(proforma.status === 'DRAFT' || proforma.status === 'SENT' || (proforma.status as string) === 'PENDING') && (
            <Button
              size="sm"
              loading={isChangingStatus}
              iconLeft={<CheckCircle2 className="h-3.5 w-3.5 text-white" />}
              onClick={() => handleStatusChange('CONFIRMED')}
              className="bg-[#005E82] hover:bg-[#004B68] text-white font-bold text-xs shadow-sm"
            >
              Approve Proforma
            </Button>
          )}

          {/* 2. CONVERT TO TAX INVOICE BUTTON (When status is CONFIRMED) */}
          {proforma.status === 'CONFIRMED' && (
            <Button
              size="sm"
              iconLeft={<Sparkles className="h-3.5 w-3.5 text-white" />}
              onClick={() => setIsConvertModalOpen(true)}
              className="bg-[#15803D] hover:bg-[#166534] text-white font-bold text-xs shadow-sm"
            >
              Convert to Tax Invoice
            </Button>
          )}

          {/* VIEW CONVERTED INVOICE */}
          {proforma.status === 'CONVERTED' && proforma.convertedToInvoiceId && (
            <LinkButton
              href={`/invoices/${proforma.convertedToInvoiceId}`}
              size="sm"
              iconLeft={<Receipt className="h-3.5 w-3.5" />}
              className="bg-[#15803D] hover:bg-[#166534] text-white font-bold text-xs"
            >
              View Tax Invoice #{proforma.convertedToInvoiceNumber}
            </LinkButton>
          )}

          {/* EDIT OPTION (DRAFT ONLY) */}
          {proforma.status === 'DRAFT' && (
            <Button
              size="sm"
              variant="outline"
              iconLeft={<Edit2 className="h-3.5 w-3.5" />}
              onClick={() => setIsEditOpen(true)}
            >
              Edit Terms
            </Button>
          )}

          {/* CANCEL OPTION */}
          {proforma.status !== 'CONVERTED' && proforma.status !== 'CANCELLED' && (
            <Button
              size="sm"
              variant="outline"
              loading={isChangingStatus}
              onClick={() => setPendingCancel(true)}
              className="text-amber-600 border-amber-200 hover:bg-amber-50 text-xs font-semibold"
            >
              Cancel
            </Button>
          )}

          {/* DELETE OPTION (DRAFT OR CANCELLED) */}
          {(proforma.status === 'DRAFT' || proforma.status === 'CANCELLED') && (
            <Button
              size="sm"
              variant="outline"
              iconLeft={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => setIsDeleteOpen(true)}
              className="text-red-600 border-red-200 hover:bg-red-50 text-xs font-semibold"
            >
              Delete
            </Button>
          )}
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
                Converted to Tax Invoice <strong className="font-mono">{proforma.convertedToInvoiceNumber}</strong> and moved into depot fulfilment queue.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {proforma.convertedToInvoiceId && (
                  <LinkButton href={`/invoices/${proforma.convertedToInvoiceId}`} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs">
                    View Invoice
                  </LinkButton>
                )}
                <Button size="sm" variant="outline" iconLeft={<Printer className="h-3.5 w-3.5" />} onClick={() => setIsPrintModalOpen(true)}>
                  Download PDF
                </Button>
                <LinkButton href="/depot" size="sm" variant="secondary" iconLeft={<Truck className="h-3.5 w-3.5" />}>
                  Go to Depot Fulfilment
                </LinkButton>
              </div>
            </Card>
          )}
        </div>

        {/* Right Column: Customer & Terms */}
        <div className="space-y-6">
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
                <span className="text-ink font-medium">{proforma.paymentTerms}</span>
              </div>
              <div className="flex justify-between">
                <span>Delivery Terms:</span>
                <span className="text-ink font-medium">{proforma.deliveryTerms}</span>
              </div>
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

      {/* Section 15: Tax Invoice Conversion Confirmation Modal */}
      {isConvertModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in overflow-y-auto">
          <div className="relative w-full max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain max-w-lg rounded-xl border border-line bg-white shadow-2xl p-4 sm:p-7 space-y-5">
            {!conversionSuccess && (
              <div className="flex items-start justify-between pb-4 border-b border-line-soft">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary mb-1.5">
                    {proforma.proformaNumber}
                  </div>
                  <h3 className="text-xl font-semibold tracking-tight text-ink">Convert to Tax Invoice</h3>
                </div>
                <button onClick={() => setIsConvertModalOpen(false)} className="text-muted hover:text-ink-secondary mt-1">
                  ✕
                </button>
              </div>
            )}

            {conversionSuccess ? (
              <div className="space-y-5">
                <div className="flex flex-col items-center text-center gap-2 py-2">
                  <div className="h-12 w-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-600 mt-1">
                    Tax Invoice Created
                  </div>
                  <div className="text-2xl font-semibold tracking-tight text-ink font-mono">
                    {generatedInvoice?.number}
                  </div>
                  <p className="text-sm text-muted max-w-xs">
                    The order has been placed into the physical depot fulfilment workflow.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-4 border-t border-line-soft">
                  <LinkButton href={`/invoices/${generatedInvoice?.id}`} size="sm" className="bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs">
                    View Invoice
                  </LinkButton>
                  <Button size="sm" variant="outline" iconLeft={<Printer className="h-3.5 w-3.5" />} onClick={() => setIsPrintModalOpen(true)}>
                    Download PDF
                  </Button>
                  <LinkButton href="/depot" size="sm" variant="secondary">
                    Go to Depot
                  </LinkButton>
                </div>
              </div>
            ) : (
              <div className="space-y-5 text-sm text-ink-secondary">
                <div className="rounded-lg border border-line divide-y divide-line-soft text-sm">
                  <div className="flex justify-between px-3.5 py-2.5">
                    <span className="text-muted">Customer</span>
                    <span className="font-semibold text-ink">{proforma.customerCompany}</span>
                  </div>
                  <div className="flex justify-between px-3.5 py-2.5">
                    <span className="text-muted">Products</span>
                    <span className="text-ink">{proforma.items?.length || 0} line items</span>
                  </div>
                  <div className="flex justify-between px-3.5 py-2.5">
                    <span className="text-muted">Subtotal</span>
                    <span className="text-ink">{formatUSD(proforma.subtotal)}</span>
                  </div>
                  <div className="flex justify-between px-3.5 py-2.5">
                    <span className="text-muted">Tax</span>
                    <span className="text-ink">{formatUSD(proforma.taxAmount)}</span>
                  </div>
                  <div className="flex justify-between px-3.5 py-2.5 bg-surface rounded-b-lg">
                    <span className="font-semibold text-ink">Total</span>
                    <span className="font-bold text-primary">{formatUSD(proforma.grandTotal)}</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-primary-soft border border-primary/15 text-brand-900 text-xs leading-relaxed">
                  This will create a Tax Invoice and move this order into the depot fulfilment workflow.
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-ink-secondary">Select Fulfilment Depot</label>
                  <select
                    value={selectedDepotId}
                    onChange={(e) => setSelectedDepotId(e.target.value)}
                    className="w-full rounded-md border border-line bg-white px-3 py-1.5 text-xs text-ink"
                  >
                    {depots.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-line-soft">
                  <Button variant="outline" onClick={() => setIsConvertModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    loading={isConverting}
                    onClick={handleConvert}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs"
                  >
                    Create Tax Invoice
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Email Quote Modal */}
      {isEmailModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in overflow-y-auto">
          <div className="relative w-full max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain max-w-md rounded-xl border border-line bg-white shadow-2xl p-4 sm:p-7 space-y-5">
            <div className="flex items-start justify-between pb-4 border-b border-line-soft">
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-ink">Email Quotation</h3>
                <p className="text-xs text-muted mt-1">Send Proforma {proforma.proformaNumber}</p>
              </div>
              <button
                onClick={() => {
                  setIsEmailModalOpen(false);
                  setEmailResult(null);
                }}
                className="text-muted hover:text-ink-secondary mt-1"
              >
                ✕
              </button>
            </div>

            {!emailResult ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-surface border border-line">
                  <div className="text-xs text-muted mb-1">Recipient Email</div>
                  <div className="text-sm font-semibold text-ink">
                    {proforma.customerEmail || 'No email address on file for this customer'}
                  </div>
                </div>

                {isSmtpConfigured === false && (
                  <div className="p-3.5 rounded-lg bg-amber-50/80 border border-amber-200/80 text-amber-900 text-xs flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-semibold text-amber-950">SMTP Not Configured (Simulation Mode)</div>
                      <p className="text-amber-800 text-[11px] leading-relaxed">
                        Live email delivery is currently disabled. Sending will record this proforma in the Email &amp; Notification logs without dispatching a live email.
                      </p>
                      <Link
                        href="/settings"
                        className="inline-flex items-center gap-1 font-medium text-amber-900 underline hover:text-amber-950 text-[11px] mt-0.5"
                      >
                        Configure SMTP in Settings <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                )}

                {errorMessage && (
                  <div className="p-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md">
                    {errorMessage}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-line-soft">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsEmailModalOpen(false);
                      setEmailResult(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    loading={isSendingEmail}
                    onClick={handleSendEmail}
                    disabled={!proforma.customerEmail}
                    className="bg-[#005E82] hover:bg-[#004B68] text-white font-semibold text-xs"
                    iconLeft={<Send className="h-3.5 w-3.5" />}
                  >
                    {isSmtpConfigured === false ? 'Send & Log (Simulated)' : 'Send Email'}
                  </Button>
                </div>
              </div>
            ) : emailResult.simulated ? (
              <div className="space-y-5">
                <div className="flex flex-col items-center text-center gap-2.5 py-4">
                  <div className="h-12 w-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-base font-bold text-ink">Email Logged (SMTP Not Configured)</div>
                    <div className="text-xs text-ink-secondary mt-1 max-w-sm">
                      {emailResult.message}
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-surface border border-line text-xs space-y-1.5">
                  <div className="font-semibold text-ink">Delivery Status</div>
                  <p className="text-ink-secondary text-[11px] leading-relaxed">
                    This proforma was recorded in the Notification &amp; Email Audit logs. To deliver live emails directly to your customers' inboxes, please enter your SMTP credentials in Settings.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-line-soft">
                  <LinkButton href="/settings" variant="outline" size="sm">
                    Configure SMTP
                  </LinkButton>
                  <Button
                    size="sm"
                    onClick={() => {
                      setIsEmailModalOpen(false);
                      setEmailResult(null);
                    }}
                  >
                    Close
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col items-center text-center gap-2 py-4">
                  <div className="h-12 w-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-base font-bold text-ink">Email Sent Successfully</div>
                    <div className="text-xs text-muted mt-1">
                      Quotation delivered to {emailResult.recipient || proforma.customerEmail}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end pt-3 border-t border-line-soft">
                  <Button
                    size="sm"
                    onClick={() => {
                      setIsEmailModalOpen(false);
                      setEmailResult(null);
                    }}
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
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
          <Input
            label="Payment Terms"
            value={editTerms.paymentTerms}
            onChange={(e) => setEditTerms({ ...editTerms, paymentTerms: e.target.value })}
            placeholder="e.g. NET 30 days from dispatch"
          />
          <Input
            label="Delivery Terms"
            value={editTerms.deliveryTerms}
            onChange={(e) => setEditTerms({ ...editTerms, deliveryTerms: e.target.value })}
            placeholder="e.g. Air Freight via Courier (CIF)"
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
