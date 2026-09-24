'use client';

import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Printer,
  Download,
  X,
  CheckCircle2,
  Stamp,
} from 'lucide-react';
import { Proforma, TaxInvoice, CompanySettings } from '@/types/erp';
import { formatUSD, formatDocDate, numberToWordsUSD } from '@/lib/utils';
import dataStore from '@/lib/data-store';
import { evaluateSealPolicy } from '@/lib/seal-policy';

export interface PrintableDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentType: 'PROFORMA' | 'TAX_INVOICE' | 'PACKING_LIST' | 'SERVICE_INVOICE';
  data: Proforma | TaxInvoice | any;
}

export default function PrintableDocumentModal({
  isOpen,
  onClose,
  documentType,
  data,
}: PrintableDocumentModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const settings: CompanySettings = dataStore.getCompanySettings();

  useEffect(() => {
    setMounted(true);
  }, []);

  const policy = evaluateSealPolicy({
    documentType,
    status: data?.status,
    fulfilmentStatus: data?.fulfilmentStatus,
    paymentStatus: data?.paymentStatus,
  });

  const [overrideSeal, setOverrideSeal] = useState<boolean | null>(null);
  const shouldShowSeal = overrideSeal !== null ? overrideSeal : policy.shouldSeal;

  // Manage print class on document.body for clean isolation
  useEffect(() => {
    if (!isOpen) return;

    const onBeforePrint = () => {
      document.body.classList.add('is-printing-document');
    };
    const onAfterPrint = () => {
      document.body.classList.remove('is-printing-document');
    };

    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);

    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
      document.body.classList.remove('is-printing-document');
    };
  }, [isOpen]);

  if (!isOpen || !data || !mounted) return null;

  const isTaxInvoice = documentType === 'TAX_INVOICE';
  const isProforma = documentType === 'PROFORMA';
  const isPackingList = documentType === 'PACKING_LIST';
  const isServiceInvoice = documentType === 'SERVICE_INVOICE';

  const docTitle = isTaxInvoice
    ? `TAX INVOICE #${data.invoiceNumber || data.id}`
    : isProforma
    ? `PROFORMA INVOICE #${data.proformaNumber || data.id}`
    : isServiceInvoice
    ? `SERVICE INVOICE #${data.invoiceNumber || data.id}`
    : `PACKING SLIP #${data.invoiceNumber || data.id}`;

  const docNumber = isTaxInvoice
    ? data.invoiceNumber || 'INV-200444'
    : isProforma
    ? data.proformaNumber || 'PF-2026-00001'
    : isServiceInvoice
    ? data.invoiceNumber || 'SRV-200444'
    : data.invoiceNumber || 'SLIP-200444';

  const totalQuantity = (data.items || []).reduce(
    (sum: number, item: any) => sum + (Number(item.quantity) || 0),
    0
  );

  const grandTotal = Number(data.grandTotal || data.subtotal || 0);

  const handlePrint = () => {
    document.body.classList.add('is-printing-document');
    window.print();
  };

  // Derive Incoterms & Shipment mode
  const shipmentMode =
    data.shipmentMode ||
    (data.deliveryTerms?.toLowerCase().includes('air')
      ? 'AIR'
      : data.deliveryTerms?.toLowerCase().includes('sea')
      ? 'SEA'
      : 'AIR');

  const incoterms =
    data.incoterms ||
    (data.deliveryTerms?.includes('(')
      ? data.deliveryTerms.match(/\((.*?)\)/)?.[1]
      : data.deliveryTerms) ||
    'C&F Vietnam';

  const estShipDate =
    data.expiryDate ||
    data.dueDate ||
    (data.issueDate ? new Date(new Date(data.issueDate).getTime() + 6 * 86400000).toISOString() : '2026-08-25');

  const modalContent = (
    <div id="printable-modal-portal">
      {/* Backdrop overlay (stripped in print mode) */}
      <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 bg-slate-900/50 backdrop-blur-sm overflow-y-auto animate-fade-in no-print-backdrop">
        <div className="modal-card relative w-full max-w-4xl rounded-2xl border border-line bg-white shadow-2xl overflow-hidden my-auto print:border-none print:shadow-none print:rounded-none">
          {/* Action Header bar (hidden during print) */}
          <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 sm:px-6 py-3.5 border-b border-line bg-surface">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold uppercase tracking-wider text-primary font-mono shrink-0">
                Document Preview
              </span>
              <span className="text-xs text-muted truncate">• {docTitle}</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setOverrideSeal((prev) => (prev !== null ? !prev : !policy.shouldSeal))}
                className={`flex items-center gap-1.5 min-h-11 sm:min-h-0 rounded-full px-2.5 py-1.5 text-xs font-semibold border transition-colors ${
                  shouldShowSeal
                    ? 'bg-success-soft border-success-border text-success hover:bg-success-soft/70'
                    : 'bg-surface-muted border-line text-muted hover:text-ink'
                }`}
                title={`${policy.reason} (Click to toggle company seal on/off)`}
              >
                <Stamp className="h-3.5 w-3.5" />
                <span>Seal: {shouldShowSeal ? 'Included' : 'Omitted'}</span>
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 min-h-11 sm:min-h-0 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover transition-colors shadow-sm"
              >
                <Printer className="h-4 w-4" />
                <span>Print / Save as PDF</span>
              </button>
              <button
                onClick={onClose}
                className="flex items-center justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded-full p-1.5 text-muted hover:text-ink hover:bg-surface-muted transition-colors"
                aria-label="Close Preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Printable Document Body Container */}
          <div className="modal-body-container max-h-[85vh] overflow-y-auto p-4 sm:p-8 bg-surface print:bg-white print:p-0 print:m-0 print:max-h-none print:overflow-visible">
            <div
              ref={printRef}
              className="print-page mx-auto bg-white text-black p-8 sm:p-12 rounded-xl shadow-lg max-w-3xl text-xs font-sans leading-normal border border-line print:min-h-0 print:border-none print:shadow-none print:p-0 print:m-0 print:max-w-none print:w-full"
            >
              {/* Document Watermark / State Notice */}
              {policy.isDraft && (
                <div className="bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-bold px-3 py-1.5 rounded mb-4 text-center uppercase tracking-wider print:border-amber-400">
                  {isProforma
                    ? 'PRELIMINARY DRAFT QUOTATION — FOR REVIEW ONLY (NOT AN OFFICIAL TAX INVOICE)'
                    : isServiceInvoice
                    ? 'PRELIMINARY SERVICE INVOICE — FOR REVIEW ONLY'
                    : 'PRELIMINARY DRAFT — FOR REVIEW ONLY'}
                </div>
              )}
              {policy.isCancelled && (
                <div className="bg-rose-50 border border-rose-300 text-rose-900 text-[11px] font-bold px-3 py-1.5 rounded mb-4 text-center uppercase tracking-wider print:border-rose-400">
                  CANCELLED TRANSACTION — VOID &amp; UNOFFICIAL
                </div>
              )}

              {/* Header: Company Logo, Name & Contact (Left) vs Document Info (Right) */}
              <div className="flex justify-between items-start mb-6">
                {/* Top Left: Logo & Contact */}
                <div className="flex flex-col items-start gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/pdflogo.png"
                    alt="ARIB GLOBAL"
                    className="h-14 w-auto object-contain shrink-0 max-h-16"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <div className="text-xs text-black mt-1 font-medium">
                    Contact: {settings.phone || '+971 4 800 0100'}
                  </div>
                </div>

                {/* Top Right: Document Meta */}
                <div className="text-right">
                  <div className="text-[10px] font-medium text-black mb-1">1 of 1</div>
                  <div className="grid grid-cols-[125px_1fr] gap-x-2 gap-y-0.5 text-xs text-black text-left">
                    <span className="font-bold">
                      {isTaxInvoice
                        ? 'Invoice No.:'
                        : isProforma
                        ? 'Proforma No.:'
                        : isServiceInvoice
                        ? 'Service Inv No.:'
                        : 'Slip No.:'}
                    </span>
                    <span className="font-medium font-mono">{docNumber}</span>

                    <span className="font-bold">Date:</span>
                    <span>{formatDocDate(data.issueDate || data.createdAt)}</span>

                    {!isServiceInvoice && (
                      <>
                        <span className="font-bold">Shipment Mode:</span>
                        <span>{shipmentMode}</span>
                      </>
                    )}

                    <span className="font-bold">Payment Terms:</span>
                    <span>{data.paymentTerms || 'Cash In Advance'}</span>

                    {!isServiceInvoice && (
                      <>
                        <span className="font-bold">Incoterms:</span>
                        <span>{incoterms}</span>

                        <span className="font-bold">Est. Ship. Date:</span>
                        <span>{formatDocDate(estShipDate)}</span>
                      </>
                    )}

                    {isServiceInvoice && data.dueDate && (
                      <>
                        <span className="font-bold">Payment Due:</span>
                        <span className="text-red-700 font-semibold">{formatDocDate(data.dueDate)}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Customer & Consignee Section */}
              <div className="space-y-4 mb-6 text-xs text-black">
                {/* Customer */}
                <div className="grid grid-cols-[95px_1fr] gap-x-2 items-start">
                  <span className="font-bold text-black">Customer:</span>
                  <div className="space-y-0.5">
                    <div className="font-bold uppercase text-black">
                      {data.customerCompany || data.customerName || 'ABC COMPANY'}
                    </div>
                    <div className="text-black uppercase whitespace-pre-line leading-tight">
                      {data.billingAddress || data.shippingAddress || 'UNIT C & D, 63/F, ALEXANDER IND AREA\n35-45 XY STREET, HAWAI, VIETNAM'}
                    </div>
                  </div>
                </div>

                {/* Consignee (only if not a pure service invoice) */}
                {!isServiceInvoice && (
                  <div className="grid grid-cols-[95px_1fr] gap-x-2 items-start">
                    <span className="font-bold text-black">Consignee:</span>
                    <div className="space-y-0.5">
                      <div className="font-bold uppercase text-black">
                        {data.customerCompany || data.customerName || 'ABC COMPANY'}
                      </div>
                      <div className="text-black uppercase whitespace-pre-line leading-tight">
                        {data.shippingAddress || data.billingAddress || 'UNIT C & D, 63/F, ALEXANDER IND AREA\n35-45 XY STREET, HAWAI, VIETNAM'}
                      </div>
                      <div className="text-black pt-0.5 font-normal">
                        Tel: {data.customerPhone || '+84 1234 5678, 4567 8910'}
                        {data.customerEmail && <span className="ml-4">Email: {data.customerEmail}</span>}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Main Items Table with Continuous Black Grid Borders */}
              <div className="mb-3 overflow-x-auto">
                <table className="w-full min-w-[480px] text-left border-collapse border border-black text-xs text-black">
                  <thead>
                    <tr className="bg-surface-muted border-b border-black text-[11px] font-bold text-black">
                      <th className="py-1.5 px-2 border-r border-black text-center w-[7%]">Sl. No.</th>
                      <th className="py-1.5 px-2 border-r border-black text-center w-[16%]">
                        {isServiceInvoice ? 'Service Code' : 'Item Code'}
                      </th>
                      <th className="py-1.5 px-3 border-r border-black text-left w-[43%]">
                        {isServiceInvoice ? 'Service Description' : 'Product Description'}
                      </th>
                      <th className="py-1.5 px-2 border-r border-black text-center w-[8%]">Qty</th>
                      <th className="py-1.5 px-2 border-r border-black text-right w-[13%]">Rate US$</th>
                      <th className="py-1.5 px-2 text-right w-[13%]">Amount US$</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.items || []).map((item: any, idx: number) => {
                      const itemCode = item.productSku || item.category || item.barcode || (isServiceInvoice ? 'SRV' : 'ITEM-CODE');
                      const itemName = item.productName || item.description || 'Description';
                      const itemQty = Number(item.quantity) || 1;
                      const itemRate = Number(item.unitPrice) || 0;
                      const itemTotal = Number(item.totalPrice) || (itemQty * itemRate);

                      return (
                        <tr key={idx} className="align-top">
                          <td className="py-1.5 px-2 border-r border-black text-center font-normal">
                            {idx + 1}
                          </td>
                          <td className="py-1.5 px-2 border-r border-black text-center font-mono font-medium">
                            {itemCode}
                          </td>
                          <td className="py-1.5 px-3 border-r border-black text-left">
                            <div className="font-semibold text-black uppercase">
                              {itemName}
                            </div>
                            {item.category && item.productName && (
                              <div className="text-[10px] text-muted font-mono">{item.category}</div>
                            )}
                            {/* Serial numbers badge if allocated or packing list */}
                            {item.allocatedSerials && item.allocatedSerials.length > 0 && (
                              <div className="text-[10px] text-ink-secondary font-mono mt-0.5 font-normal">
                                S/N: {item.allocatedSerials.join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="py-1.5 px-2 border-r border-black text-center font-medium">
                            {itemQty}
                          </td>
                          <td className="py-1.5 px-2 border-r border-black text-right font-medium">
                            {formatUSD(itemRate)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-medium">
                            {formatUSD(itemTotal)}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Spacer Rows to maintain proper document height with continuous vertical divider lines */}
                    {(!data.items || data.items.length < 5) && (
                      <tr style={{ height: '120px' }} className="align-top">
                        <td className="border-r border-black"></td>
                        <td className="border-r border-black"></td>
                        <td className="border-r border-black"></td>
                        <td className="border-r border-black"></td>
                        <td className="border-r border-black"></td>
                        <td></td>
                      </tr>
                    )}

                    {/* Embedded Banking Details in bottom area of table */}
                    <tr className="border-t border-black avoid-break">
                      <td
                        colSpan={3}
                        className="border-r border-black p-3 align-bottom text-[10px] leading-relaxed"
                      >
                        <div className="font-bold text-black mb-0.5">Payments to be made to:</div>
                        <div className="text-black font-medium">{settings.bankDetails?.accountName || settings.accountName || settings.companyName || 'Arib Global General Trading LLC'}</div>
                        <div className="text-black">Bank: {settings.bankDetails?.bankName || settings.bankName || 'Commercial Bank of Dubai, Sheikh Zayed Road Branch, Dubai, U.A.E.'}</div>
                        <div className="font-bold text-black">
                          USD IBAN A/c #: {settings.bankDetails?.iban || settings.iban || 'AE91 0230 0000 0100 2416 343'}
                        </div>
                        <div className="font-bold text-black">
                          SWIFT: {settings.bankDetails?.swiftBic || settings.swiftBic || 'CBOUAEADXXX'}
                        </div>
                      </td>
                      <td className="border-r border-black p-2 align-bottom"></td>
                      <td className="border-r border-black p-2 align-bottom"></td>
                      <td className="p-2 align-bottom"></td>
                    </tr>
                  </tbody>

                  {/* Table Footer Totals */}
                  <tfoot>
                    <tr className="border-t border-black font-bold text-xs bg-white">
                      <td colSpan={2} className="border-r border-black py-1.5 px-2"></td>
                      <td className="border-r border-black py-1.5 px-3 text-right font-bold">
                        Total Qty:
                      </td>
                      <td className="border-r border-black py-1.5 px-2 text-center font-bold">
                        {totalQuantity}
                      </td>
                      <td className="border-r border-black py-1.5 px-2 text-right font-bold">
                        Total US$
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold text-black font-mono">
                        {formatUSD(grandTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Post-Table Section: Amount in Words */}
              <div className="text-xs font-bold text-black mb-3 avoid-break">
                Amount in Words:{' '}
                <span className="font-normal ml-1">
                  {numberToWordsUSD(grandTotal)}
                </span>
              </div>

              {/* Terms / Details Rectangle Box */}
              <div className="border border-black p-2.5 my-3 text-xs text-black max-w-xl space-y-1 avoid-break">
                {!isServiceInvoice && (
                  <div className="grid grid-cols-[85px_1fr] gap-2">
                    <span className="font-bold">Delivery:</span>
                    <span>{data.deliveryTerms || 'C&F Vietnam Airport'}</span>
                  </div>
                )}
                <div className="grid grid-cols-[85px_1fr] gap-2">
                  <span className="font-bold">{isServiceInvoice ? 'Payment Due:' : 'Valid Till:'}</span>
                  <span>{formatDocDate(data.expiryDate || data.dueDate || '2026-08-30')}</span>
                </div>
                {!isServiceInvoice && (
                  <div className="grid grid-cols-[85px_1fr] gap-2">
                    <span className="font-bold">Warranty:</span>
                    <span>{data.warrantyTerms || 'N/A'}</span>
                  </div>
                )}
              </div>

              {/* Remarks Section */}
              {data.notes && (
                <div className="mt-4 text-xs text-black avoid-break">
                  <span className="font-bold">Remarks:</span>
                  <span className="ml-2 font-normal">{data.notes}</span>
                </div>
              )}

              {/* Payments To Be Made To Reminder or Warehouse Verification Notice */}
              {isPackingList ? (
                <div className="text-xs text-black mt-4 mb-4 p-3 bg-surface border border-line rounded-lg avoid-break">
                  <div className="font-bold uppercase tracking-wide text-ink mb-1">Warehouse Dispatch Notice</div>
                  <div className="text-ink-secondary">All serial numbers, package counts, and tamper-evident carton seals must be physically inspected before vehicle departure. Report discrepancies to logistics dispatch immediately.</div>
                </div>
              ) : (
                <div className="text-xs text-black mt-4 mb-4 avoid-break">
                  <div className="font-bold">Payments to be made to:</div>
                  <div className="font-semibold uppercase">{settings.companyName || 'ARIB GLOBAL GENERAL TRADING LLC'}</div>
                  <div>Contact: {settings.phone || '+971 4 800 0100'}</div>
                </div>
              )}

              {/* Sign-off, Official Company Seal & Warehouse Verification */}
              {isPackingList ? (
                <div className="flex justify-between items-end text-xs text-black pt-4 border-t border-line mt-4 avoid-break">
                  <div className="space-y-1">
                    <div className="font-bold uppercase tracking-wide text-ink">
                      Warehouse Verification &amp; Dispatch
                    </div>
                    <div className="text-[11px] text-ink-secondary">Origin Depot: {data.depot?.name || 'Central Logistics Hub, Dubai'}</div>
                    <div className="text-[10px] text-muted font-mono">
                      Package Count: {data.packingDetails?.packageCount || 1} Box(es) • Weight: {data.packingDetails?.totalWeightKg || '—'} KG
                    </div>
                    <div className="text-[9px] text-muted italic pt-1 font-sans">
                      <div>THIS IS AN OPERATIONAL WAREHOUSE PACKING SHEET</div>
                      <div>VERIFIED AGAINST PHYSICAL INVENTORY AT DISPATCH DOCK</div>
                    </div>
                  </div>

                  {/* Warehouse Dual Signatures */}
                  <div className="flex gap-6 text-center shrink-0">
                    <div className="w-32">
                      <div className="h-12 border-b border-line border-dashed mb-1 flex items-end justify-center pb-1">
                        <span className="text-[11px] font-mono text-ink">{data.packingDetails?.packedBy || 'Depot Inspector'}</span>
                      </div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-ink">
                        Packed &amp; Checked
                      </div>
                      <div className="text-[9px] text-muted uppercase tracking-widest font-mono">
                        Warehouse Staff
                      </div>
                    </div>
                    <div className="w-32">
                      <div className="h-12 border-b border-line border-dashed mb-1 flex items-end justify-center pb-1">
                        <span className="text-[10px] text-muted italic">Sign &amp; Date</span>
                      </div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-ink">
                        Consignee Receipt
                      </div>
                      <div className="text-[9px] text-muted uppercase tracking-widest font-mono">
                        Courier / Customer
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-end text-xs text-black pt-4 border-t border-line mt-4 avoid-break">
                  <div className="space-y-1">
                    <div className="font-bold uppercase tracking-wide text-ink">
                      For {settings.companyName || 'ARIB GLOBAL GENERAL TRADING L.L.C'}
                    </div>
                    <div className="text-[11px] text-ink-secondary">Contact: {settings.phone || '+971 4 800 0100'}</div>
                    <div className="text-[10px] text-muted font-mono">TRN: {settings.vatGstNumber || '100889218200001'}</div>
                    <div className="text-[9px] italic text-ink-secondary pt-2 font-sans tracking-wide">
                      <div>THIS IS A COMPUTER GENERATED DOCUMENT</div>
                      {shouldShowSeal ? (
                        <div className="text-primary font-semibold">DIGITALLY AUTHENTICATED WITH OFFICIAL COMPANY SEAL</div>
                      ) : (
                        <div>SUBJECT TO FINAL TERMS &amp; AUTHORIZED APPROVAL</div>
                      )}
                    </div>
                  </div>

                  {/* Official Seal OR Unsigned Signatory Placeholder */}
                  <div className="flex flex-col items-center justify-end text-center shrink-0">
                    {shouldShowSeal ? (
                      <>
                        <div className="relative flex items-center justify-center p-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={settings.sealUrl || '/arib-seal.png'}
                            alt="ARIB GLOBAL Official Company Seal"
                            className="h-28 w-28 object-contain shrink-0 select-none print:h-28 print:w-28"
                            style={{ aspectRatio: '1 / 1' }}
                          />
                        </div>
                        <div className="border-t border-line pt-1 w-36 text-center">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-ink">
                            Official Company Seal
                          </div>
                          <div className="text-[9px] text-muted uppercase tracking-widest font-mono">
                            Authorized Signatory
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="w-36">
                        <div className="h-16 border-b border-line border-dashed mb-1 flex items-end justify-center pb-1">
                          <span className="text-[10px] text-muted italic">Signature</span>
                        </div>
                        <div className="border-t border-line pt-1 text-center">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-ink">
                            Authorized Signatory
                          </div>
                          <div className="text-[9px] text-muted uppercase tracking-widest font-mono">
                            {policy.isDraft ? 'Preliminary / Unsealed' : 'Pending Stamp'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
