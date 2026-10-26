import { dec, round2 } from '@/lib/money';
import { listUnits } from '@/lib/units';
import { addQty, fmtQtyWithUnit } from '@/lib/quantity';
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
import { getCompanySettingsCached } from '@/lib/settings-cache';
import { banksForDocument, liveProfile, profileFor } from '@/lib/company';
import { incotermLine, printableDelivery } from '@/lib/documents/terms';
import { amountInWords } from '@/lib/documents/amount-words';
import { totalQuantityText } from '@/lib/documents/quantity-totals';
import { withProductSkus } from '@/lib/documents/sku';
import { StampError, loadStamp } from '@/lib/documents/stamp';
import { evaluateSealPolicy } from '@/lib/seal-policy';
import { prisma } from '@/lib/prisma';
import { shipmentRows, termLines } from '@/lib/documents/shipment-text';

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

export interface PdfOptions {
  /** true / false = the user's choice; 'auto' (default) follows the same seal policy as the on-screen preview. */
  stamp?: boolean | 'auto';
}

/** Throws StampError when the stamp was explicitly requested but cannot be loaded; with 'auto' it is skipped and reported in `warnings`. */
export async function buildDocumentPdf(type: DocType, doc: any, opts: PdfOptions = {}): Promise<{ buffer: Buffer; fileName: string; warnings: string[] }> {
  const warnings: string[] = [];
  // Company + bank details: the frozen snapshot of an issued document, otherwise the live Settings (never typed in here).
  const live = await liveProfile();
  const profile = profileFor(doc, live);
  const s: any = profile.company;
  const company = s.companyName || s.tradingName || 'ARIB GLOBAL';
  const currency = doc.currency || ((await getCompanySettingsCached())?.currency as string) || 'USD';
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
  // Company block: everything comes from Settings -> Company (name, address lines, TRN); nothing is typed in here.
  pdf.setTextColor(...INK).setFont('helvetica', 'bold').setFontSize(11).text(company, W - M, 13, { align: 'right', maxWidth: 110 });
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
  const trn = String(s.vatGstNumber || s.taxRegistrationNumber || '').trim();
  const addressLines = String(s.companyAddress || '').split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
  const headLines = [...addressLines, [s.phone, s.mobile].filter(Boolean).join(' · '), [s.email, s.website].filter(Boolean).join(' · '), trn ? `TRN: ${trn}` : ''].filter(Boolean) as string[];
  let hy = 17.5;
  headLines.forEach((l) => {
    const wrapped = pdf.splitTextToSize(String(l), 100) as string[];
    wrapped.forEach((w) => { pdf.text(w, W - M, hy, { align: 'right' }); hy += 3.7; });
  });
  const ruleY = Math.max(32, hy + 1.5);

  pdf.setDrawColor(...BRAND).setLineWidth(0.6).line(M, ruleY, W - M, ruleY);
  pdf.setTextColor(...BRAND).setFont('helvetica', 'bold').setFontSize(16).text(TITLES[type], M, ruleY + 10);
  pdf.setTextColor(...INK).setFontSize(11).text(`# ${number}`, W - M, ruleY + 10, { align: 'right' });

  // ── meta + parties ────────────────────────────────────────────────────────
  const meta: [string, string][] = [['Date', date(type === 'TAX_INVOICE' && doc.issuedAt ? doc.issuedAt : doc.issueDate)]];
  if (type === 'PROFORMA') meta.push(['Valid until', date(doc.expiryDate)]);
  else meta.push(['Due date', date(doc.dueDate)]);
  // Terms come from THIS document's record, never from the customer's current profile and never from a default.
  if (doc.paymentTerms) meta.push(['Payment terms', String(doc.paymentTerms)]);
  if (doc.paymentMethod) meta.push(['Payment method', String(doc.paymentMethod)]);
  if (type !== 'SERVICE_INVOICE') {
    const inc = incotermLine(doc.incoterm, doc.incotermPlace);
    if (inc) meta.push(['Incoterms', inc]);
  }
  if (type === 'TAX_INVOICE' && doc.proformaNumber) meta.push(['Proforma ref.', String(doc.proformaNumber)]);
  const depotLabel = type === 'TAX_INVOICE'
    ? doc.depotName
    : type === 'PROFORMA'
      ? Array.from(new Set((doc.items || []).map((i: any) => i.selectedDepotName).filter(Boolean))).join(', ')
      : '';
  if (depotLabel) meta.push(['Dispatch depot', String(depotLabel)]);

  let y = ruleY + 18;
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
  let my = y;
  meta.forEach(([k, v]) => {
    pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED).text(k, W - M - 80, my);
    pdf.setFont('helvetica', 'bold').setTextColor(...INK);
    const lines = pdf.splitTextToSize(v, 50) as string[];   // long values wrap instead of running into the next row
    lines.forEach((l, li) => pdf.text(l, W - M, my + li * 4, { align: 'right' }));
    my += Math.max(5, lines.length * 4 + 1);
  });
  y = Math.max(by, my) + 6;

  // ── line items ────────────────────────────────────────────────────────────
  const items: any[] = type === 'SERVICE_INVOICE' ? doc.items || [] : await withProductSkus(doc.items);
  const units = await listUnits();
  const product = type !== 'SERVICE_INVOICE';
  const body = items.map((it, i) => {
    const desc = product ? String(it.productName || '') : String(it.description || '');
    const disc = Number(it.discountPercent) || 0;
    // SKU comes from the product master; a line without one shows a dash, never a made-up code or the product name
    const row = [String(i + 1), ...(product ? [String(it.productSku || '').trim() || '—'] : []), desc, it.quantity == null ? '' : fmtQtyWithUnit(it.quantity, it.unit, units), money(it.unitPrice, ''), disc ? `${disc}%` : '—', money(it.taxAmount, ''), money(round2(dec(it.quantity ?? 0).times(it.unitPrice ?? 0).times(dec(100).minus(disc)).div(100)), '')];
    return row;
  });
  const head = ['#', ...(product ? ['SKU'] : []), 'Description', 'Qty', 'Unit price', 'Disc.', 'Tax', 'Amount']; // Amount = quantity x unit price less the line discount; the tax of the line is its own column and the totals below
  const ci = (n: number) => n + (product ? 1 : 0); // column index shift when the SKU column is present
  autoTable(pdf, {
    startY: y,
    head: [head],
    body: body.length ? body : [head.map((_, k) => (k === (product ? 2 : 1) ? 'No line items' : ''))],
    margin: { left: M, right: M },
    styles: { fontSize: product ? 8 : 8.5, cellPadding: 2, textColor: INK, lineColor: [229, 231, 235], lineWidth: 0.1 },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 7 },
      ...(product ? { 1: { cellWidth: 27, font: 'courier', fontSize: 7.5 } } : {}),
      [ci(2)]: { halign: 'center', cellWidth: 25 }, [ci(3)]: { halign: 'right', cellWidth: 24 }, [ci(4)]: { halign: 'center', cellWidth: 12 },
      [ci(5)]: { halign: 'right', cellWidth: 20 }, [ci(6)]: { halign: 'right', cellWidth: 26 },
    },
  });
  y = (pdf as any).lastAutoTable.finalY + 6;
  // Total quantity over the actual lines, summed only within one unit: "261.640 Mt", or "100.270 Mt + 6 Pcs" for mixed units.
  const tq = product ? totalQuantityText(items, units) : '';
  if (tq) {
    pdf.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK).text(`Total Quantity: ${tq}`, M, y - 1);
    y += 5;
  }

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

  // Amount in words from the very same grand total that is printed above, in the document's currency.
  {
    const words = `Amount in Words: ${amountInWords(doc.grandTotal, currency)}`;
    const wrapped = pdf.splitTextToSize(words, W - 2 * M) as string[];
    if (y + wrapped.length * 4.2 + 2 > 280) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK).text(wrapped, M, y);
    y += wrapped.length * 4.2 + 3;
  }
  // Company stamp: decided and loaded here so it can sit beside the terms / bank details (right-hand side), not alone on a new page.
  const policy = evaluateSealPolicy({ documentType: type, status: type === 'TAX_INVOICE' && doc.documentStatus === 'DRAFT' ? 'DRAFT' : doc.status, fulfilmentStatus: doc.fulfilmentStatus });
  const wantStamp = opts.stamp === undefined || opts.stamp === 'auto' ? policy.shouldSeal : !!opts.stamp;
  let stamp: { dataUrl: string; format: 'PNG' | 'JPEG'; w: number; h: number } | null = null;
  if (wantStamp) {
    const st = await loadStamp(((await getCompanySettingsCached()) as any)?.sealUrl);
    if (!st.ok) {
      if (opts.stamp === true) throw new StampError(st.reason);
      warnings.push(`Company stamp not printed: ${st.reason}`);
      console.warn('[PDF] company stamp skipped:', st.reason);
    } else {
      let dims = { width: 1, height: 1 };
      try { dims = pdf.getImageProperties(st.dataUrl) as any; } catch {}
      const box = 30, ar = dims.width / dims.height || 1; // fits a 30 mm square, aspect ratio kept
      stamp = { dataUrl: st.dataUrl, format: st.format, w: ar >= 1 ? box : box * ar, h: ar >= 1 ? box / ar : box };
    }
  }
  if (stamp && y + stamp.h + 12 > 282) { pdf.addPage(); y = 20; }
  const stampAt = stamp ? { page: pdf.getNumberOfPages(), y } : null;

  // Terms as stored on THIS document (delivery note / insurance responsibility ...): one line per statement.
  // AWB / packing details recorded after issue (supplementary): from the loaded document, else read from the database.
  const shipDetails = type !== 'TAX_INVOICE' ? null : doc.shipmentDetails !== undefined ? doc.shipmentDetails : await prisma.invoiceShipmentDetails.findUnique({ where: { invoiceId: doc.id } }).catch(() => null);
  const terms = type === 'SERVICE_INVOICE' ? [] : termLines(doc.deliveryTerms, shipDetails);
  if (terms.length) {
    if (y + 6 + terms.length * 4.4 > 280) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text('TERMS', M, y);
    pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK);
    y += 4.5;
    for (const t of terms) {
      const w = pdf.splitTextToSize(`• ${t}`, W - 2 * M) as string[];
      pdf.text(w, M, y);
      y += w.length * 4.4;
    }
    y += 2;
  }

  // Shipment & packing details (AWB received after the invoice was issued). Omitted entirely when nothing has been entered.
  const shipRows = shipmentRows(shipDetails, date);
  if (shipRows.length) {
    const wrapped = shipRows.map(([k, v]) => ({ k, lines: pdf.splitTextToSize(v, W - 2 * M - 52) as string[] }));
    const need = 6 + wrapped.reduce((n, r) => n + Math.max(1, r.lines.length) * 4.4, 0);
    if (y + need > 280) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text('SHIPMENT & PACKING DETAILS', M, y);
    y += 4.5;
    for (const r of wrapped) {
      pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED).text(r.k, M, y);
      pdf.setTextColor(...INK).text(r.lines, M + 48, y);
      y += Math.max(1, r.lines.length) * 4.4;
    }
    y += 3;
  }

  // ── bank details + notes ──────────────────────────────────────────────────
  // Only ACTIVE accounts (as captured on this document) are printed: those in the document's currency, else the default.
  const accounts = banksForDocument(profile.bankAccounts, currency);
  if (accounts.length) {
    if (y + 14 > 280) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text(accounts.length > 1 ? 'BANK DETAILS (choose the account in your currency)' : 'BANK DETAILS', M, y);
    y += 4.5;
    for (const a of accounts) {
      const rows = [
        ['Bank', [a.bankName, a.branch].filter(Boolean).join(', ')], ['Account name', a.accountName], ['Account no.', a.accountNumber], ['IBAN', a.iban],
        ['SWIFT / BIC', a.swiftBic], ['Routing code', a.routingCode], ['Currency', a.currency], ['Bank address', a.bankAddress], ['Other', a.otherInfo],
      ].filter(([, v]) => v) as [string, string][];
      const instr = a.paymentInstructions ? (pdf.splitTextToSize(a.paymentInstructions, W - 2 * M) as string[]) : [];
      if (y + (rows.length + instr.length) * 4.5 + 4 > 282) { pdf.addPage(); y = 20; }
      pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK);
      for (const [k, v] of rows) { pdf.text(`${k}: ${v}`, M, y, { maxWidth: W - 2 * M }); y += 4.5; }
      if (instr.length) { pdf.setTextColor(...MUTED); instr.forEach((l) => { pdf.text(l, M, y); y += 4.2; }); pdf.setTextColor(...INK); }
      y += 2.5;
    }
    y += 1;
  }
  if (doc.notes) {
    const wrapped = pdf.splitTextToSize(String(doc.notes), W - 2 * M);
    if (y + 6 + wrapped.length * 4 > 285) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text('NOTES', M, y);
    pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK).text(wrapped, M, y + 4.5);
  }

  // ── company stamp: drawn where it was reserved, right-aligned beside the terms / bank details ──
  if (stamp && stampAt) {
    const last = pdf.getNumberOfPages();
    pdf.setPage(stampAt.page);
    const bx = W - M - 38; // 38 mm wide slot at the right margin
    pdf.addImage(stamp.dataUrl, stamp.format, bx + (38 - stamp.w) / 2, stampAt.y, stamp.w, stamp.h);
    pdf.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...INK).text('OFFICIAL COMPANY STAMP', bx + 19, stampAt.y + stamp.h + 4, { align: 'center' });
    pdf.setPage(last);
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

  return { buffer: Buffer.from(pdf.output('arraybuffer')), fileName: pdfFileName(type, doc, company), warnings };
}
