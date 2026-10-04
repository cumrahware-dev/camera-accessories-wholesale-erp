/**
 * Server-side PDF for customer documents (Proforma / Tax Invoice / Service Invoice).
 * The same function produces the email attachment and the "Download PDF" file, so what the customer
 * receives is exactly what staff download. Built with jsPDF (already a dependency), no browser needed.
 */
import 'server-only';
import { readFile } from 'fs/promises';
import path from 'path';
import { jsPDF } from 'jspdf';
import autoTableImport from 'jspdf-autotable';
import { prisma } from '@/lib/prisma';

export type DocType = 'PROFORMA' | 'TAX_INVOICE' | 'SERVICE_INVOICE';

const autoTable: any = (autoTableImport as any).default ?? autoTableImport;
const BRAND: [number, number, number] = [0, 94, 130];
const INK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [107, 114, 128];

const TITLES: Record<DocType, string> = { PROFORMA: 'PROFORMA INVOICE', TAX_INVOICE: 'TAX INVOICE', SERVICE_INVOICE: 'SERVICE INVOICE' };
const FILE_LABEL: Record<DocType, string> = { PROFORMA: 'Proforma', TAX_INVOICE: 'Tax_Invoice', SERVICE_INVOICE: 'Service_Invoice' };

export function documentNumberOf(type: DocType, doc: any): string {
  return String(type === 'PROFORMA' ? doc.proformaNumber : doc.invoiceNumber);
}

/** e.g. ARIB_GLOBAL_Tax_Invoice_INV-2026-00012.pdf */
export function pdfFileName(type: DocType, doc: any, companyName = 'ARIB GLOBAL'): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9\-_.]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return `${safe(companyName) || 'ARIB_GLOBAL'}_${FILE_LABEL[type]}_${safe(documentNumberOf(type, doc))}.pdf`;
}

const money = (n: unknown, currency: string) =>
  `${currency} ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d: unknown) => {
  const v = d ? new Date(d as any) : null;
  return v && !isNaN(v.getTime()) ? v.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
};

let logoCache: string | null | undefined;
async function logo(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    const buf = await readFile(path.join(process.cwd(), 'public', 'pdflogo.png'));
    logoCache = `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    logoCache = null;
  }
  return logoCache;
}

export async function buildDocumentPdf(type: DocType, doc: any): Promise<{ buffer: Buffer; fileName: string }> {
  const s: any = (await prisma.companySettings.findUnique({ where: { id: 'global-settings' } }).catch(() => null)) || {};
  const company = s.companyName || 'ARIB GLOBAL';
  const currency = doc.currency || s.currency || 'USD';
  const isDraft = type === 'TAX_INVOICE' && doc.documentStatus === 'DRAFT';
  const number = isDraft ? 'DRAFT' : documentNumberOf(type, doc);

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = pdf.internal.pageSize.getWidth();
  const M = 14;

  // ── header ────────────────────────────────────────────────────────────────
  const img = await logo();
  if (img) {
    try { pdf.addImage(img, 'PNG', M, 10, 38, 14); } catch {}
  }
  pdf.setTextColor(...INK).setFont('helvetica', 'bold').setFontSize(11).text(company, W - M, 13, { align: 'right' });
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
  const headLines = [s.companyAddress, [s.phone, s.email].filter(Boolean).join(' · '), s.vatGstNumber ? `TRN: ${s.vatGstNumber}` : ''].filter(Boolean);
  headLines.forEach((l: string, i: number) => pdf.text(String(l), W - M, 18 + i * 4, { align: 'right', maxWidth: 95 }));

  pdf.setDrawColor(...BRAND).setLineWidth(0.6).line(M, 32, W - M, 32);
  pdf.setTextColor(...BRAND).setFont('helvetica', 'bold').setFontSize(16).text(TITLES[type], M, 42);
  pdf.setTextColor(...INK).setFontSize(11).text(`# ${number}`, W - M, 42, { align: 'right' });

  // ── meta + parties ────────────────────────────────────────────────────────
  const meta: [string, string][] = [['Date', date(type === 'TAX_INVOICE' && doc.issuedAt ? doc.issuedAt : doc.issueDate)]];
  if (type === 'PROFORMA') meta.push(['Valid until', date(doc.expiryDate)]);
  else meta.push(['Due date', date(doc.dueDate)]);
  if (doc.paymentTerms) meta.push(['Payment terms', String(doc.paymentTerms)]);
  if (type === 'PROFORMA' && doc.deliveryTerms) meta.push(['Delivery terms', String(doc.deliveryTerms)]);
  if (type === 'TAX_INVOICE' && doc.proformaNumber) meta.push(['Proforma ref.', String(doc.proformaNumber)]);
  if (type === 'TAX_INVOICE' && doc.depotName) meta.push(['Dispatch depot', String(doc.depotName)]);

  let y = 50;
  pdf.setFontSize(8).setFont('helvetica', 'bold').setTextColor(...MUTED).text('BILL TO', M, y);
  pdf.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK).text(String(doc.customerCompany || doc.customerName || ''), M, y + 5, { maxWidth: 85 });
  pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK);
  const billLines = [doc.customerName && doc.customerName !== doc.customerCompany ? `Attn: ${doc.customerName}` : '', doc.billingAddress, doc.customerEmail, doc.customerPhone].filter(Boolean);
  let by = y + 10;
  for (const l of billLines) {
    const wrapped = pdf.splitTextToSize(String(l), 85);
    pdf.text(wrapped, M, by);
    by += wrapped.length * 4;
  }
  if (doc.shippingAddress && doc.shippingAddress !== doc.billingAddress) {
    pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text('SHIP TO', M, by + 2);
    pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK);
    const wrapped = pdf.splitTextToSize(String(doc.shippingAddress), 85);
    pdf.text(wrapped, M, by + 6);
    by += 6 + wrapped.length * 4;
  }
  meta.forEach(([k, v], i) => {
    pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED).text(k, W - M - 70, y + i * 5);
    pdf.setFont('helvetica', 'bold').setTextColor(...INK).text(v, W - M, y + i * 5, { align: 'right', maxWidth: 45 });
  });
  y = Math.max(by, y + meta.length * 5) + 6;

  // ── line items ────────────────────────────────────────────────────────────
  const items: any[] = doc.items || [];
  const body = items.map((it, i) => {
    const desc = type === 'SERVICE_INVOICE' ? String(it.description || '') : `${it.productName || ''}${it.productSku ? `\nSKU: ${it.productSku}` : ''}`;
    const disc = Number(it.discountPercent) || 0;
    return [String(i + 1), desc, String(it.quantity ?? ''), money(it.unitPrice, ''), disc ? `${disc}%` : '—', money(it.taxAmount, ''), money(it.totalPrice, '')];
  });
  autoTable(pdf, {
    startY: y,
    head: [['#', 'Description', 'Qty', 'Unit price', 'Disc.', 'Tax', 'Amount']],
    body: body.length ? body : [['', 'No line items', '', '', '', '', '']],
    margin: { left: M, right: M },
    styles: { fontSize: 8.5, cellPadding: 2.2, textColor: INK, lineColor: [229, 231, 235], lineWidth: 0.1 },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 8 }, 2: { halign: 'center', cellWidth: 14 }, 3: { halign: 'right', cellWidth: 26 }, 4: { halign: 'center', cellWidth: 14 }, 5: { halign: 'right', cellWidth: 22 }, 6: { halign: 'right', cellWidth: 28 } },
  });
  y = (pdf as any).lastAutoTable.finalY + 6;

  // ── totals ────────────────────────────────────────────────────────────────
  const rows: [string, string, boolean?][] = [['Subtotal', money(doc.subtotal, currency)]];
  if (Number(doc.discountAmount) > 0) rows.push(['Discount', `- ${money(doc.discountAmount, currency)}`]);
  rows.push(['Tax / VAT', money(doc.taxAmount, currency)]);
  if (Number(doc.shippingCost) > 0) rows.push(['Freight', money(doc.shippingCost, currency)]);
  if (Number(doc.otherCharges) > 0) rows.push(['Other charges', money(doc.otherCharges, currency)]);
  rows.push(['Total', money(doc.grandTotal, currency), true]);
  if (y + rows.length * 6 > 270) { pdf.addPage(); y = 20; }
  rows.forEach(([k, v, strong]) => {
    if (strong) { pdf.setDrawColor(...BRAND).setLineWidth(0.4).line(W - M - 80, y - 4, W - M, y - 4); }
    pdf.setFont('helvetica', strong ? 'bold' : 'normal').setFontSize(strong ? 11 : 9).setTextColor(...(strong ? BRAND : INK));
    pdf.text(k, W - M - 80, y);
    pdf.text(v, W - M, y, { align: 'right' });
    y += strong ? 8 : 5.5;
  });

  // ── bank details + notes ──────────────────────────────────────────────────
  const bank = [['Bank', s.bankName], ['Account name', s.accountName], ['Account no.', s.accountNumber], ['IBAN', s.iban], ['SWIFT / BIC', s.swiftBic]].filter(([, v]) => v);
  if (bank.length) {
    if (y + 8 + bank.length * 4.5 > 280) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text('BANK DETAILS', M, y);
    y += 4.5;
    pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK);
    for (const [k, v] of bank) { pdf.text(`${k}: ${v}`, M, y, { maxWidth: W - 2 * M }); y += 4.5; }
    y += 2;
  }
  if (doc.notes) {
    const wrapped = pdf.splitTextToSize(String(doc.notes), W - 2 * M);
    if (y + 6 + wrapped.length * 4 > 285) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text('NOTES', M, y);
    pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK).text(wrapped, M, y + 4.5);
  }

  // ── watermark + footer on every page ──────────────────────────────────────
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    if (isDraft) {
      pdf.setTextColor(220, 38, 38).setFont('helvetica', 'bold').setFontSize(70);
      pdf.saveGraphicsState?.();
      try { pdf.setGState(new (pdf as any).GState({ opacity: 0.12 })); } catch {}
      pdf.text('DRAFT', W / 2, 160, { align: 'center', angle: 30 });
      pdf.restoreGraphicsState?.();
    }
    pdf.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED);
    pdf.text(`${company} · ${TITLES[type]} ${number}`, M, 290);
    pdf.text(`Page ${p} of ${pages}`, W - M, 290, { align: 'right' });
  }

  return { buffer: Buffer.from(pdf.output('arraybuffer')), fileName: pdfFileName(type, doc, company) };
}
