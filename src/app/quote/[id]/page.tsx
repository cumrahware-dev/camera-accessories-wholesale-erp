'use client';

import React, { useState, useEffect } from 'react';
import { incotermLine, printableDelivery } from '@/lib/documents/terms';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  FileCheck2,
  Printer,
  CheckCircle2,
  Building2,
  Clock,
  Send,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  CreditCard,
  Truck,
  Copy,
  Check,
  HelpCircle,
  Package,
  Phone,
  Mail,
  ExternalLink,
  ChevronRight,
  Info,
} from 'lucide-react';
const fireConfetti = (opts: Record<string, unknown>) => {
  import('canvas-confetti').then((m) => m.default(opts as any)).catch(() => {});
};
import { formatUSD, formatDate, getStatusBadgeClasses } from '@/lib/utils';
import { Proforma, CompanySettings } from '@/types/erp';
import PrintableDocumentModal from '@/components/pdf/PrintableDocumentModal';

export default function PublicQuotePortalPage() {
  const params = useParams();
  const id = params.id as string;

  const [proforma, setProforma] = useState<Proforma | null>(null);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const bankAccounts: any[] = (proforma as any)?.companyProfile?.bankAccounts || [];
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmedSuccess, setConfirmedSuccess] = useState(false);
  const [confirmNotes, setConfirmNotes] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const loadData = async () => {
    try {
      const [pfData, settingsData] = await Promise.all([
        fetch(`/api/proformas/${id}`).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/settings').then((r) => (r.ok ? r.json() : null)),
      ]);

      setProforma(pfData);
      // The company block of this quotation: frozen when it was sent/confirmed, otherwise the live Settings.
      setSettings(pfData?.companyProfile ? ({ ...(settingsData || {}), ...pfData.companyProfile.company } as any) : settingsData);
    } catch (error) {
      console.error('Error loading quotation:', error);
      setProforma(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCustomerAccept = async () => {
    if (!proforma) return;
    setIsConfirming(true);
    setErrorMessage('');

    try {
      const res = await fetch(`/api/proformas/${proforma.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'CONFIRMED',
          notes: confirmNotes
            ? `${proforma.notes ? proforma.notes + '\n' : ''}[Customer Acceptance Note]: ${confirmNotes}`
            : proforma.notes,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to confirm quotation. Please contact sales directly.');
      }

      const updated = await res.json();
      setProforma((prev) => (prev ? { ...prev, ...updated, items: updated.items || prev.items || [] } : updated));
      setConfirmedSuccess(true);
      setIsConfirmModalOpen(false);

      // Trigger Celebration
      fireConfetti({
        particleCount: 150,
        spread: 90,
        origin: { y: 0.5 },
        colors: ['#0284c7', '#10b981', '#38bdf8', '#fbbf24'],
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Confirmation failed');
    } finally {
      setIsConfirming(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 space-y-4">
        <div className="h-10 w-10 border-3 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-muted text-sm font-medium tracking-wide">Loading Secure Wholesale Quotation...</div>
      </div>
    );
  }

  if (!proforma) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="p-4 rounded-full bg-slate-900 border border-slate-800 text-rose-400">
          <AlertCircle className="h-8 w-8" />
        </div>
        <h1 className="text-xl font-bold text-white">Quotation Not Found</h1>
        <p className="text-sm text-muted max-w-md">
          The requested quotation document could not be located or may have expired. Please verify your link or contact your wholesale account manager.
        </p>
      </div>
    );
  }

  const isConfirmed = proforma.status === 'CONFIRMED' || proforma.status === 'CONVERTED';
  const badge = getStatusBadgeClasses(proforma.status);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-brand-500 selection:text-white">
      {/* Top Customer Header */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-brand-600 to-cyan-500 flex items-center justify-center shadow-glow">
              <FileCheck2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-brand-400">
                {settings?.tradingName || settings?.companyName || 'ARIB GLOBAL'}
              </div>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                <span>Proforma Invoice {proforma.proformaNumber}</span>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                  {isConfirmed ? 'CONFIRMED DEAL' : proforma.status}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Download / Print PDF */}
            <button
              onClick={() => setIsPrintModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 min-h-11 sm:min-h-0 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold shadow-sm transition-all"
            >
              <Printer className="h-4 w-4 text-muted" />
              <span>Print Official PDF</span>
            </button>

            {/* Accept & Confirm Deal CTA */}
            {!isConfirmed && (
              <button
                onClick={() => setIsConfirmModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 min-h-11 sm:min-h-0 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-glow-emerald transition-all transform active:scale-95"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Accept & Confirm Quotation</span>
              </button>
            )}

            {isConfirmed && (
              <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold">
                <Check className="h-4 w-4" />
                <span>Deal Confirmed</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Deal Confirmed Alert Banner */}
        {confirmedSuccess && (
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-start gap-3 animate-fade-in shadow-glow-emerald">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-sm text-white">Quotation Accepted & Confirmed!</h4>
              <p className="text-xs text-emerald-200/90 mt-0.5">
                Your acceptance has been registered with our operations team. Equipment allocation is currently prioritized from regional logistics hubs.
              </p>
            </div>
          </div>
        )}

        {/* Hero Card */}
        <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs font-medium">
                <ShieldCheck className="h-3.5 w-3.5 text-brand-400" />
                <span>Verified Wholesale Proforma Quotation</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                {proforma.customerCompany}
              </h1>
              <p className="text-xs sm:text-sm text-muted">
                Prepared for: <strong className="text-slate-200">{proforma.customerName}</strong> ({proforma.customerEmail})
              </p>
            </div>

            <div className="flex flex-col items-start md:items-end justify-center p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800 text-right">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted font-mono">
                Total Quotation Value
              </div>
              <div className="text-3xl sm:text-4xl font-extrabold text-brand-400 font-mono tracking-tight mt-1">
                {formatUSD(proforma.grandTotal)}
              </div>
              <div className="text-[11px] text-muted mt-1">
                Valid until {formatDate(proforma.expiryDate)}
              </div>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-6 mt-6 border-t border-slate-800/80 text-xs">
            <div className="space-y-1">
              <span className="text-muted">Document #</span>
              <p className="font-mono font-bold text-slate-200">{proforma.proformaNumber}</p>
            </div>
            <div className="space-y-1">
              <span className="text-muted">Issue Date</span>
              <p className="font-mono font-medium text-slate-200">{formatDate(proforma.issueDate)}</p>
            </div>
            <div className="space-y-1">
              <span className="text-muted">Payment Terms</span>
              <p className="font-medium text-slate-200">{proforma.paymentTerms || 'Not specified'}</p>
            </div>
            {proforma.paymentMethod && (
              <div className="space-y-1">
                <span className="text-muted">Payment Method</span>
                <p className="font-medium text-slate-200">{proforma.paymentMethod}</p>
              </div>
            )}
            {incotermLine(proforma.incoterm, proforma.incotermPlace) && (
              <div className="space-y-1">
                <span className="text-muted">Incoterms</span>
                <p className="font-medium text-slate-200">{incotermLine(proforma.incoterm, proforma.incotermPlace)}</p>
              </div>
            )}
            {printableDelivery(proforma.deliveryTerms) && (
              <div className="space-y-1">
                <span className="text-muted">Delivery Note</span>
                <p className="font-medium text-slate-200">{printableDelivery(proforma.deliveryTerms)}</p>
              </div>
            )}
          </div>
        </div>

        {/* Addresses & Company Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-400 font-mono">
              <Building2 className="h-4 w-4" />
              <span>Issuing Distributor</span>
            </div>
            <div className="text-xs text-slate-300 space-y-1">
              <p className="font-bold text-white">{settings?.companyName || settings?.tradingName}</p>
              {settings?.companyAddress && <p className="text-muted whitespace-pre-line">{settings.companyAddress}</p>}
              {(settings?.email || settings?.smtpFromEmail) && <p className="text-muted">Email: {settings?.email || settings?.smtpFromEmail}</p>}
              {settings?.phone && <p className="text-muted">Phone: {settings.phone}</p>}

              <div className="pt-2 border-t border-slate-800/80 space-y-0.5 text-[11px] font-mono">
                {(settings?.vatGstNumber || settings?.taxRegistrationNumber) && (
                  <p className="text-slate-300"><span className="text-muted font-sans font-medium">TRN:</span> {settings.vatGstNumber || settings.taxRegistrationNumber}</p>
                )}
                {settings?.corporateTaxNumber && settings.corporateTaxNumber.trim() !== '' && (
                  <p className="text-slate-300"><span className="text-muted font-sans font-medium">Corporate Tax No.:</span> {settings.corporateTaxNumber.trim()}</p>
                )}
                {settings?.tradeLicenceNumber && settings.tradeLicenceNumber.trim() !== '' && (
                  <p className="text-slate-300"><span className="text-muted font-sans font-medium">Trade Licence No.:</span> {settings.tradeLicenceNumber.trim()}</p>
                )}
                {settings?.dunsNumber && settings.dunsNumber.trim() !== '' && (
                  <p className="text-slate-300"><span className="text-muted font-sans font-medium">D-U-N-S No.:</span> {settings.dunsNumber.trim()}</p>
                )}
              </div>
            </div>
          </div>

          <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted font-mono">
              <Building2 className="h-4 w-4" />
              <span>Bill To Client</span>
            </div>
            <div className="text-xs text-slate-300 space-y-1">
              <p className="font-bold text-white">{proforma.customerCompany}</p>
              <p className="text-muted">Attn: {proforma.customerName}</p>
              <p className="text-muted">{proforma.billingAddress || 'Commercial Billing Address on file'}</p>
              <p className="text-muted">{proforma.customerEmail} • {proforma.customerPhone}</p>
            </div>
          </div>

          <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted font-mono">
              <Truck className="h-4 w-4" />
              <span>Ship To / Dispatch Hub</span>
            </div>
            <div className="text-xs text-slate-300 space-y-1">
              <p className="font-bold text-white">{proforma.customerCompany}</p>
              <p className="text-muted">{proforma.shippingAddress || 'Consignee Delivery Address on file'}</p>
              <div className="pt-1">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[10px] font-mono">
                  📦 Allocated from Regional Depot
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quotation Line Items Table */}
        <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-lg space-y-4">
          <div className="px-6 pt-5 pb-2 flex items-center justify-between border-b border-slate-800/80">
            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-slate-200">
              <Package className="h-4 w-4 text-brand-400" />
              <span>Allocated Equipment & Optical Hardware</span>
            </div>
            <span className="text-xs text-muted font-mono">{(proforma.items || []).length} line items</span>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50 text-muted text-[11px] font-semibold uppercase tracking-wider font-mono">
                  <th className="py-3 px-4">Item & Description</th>
                  <th className="py-3 px-4">Brand</th>
                  <th className="py-3 px-4 text-center">Qty</th>
                  <th className="py-3 px-4 text-right">Unit Price</th>
                  <th className="py-3 px-4 text-right">Discount</th>
                  <th className="py-3 px-4 text-right">Tax Rate</th>
                  <th className="py-3 px-4 text-right">Line Total (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {(proforma.items || []).map((item, index) => (
                  <tr key={item.id || index} className="hover:bg-slate-900/40 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-100">{item.productName}</div>
                      <div className="text-[11px] font-mono text-muted flex items-center gap-2 mt-0.5">
                        <span>SKU: {item.productSku}</span>
                        {item.trackSerial && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[9px]">
                            Serial Tracked
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-300">{item.brand}</td>
                    <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-200">{item.quantity}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-300">{formatUSD(item.unitPrice)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-muted">
                      {item.discountPercent > 0 ? `${item.discountPercent}%` : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-muted">{item.taxRate}%</td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-white">{formatUSD(item.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden divide-y divide-slate-800/60">
            {(proforma.items || []).map((item, index) => (
              <div key={item.id || index} className="p-4 space-y-2 text-xs">
                <div className="font-bold text-slate-100">{item.productName}</div>
                <div className="text-[11px] font-mono text-muted flex items-center gap-2 flex-wrap">
                  <span>SKU: {item.productSku}</span>
                  <span>· {item.brand}</span>
                  {item.trackSerial && (
                    <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[9px]">
                      Serial Tracked
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/60 font-mono">
                  <span className="text-muted">
                    Qty <span className="font-bold text-slate-200">{item.quantity}</span> × {formatUSD(item.unitPrice)}
                    {item.discountPercent > 0 && <span> (-{item.discountPercent}%)</span>}
                  </span>
                  <span className="font-bold text-white">{formatUSD(item.totalPrice)}</span>
                </div>
                <div className="text-[11px] text-muted font-mono">Tax Rate: {item.taxRate}%</div>
              </div>
            ))}
          </div>

          {/* Totals Calculation Ribbon */}
          <div className="p-6 border-t border-slate-800 bg-slate-900/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="text-xs text-muted max-w-sm space-y-1">
              <p className="font-semibold text-slate-300">Commercial Notes & Specifications:</p>
              <p className="text-[11px] leading-relaxed text-muted">
                {proforma.notes || 'All equipment brand new factory sealed with manufacturer wholesale warranty. Prices quoted in USD ($).'}
              </p>
            </div>

            <div className="w-full sm:w-80 space-y-2 text-xs font-mono">
              <div className="flex justify-between text-muted">
                <span>Equipment Subtotal:</span>
                <span className="text-slate-200 font-semibold">{formatUSD(proforma.subtotal)}</span>
              </div>
              {proforma.discountAmount > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Volume Discount ({proforma.discountPercent}%):</span>
                  <span>-{formatUSD(proforma.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-muted">
                <span>Estimated Tax / VAT:</span>
                <span className="text-slate-200">{formatUSD(proforma.taxAmount)}</span>
              </div>
              {proforma.shippingCost > 0 && (
                <div className="flex justify-between text-muted">
                  <span>Insured Express Freight:</span>
                  <span className="text-slate-200">{formatUSD(proforma.shippingCost)}</span>
                </div>
              )}
              <div className="flex justify-between pt-3 border-t border-slate-700 text-sm font-bold text-white">
                <span className="font-sans">Grand Total:</span>
                <span className="text-brand-400 text-lg">{formatUSD(proforma.grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Banking: the active bank accounts of this quotation (frozen when it was sent/confirmed). Nothing is typed in here. */}
        {bankAccounts.length > 0 && (
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900/80 to-slate-950 space-y-4 shadow-lg" data-testid="quote-bank">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400 font-mono">
                <CreditCard className="h-4 w-4" />
                <span>Bank Details</span>
              </div>
            </div>
            {bankAccounts.map((a: any) => {
              const tag = bankAccounts.length > 1 && a.currency ? ` (${a.currency})` : '';
              const rows: [string, string, string][] = ([
                ['Bank Name' + tag, [a.bankName, a.branch].filter(Boolean).join(', '), 'bank'], ['Beneficiary Name', a.accountName, 'beneficiary'], ['Account Number', a.accountNumber, 'accNum'],
                ['SWIFT / BIC Code', a.swiftBic, 'swift'], ['IBAN', a.iban, 'iban'], ['Routing Code', a.routingCode, 'routing'], ['Bank Address', a.bankAddress, 'addr'], ['Payment Instructions', a.paymentInstructions, 'instr'],
              ] as [string, string, string][]).filter(([, v]) => v);
              return (
                <div key={a.id} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs font-mono">
                  {rows.map(([label, value, key]) => (
                    <div key={key} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] text-muted font-sans">{label}</div>
                        <div className="font-bold text-slate-200 mt-0.5 break-all whitespace-pre-line">{value}</div>
                      </div>
                      <button onClick={() => handleCopy(value, `${a.id}-${key}`)} className="p-1.5 rounded-lg hover:bg-slate-800 text-muted hover:text-white transition-colors shrink-0" title="Copy" aria-label={`Copy ${label}`}>
                        {copiedField === `${a.id}-${key}` ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer Support & Legal */}
        <footer className="pt-8 pb-12 text-center text-xs text-muted space-y-4 border-t border-slate-800/80">
          {/* Official Seal Badge when Confirmed / Security Header when Preliminary */}
          {proforma.status === 'CONFIRMED' || proforma.status === 'CONVERTED' ? (
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="relative p-2 rounded-2xl bg-white/5 border border-slate-800 inline-flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/arib-seal.png"
                  alt="ARIB GLOBAL Official Company Seal"
                  className="h-16 w-16 object-contain shrink-0 drop-shadow"
                  style={{ aspectRatio: '1 / 1' }}
                />
              </div>
              <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
                Officially Authenticated Proforma Invoice
              </div>
              <div className="text-[10px] text-muted font-mono">
                ARIB GLOBAL GENERAL TRADING L.L.C • DUBAI - U.A.E.
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-1.5">
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                {proforma.status === 'CANCELLED' ? 'Quotation Cancelled / Expired' : 'Official Proforma Quotation Portal'}
              </div>
              <div className="text-[10px] text-muted font-mono">
                ARIB GLOBAL GENERAL TRADING L.L.C • DUBAI - U.A.E.
              </div>
            </div>
          )}

          <p className="font-medium text-muted">
            {settings?.tradingName || settings?.companyName || 'ARIB GLOBAL Wholesale Distribution LLC'}
          </p>
          {(settings?.vatGstNumber || settings?.taxRegistrationNumber || settings?.corporateTaxNumber || settings?.tradeLicenceNumber || settings?.dunsNumber) ? (
            <p className="font-mono text-[11px] text-slate-400 space-x-2">
              {(settings?.vatGstNumber || settings?.taxRegistrationNumber) && (
                <span>VAT/TRN: {settings.vatGstNumber || settings.taxRegistrationNumber}</span>
              )}
              {settings?.corporateTaxNumber && settings.corporateTaxNumber.trim() !== '' && (
                <span>• Corp Tax: {settings.corporateTaxNumber.trim()}</span>
              )}
              {settings?.tradeLicenceNumber && settings.tradeLicenceNumber.trim() !== '' && (
                <span>• Licence: {settings.tradeLicenceNumber.trim()}</span>
              )}
              {settings?.dunsNumber && settings.dunsNumber.trim() !== '' && (
                <span>• DUNS: {settings.dunsNumber.trim()}</span>
              )}
            </p>
          ) : null}
          <p className="text-[11px] text-slate-500">
            This digital proforma invoice portal is protected with 256-bit encryption. For questions or modifications, please reply to your email quotation.
          </p>
        </footer>
      </main>

      {/* Accept Deal Confirmation Modal */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="relative w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl p-6 sm:p-8 space-y-5">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
              <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Accept & Confirm Quotation</h3>
                <p className="text-xs text-muted">{proforma.proformaNumber} for {formatUSD(proforma.grandTotal)}</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <p className="leading-relaxed text-slate-300">
                By confirming this quotation, you authorize <strong>{settings?.tradingName || 'ARIB GLOBAL'}</strong> to allocate the specified optical inventory from regional warehouses for your order.
              </p>

              <div>
                <label className="block text-muted mb-1 font-medium">
                  Add PO Number or Order Notes (Optional):
                </label>
                <textarea
                  rows={3}
                  value={confirmNotes}
                  onChange={(e) => setConfirmNotes(e.target.value)}
                  placeholder="e.g. Approved by Procurement Director, PO #PO-94021..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none"
                />
              </div>

              {errorMessage && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setIsConfirmModalOpen(false)}
                className="px-4 py-2.5 min-h-11 sm:min-h-0 rounded-xl text-xs text-muted hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCustomerAccept}
                disabled={isConfirming}
                className="flex items-center gap-2 px-6 py-2.5 min-h-11 sm:min-h-0 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-glow-emerald transition-all transform active:scale-95 disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                <span>{isConfirming ? 'Confirming...' : 'Yes, Confirm Deal'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Document Print Modal */}
      {isPrintModalOpen && (
        <PrintableDocumentModal
          documentType="PROFORMA"
          data={proforma}
          isOpen={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
        />
      )}
    </div>
  );
}
