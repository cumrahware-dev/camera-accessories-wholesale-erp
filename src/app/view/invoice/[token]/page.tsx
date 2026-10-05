'use client';

/**
 * Customer-facing Tax Invoice portal (no login; the link carries a signed token).
 * Same look as the proforma quotation portal (/quote/[id]), read-only.
 */
import React, { useEffect, useState } from 'react';
import { incotermLine } from '@/lib/documents/terms';
import { useParams } from 'next/navigation';
import { AlertCircle, Building2, Check, Copy, CreditCard, Download, FileCheck2, Package, ShieldCheck, Truck, ExternalLink } from 'lucide-react';
import { formatUSD, formatDate, getStatusBadgeClasses } from '@/lib/utils';

interface PortalData {
  invoice: any;
  company: Record<string, any>;
}

const PAYMENT_LABEL: Record<string, string> = { UNPAID: 'Payment Due', PARTIALLY_PAID: 'Partially Paid', PAID: 'Paid' };

export default function InvoicePortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/invoices/${token}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [token]);

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 space-y-4">
        <div className="h-10 w-10 border-3 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-muted text-sm font-medium tracking-wide">Loading Secure Tax Invoice...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="p-4 rounded-full bg-slate-900 border border-slate-800 text-rose-400"><AlertCircle className="h-8 w-8" /></div>
        <h1 className="text-xl font-bold text-white">Tax Invoice Not Found</h1>
        <p className="text-sm text-muted max-w-md">
          This invoice link is not valid or the invoice is no longer available. Please check the link in your email or contact your wholesale account manager.
        </p>
      </div>
    );
  }

  const { invoice: inv, company: co } = data;
  const cancelled = inv.documentStatus === 'CANCELLED' || inv.fulfilmentStatus === 'CANCELLED';
  const statusKey = cancelled ? 'CANCELLED' : inv.paymentStatus;
  const statusText = cancelled ? 'CANCELLED' : PAYMENT_LABEL[inv.paymentStatus] || inv.paymentStatus;
  const badge = getStatusBadgeClasses(statusKey === 'UNPAID' ? 'PENDING' : statusKey);
  const money = (n: number) => formatUSD(n);
  // Bank accounts come from the company profile of this invoice (active accounts only; frozen when it was issued).
  const accounts: any[] = Array.isArray(co.bankAccounts) ? co.bankAccounts : [];
  const bank: [string, string | undefined, string][] = accounts.flatMap((a) => {
    const tag = accounts.length > 1 && a.currency ? ` (${a.currency})` : '';
    return [
      [`Bank Name${tag}`, [a.bankName, a.branch].filter(Boolean).join(', '), `${a.id}-bank`], [`Beneficiary Name${tag}`, a.accountName, `${a.id}-beneficiary`], [`Account Number${tag}`, a.accountNumber, `${a.id}-acc`],
      [`SWIFT / BIC Code${tag}`, a.swiftBic, `${a.id}-swift`], [`IBAN${tag}`, a.iban, `${a.id}-iban`], [`Routing Code${tag}`, a.routingCode, `${a.id}-routing`],
      [`Payment instructions${tag}`, a.paymentInstructions, `${a.id}-instr`],
    ] as [string, string | undefined, string][];
  });
  const pdfHref = `/api/public/invoices/${token}/pdf`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-brand-500 selection:text-white">
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-brand-600 to-cyan-500 flex items-center justify-center shadow-glow">
              <FileCheck2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-brand-400">{co.name || 'ARIB GLOBAL'}</div>
              <div className="text-sm font-bold text-white flex flex-wrap items-center gap-2">
                <span>Tax Invoice {inv.invoiceNumber}</span>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                  {statusText}
                </span>
              </div>
            </div>
          </div>
          <a href={pdfHref}
            className="flex items-center gap-1.5 px-3.5 py-2 min-h-11 sm:min-h-0 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold shadow-sm transition-all">
            <Download className="h-4 w-4 text-muted" />
            <span>Download Official PDF</span>
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Hero */}
        <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs font-medium">
                <ShieldCheck className="h-3.5 w-3.5 text-brand-400" />
                <span>Verified Wholesale Tax Invoice</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{inv.customerCompany}</h1>
              <p className="text-xs sm:text-sm text-muted">
                Issued to: <strong className="text-slate-200">{inv.customerName}</strong>{inv.customerEmail ? ` (${inv.customerEmail})` : ''}
              </p>
            </div>
            <div className="flex flex-col items-start md:items-end justify-center p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800 text-right">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted font-mono">
                {inv.paymentStatus === 'PAID' ? 'Total Paid' : 'Total Amount Due'}
              </div>
              <div className="text-3xl sm:text-4xl font-extrabold text-brand-400 font-mono tracking-tight mt-1">{money(inv.grandTotal)}</div>
              <div className="text-[11px] text-muted mt-1">{inv.paymentStatus === 'PAID' ? 'Thank you for your payment' : `Due by ${formatDate(inv.dueDate)}`}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-6 mt-6 border-t border-slate-800/80 text-xs">
            <div className="space-y-1"><span className="text-muted">Invoice #</span><p className="font-mono font-bold text-slate-200">{inv.invoiceNumber}</p></div>
            <div className="space-y-1"><span className="text-muted">Issue Date</span><p className="font-mono font-medium text-slate-200">{formatDate(inv.issueDate)}</p></div>
            <div className="space-y-1"><span className="text-muted">Payment Terms</span><p className="font-medium text-slate-200">{inv.paymentTerms || 'Not specified'}</p></div>
            {inv.paymentMethod && <div className="space-y-1"><span className="text-muted">Payment Method</span><p className="font-medium text-slate-200">{inv.paymentMethod}</p></div>}
            {incotermLine(inv.incoterm, inv.incotermPlace) && <div className="space-y-1"><span className="text-muted">Incoterms</span><p className="font-medium text-slate-200">{incotermLine(inv.incoterm, inv.incotermPlace)}</p></div>}
            <div className="space-y-1"><span className="text-muted">Proforma Ref.</span><p className="font-mono font-medium text-slate-200">{inv.proformaNumber || '—'}</p></div>
          </div>
        </div>

        {/* Parties */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-400 font-mono"><Building2 className="h-4 w-4" /><span>Issuing Distributor</span></div>
            <div className="text-xs text-slate-300 space-y-1">
              <p className="font-bold text-white">{co.name}</p>
              {co.address && <p className="text-muted whitespace-pre-line">{co.address}</p>}
              {co.email && <p className="text-muted">Email: {co.email}</p>}
              {co.phone && <p className="text-muted">Phone: {co.phone}</p>}
              <div className="pt-2 border-t border-slate-800/80 space-y-0.5 text-[11px] font-mono">
                {co.vat && <p className="text-slate-300"><span className="text-muted font-sans font-medium">TRN:</span> {co.vat}</p>}
                {co.corporateTax?.trim() && <p className="text-slate-300"><span className="text-muted font-sans font-medium">Corporate Tax No.:</span> {co.corporateTax.trim()}</p>}
                {co.tradeLicence?.trim() && <p className="text-slate-300"><span className="text-muted font-sans font-medium">Trade Licence No.:</span> {co.tradeLicence.trim()}</p>}
              </div>
            </div>
          </div>
          <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted font-mono"><Building2 className="h-4 w-4" /><span>Bill To Client</span></div>
            <div className="text-xs text-slate-300 space-y-1">
              <p className="font-bold text-white">{inv.customerCompany}</p>
              <p className="text-muted">Attn: {inv.customerName}</p>
              <p className="text-muted">{inv.billingAddress}</p>
              <p className="text-muted">{[inv.customerEmail, inv.customerPhone].filter(Boolean).join(' • ')}</p>
            </div>
          </div>
          <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted font-mono"><Truck className="h-4 w-4" /><span>Ship To / Delivery</span></div>
            <div className="text-xs text-slate-300 space-y-1">
              <p className="font-bold text-white">{inv.customerCompany}</p>
              <p className="text-muted">{inv.shippingAddress}</p>
              {inv.shipment ? (
                <div className="pt-1 space-y-1">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[10px] font-mono">
                    📦 {String(inv.shipment.courier).replace(/_/g, ' ')} · AWB {inv.shipment.airwayBillNumber}
                  </span>
                  {inv.shipment.trackingUrl && (
                    <a href={inv.shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-brand-400 hover:text-brand-300 text-[11px] font-semibold">
                      Track shipment <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ) : (
                <div className="pt-1">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[10px] font-mono">
                    📦 {inv.fulfilmentStatus === 'DELIVERED' ? 'Delivered' : 'Being prepared for dispatch'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-lg space-y-4">
          <div className="px-6 pt-5 pb-2 flex items-center justify-between border-b border-slate-800/80">
            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-slate-200">
              <Package className="h-4 w-4 text-brand-400" /><span>Invoiced Equipment & Optical Hardware</span>
            </div>
            <span className="text-xs text-muted font-mono">{inv.items.length} line items</span>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50 text-muted text-[11px] font-semibold uppercase tracking-wider font-mono">
                  <th className="py-3 px-4">Item & Description</th><th className="py-3 px-4">Brand</th>
                  <th className="py-3 px-4 text-center">Qty</th><th className="py-3 px-4 text-right">Unit Price</th>
                  <th className="py-3 px-4 text-right">Tax Rate</th><th className="py-3 px-4 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {inv.items.map((it: any) => (
                  <tr key={it.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="py-3.5 px-4"><div className="font-bold text-slate-100">{it.productName}</div><div className="text-[11px] font-mono text-muted mt-0.5">SKU: {it.productSku}</div></td>
                    <td className="py-3.5 px-4 font-medium text-slate-300">{it.brand}</td>
                    <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-200">{it.quantity}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-300">{money(it.unitPrice)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-muted">{it.taxRate}%</td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-white">{money(it.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden divide-y divide-slate-800/60">
            {inv.items.map((it: any) => (
              <div key={it.id} className="p-4 space-y-2 text-xs">
                <div className="font-bold text-slate-100">{it.productName}</div>
                <div className="text-[11px] font-mono text-muted">SKU: {it.productSku} · {it.brand}</div>
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/60 font-mono">
                  <span className="text-muted">Qty <span className="font-bold text-slate-200">{it.quantity}</span> × {money(it.unitPrice)}</span>
                  <span className="font-bold text-white">{money(it.totalPrice)}</span>
                </div>
                <div className="text-[11px] text-muted font-mono">Tax Rate: {it.taxRate}%</div>
              </div>
            ))}
          </div>

          <div className="p-6 border-t border-slate-800 bg-slate-900/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="text-xs text-muted max-w-sm space-y-1">
              <p className="font-semibold text-slate-300">Notes:</p>
              <p className="text-[11px] leading-relaxed text-muted">{inv.notes || 'All equipment brand new factory sealed with manufacturer wholesale warranty.'}</p>
            </div>
            <div className="w-full sm:w-80 space-y-2 text-xs font-mono">
              <div className="flex justify-between text-muted"><span>Equipment Subtotal:</span><span className="text-slate-200 font-semibold">{money(inv.subtotal)}</span></div>
              {inv.discountAmount > 0 && <div className="flex justify-between text-emerald-400"><span>Discount:</span><span>-{money(inv.discountAmount)}</span></div>}
              <div className="flex justify-between text-muted"><span>Tax / VAT:</span><span className="text-slate-200">{money(inv.taxAmount)}</span></div>
              {inv.shippingCost > 0 && <div className="flex justify-between text-muted"><span>Freight:</span><span className="text-slate-200">{money(inv.shippingCost)}</span></div>}
              {inv.otherCharges > 0 && <div className="flex justify-between text-muted"><span>Other charges:</span><span className="text-slate-200">{money(inv.otherCharges)}</span></div>}
              <div className="flex justify-between pt-3 border-t border-slate-700 text-sm font-bold text-white">
                <span className="font-sans">Grand Total:</span><span className="text-brand-400 text-lg">{money(inv.grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bank details */}
        {inv.paymentStatus !== 'PAID' && !cancelled && bank.some(([, v]) => v) && (
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900/80 to-slate-950 space-y-4 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400 font-mono"><CreditCard className="h-4 w-4" /><span>Payment & Banking Instructions</span></div>
              <span className="text-[11px] text-muted">Please quote {inv.invoiceNumber}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs font-mono">
              {bank.filter(([, v]) => v).map(([label, value, key]) => (
                <div key={key} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0"><div className="text-[10px] text-muted font-sans">{label}</div><div className="font-bold text-slate-200 mt-0.5 break-all">{value}</div></div>
                  <button onClick={() => copy(value!, key)} className="p-1.5 rounded-lg hover:bg-slate-800 text-muted hover:text-white transition-colors shrink-0" title="Copy" aria-label={`Copy ${label}`}>
                    {copied === key ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <footer className="pt-8 pb-12 text-center text-xs text-muted space-y-3 border-t border-slate-800/80">
          <div className="flex flex-col items-center justify-center gap-2">
            {!cancelled ? (
              <div className="relative p-2 rounded-2xl bg-white/5 border border-slate-800 inline-flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/arib-seal.png" alt="Official company seal" className="h-16 w-16 object-contain shrink-0 drop-shadow" style={{ aspectRatio: '1 / 1' }} />
              </div>
            ) : null}
            <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">{cancelled ? 'Invoice Cancelled' : 'Officially Authenticated Tax Invoice'}</div>
            <div className="text-[10px] text-muted font-mono">ARIB GLOBAL GENERAL TRADING L.L.C • DUBAI - U.A.E.</div>
          </div>
          {co.vat && <p className="font-mono text-[11px] text-slate-400">TRN: {co.vat}</p>}
          <p className="text-[11px] text-slate-500">This secure link is private to you. For questions about this invoice, please reply to the email it came with.</p>
        </footer>
      </main>
    </div>
  );
}
