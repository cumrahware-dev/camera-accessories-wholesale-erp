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
  const img = await logo();

  if (type === 'TAX_INVOICE') return buildTaxInvoicePdf(pdf, W, M, doc, s, company, currency, number, isDraft, img);

  // ── header ────────────────────────────────────────────────────────────────
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
  const meta: [string, string][] = [['Date', date(doc.issueDate)]];
  if (type === 'PROFORMA') meta.push(['Valid until', date(doc.expiryDate)]);
  else meta.push(['Due date', date(doc.dueDate)]);
  // Terms come from THIS document's record, never from the customer's current profile and never from a default.
  if (doc.paymentTerms) meta.push(['Payment terms', String(doc.paymentTerms)]);
  if (doc.paymentMethod) meta.push(['Payment method', String(doc.paymentMethod)]);
  if (type !== 'SERVICE_INVOICE') {
    const inc = incotermLine(doc.incoterm, doc.incotermPlace);
    if (inc) meta.push(['Incoterms', inc]);
    const note = printableDelivery(doc.deliveryTerms);
    if (note) meta.push(['Delivery note', note]);
  }
  const depotLabel = type === 'PROFORMA'
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
  const items: any[] = doc.items || [];
  const units = await listUnits();
  const body = items.map((it, i) => {
    const desc = type === 'SERVICE_INVOICE' ? String(it.description || '') : `${it.productName || ''}${it.productSku ? `\nSKU: ${it.productSku}` : ''}`;
    const disc = Number(it.discountPercent) || 0;
    return [String(i + 1), desc, it.quantity == null ? '' : fmtQtyWithUnit(it.quantity, it.unit, units), money(it.unitPrice, ''), disc ? `${disc}%` : '—', money(it.taxAmount, ''), money(round2(dec(it.quantity ?? 0).times(it.unitPrice ?? 0).times(dec(100).minus(disc)).div(100)), '')];
  });
  autoTable(pdf, {
    startY: y,
    head: [['#', 'Description', 'Qty', 'Unit price', 'Disc.', 'Tax', 'Amount']], // Amount = quantity x unit price less the line discount; the tax of the line is its own column and the totals below
    body: body.length ? body : [['', 'No line items', '', '', '', '', '']],
    margin: { left: M, right: M },
    styles: { fontSize: 8.5, cellPadding: 2.2, textColor: INK, lineColor: [229, 231, 235], lineWidth: 0.1 },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 8 }, 2: { halign: 'center', cellWidth: 24 }, 3: { halign: 'right', cellWidth: 26 }, 4: { halign: 'center', cellWidth: 14 }, 5: { halign: 'right', cellWidth: 22 }, 6: { halign: 'right', cellWidth: 28 } },
  });
  y = (pdf as any).lastAutoTable.finalY + 6;
  // Total quantity, printed when every line is in the same measured unit (e.g. 261.640 Mt), as on the supplier's own invoices.
  const uniq = Array.from(new Set(items.map((it) => String(it.unit || 'Pcs'))));
  if (items.length > 1 && uniq.length === 1 && uniq[0] !== 'Pcs') {
    pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED).text(`Total quantity: ${fmtQtyWithUnit(addQty(...items.map((it) => it.quantity)), uniq[0], units)}`, M, y - 2);
    y += 4;
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

const PANEL_BG: [number, number, number] = [245, 247, 249];
const PANEL_BORDER: [number, number, number] = [223, 229, 234];
const TOTAL_BG: [number, number, number] = [224, 238, 242];

/**
 * Tax invoice layout: reproduces the customer's own printed invoice format (grey Bill-To/Details panel,
 * bordered Consignee panel, teal item table with S.N./Unit/Qty/Rate/Total, compact totals block) instead
 * of the generic Proforma/Service-Invoice layout above. Same entry point, same data, different print.
 */
function buildTaxInvoicePdf(
  pdf: jsPDF, W: number, M: number, doc: any, s: any, company: string, currency: string, number: string, isDraft: boolean, img: string | null,
): { buffer: Buffer; fileName: string } {
  const CW = W - 2 * M;

  // ── header: logo + company block + teal rule ───────────────────────────────
  if (img) { try { pdf.addImage(img, 'PNG', M, 10, 38, 14); } catch {} }
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
  pdf.setDrawColor(...BRAND).setLineWidth(0.7).line(M, ruleY, W - M, ruleY);

  // ── INVOICE heading + number/date, top right ────────────────────────────────
  // "Tax Invoice" (not just "Invoice") is kept: FTA rules require the words on a VAT document.
  pdf.setTextColor(...BRAND).setFont('helvetica', 'bold').setFontSize(22).text(isDraft ? 'TAX INVOICE (DRAFT)' : 'TAX INVOICE', M, ruleY + 13);
  pdf.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK);
  pdf.text(`Invoice No.: ${number}`, W - M, ruleY + 9, { align: 'right' });
  pdf.text(`Date: ${date(doc.issuedAt || doc.issueDate)}`, W - M, ruleY + 13.5, { align: 'right' });

  // ── grey panel: Bill To (left) + Invoice Details (right) ───────────────────
  let y = ruleY + 20;
  const panelTop = y;
  const colGap = 8;
  const leftColW = CW * 0.58 - colGap / 2;
  const rightColW = CW * 0.42 - colGap / 2;
  const rightColX = M + leftColW + colGap;

  const custTrn = String(doc.customer?.taxNumber || '').trim();
  const billLines = [doc.billingAddress, doc.customerPhone ? `Phone: ${doc.customerPhone}` : '', custTrn ? `TRN: ${custTrn}` : ''].filter(Boolean);
  const billWrapped = billLines.flatMap((l) => pdf.splitTextToSize(String(l), leftColW - 6) as string[]);

  const detailRows: [string, string][] = [
    ['Currency', currency],
    ...(doc.incoterm ? [['Incoterm', String(doc.incoterm)] as [string, string]] : []),
    ...(doc.paymentTerms ? [['Payment', String(doc.paymentTerms)] as [string, string]] : []),
    ['VAT', vatLabelShort(doc.items)],
  ];

  const leftPanelLines = 1 /* BILL TO label */ + 1 /* company name */ + billWrapped.length;
  const panelContentLines = Math.max(leftPanelLines, 1 + detailRows.length);
  const panelH = Math.max(28, panelContentLines * 4.6 + 8);

  pdf.setFillColor(...PANEL_BG).roundedRect(M, panelTop, CW, panelH, 2, 2, 'F');

  let ly = panelTop + 6;
  pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text('CUSTOMER / BILL TO', M + 5, ly);
  ly += 5;
  pdf.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK).text(String(doc.customerCompany || doc.customerName || ''), M + 5, ly, { maxWidth: leftColW - 6 });
  ly += 5;
  pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK);
  billWrapped.forEach((l) => { pdf.text(l, M + 5, ly); ly += 4.3; });

  let ry = panelTop + 6;
  pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text('INVOICE DETAILS', rightColX, ry);
  ry += 5;
  detailRows.forEach(([k, v]) => {
    pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED).text(`${k}:`, rightColX, ry);
    pdf.setFont('helvetica', 'bold').setTextColor(...INK).text(v, rightColX + 26, ry);
    ry += 4.6;
  });

  y = panelTop + panelH + 5;

  // ── bordered panel: Consignee / Ship To ─────────────────────────────────────
  if (doc.shippingAddress) {
    const custName = String(doc.customerCompany || doc.customerName || '').trim().toLowerCase();
    // The stored address sometimes repeats the company name as its own first line; the panel already has a bold header for it.
    const shipAddrBody = String(doc.shippingAddress).split(/\r?\n/).filter((l, i) => !(i === 0 && l.trim().toLowerCase() === custName)).join('\n');
    const shipAddrWrapped = pdf.splitTextToSize(shipAddrBody, CW - 10) as string[];
    const shipPhoneLine = doc.customerPhone ? `Phone: ${doc.customerPhone}` : '';
    const consigneeLines = 1 /* label */ + 1 /* company */ + shipAddrWrapped.length + (shipPhoneLine ? 1 : 0);
    const consigneeH = Math.max(18, consigneeLines * 4.3 + 6);
    pdf.setDrawColor(...PANEL_BORDER).setLineWidth(0.3).roundedRect(M, y, CW, consigneeH, 2, 2, 'S');
    let cy = y + 5.5;
    pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text('CONSIGNEE / SHIP TO', M + 5, cy);
    cy += 4.6;
    pdf.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK).text(String(doc.customerCompany || doc.customerName || ''), M + 5, cy);
    cy += 4.3;
    pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK);
    shipAddrWrapped.forEach((l) => { pdf.text(l, M + 5, cy); cy += 4.1; });
    if (shipPhoneLine) pdf.text(shipPhoneLine, M + 5, cy);
    y += consigneeH + 6;
  }

  // ── item table: S.N. | Item Description | Unit | Qty | Rate (AED) | Total (AED) ─
  const items: any[] = doc.items || [];
  const qty2 = (n: unknown) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const body = items.map((it, i) => {
    const disc = Number(it.discountPercent) || 0;
    const net = round2(dec(it.quantity ?? 0).times(it.unitPrice ?? 0).times(dec(100).minus(disc)).div(100));
    return [String(i + 1), String(it.productName || ''), String(it.unit || 'Pcs'), qty2(it.quantity), (Number(it.unitPrice) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
  });
  autoTable(pdf, {
    startY: y,
    head: [['S.N.', 'Item Description', 'Unit', 'Qty', `Rate (${currency})`, `Total (${currency})`]],
    body: body.length ? body : [['', 'No line items', '', '', '', '']],
    margin: { left: M, right: M },
    styles: { fontSize: 8.5, cellPadding: 2.6, textColor: INK, lineColor: PANEL_BORDER, lineWidth: 0.1 },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: PANEL_BG },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' }, 2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 22, halign: 'right' }, 4: { cellWidth: 30, halign: 'right' }, 5: { cellWidth: 32, halign: 'right' },
    },
  });
  y = (pdf as any).lastAutoTable.finalY + 8;

  // ── totals: compact block, bottom right, teal divider + highlighted total row ──
  const rows: [string, string, boolean?][] = [['Gross Total (before VAT)', money(doc.subtotal, currency)]];
  if (Number(doc.discountAmount) > 0) rows.push(['Discount', `- ${money(doc.discountAmount, currency)}`]);
  rows.push([vatLabel(doc.items), money(doc.taxAmount, currency)]);
  if (Number(doc.shippingCost) > 0) rows.push(['Freight', money(doc.shippingCost, currency)]);
  if (Number(doc.otherCharges) > 0) rows.push(['Other charges', money(doc.otherCharges, currency)]);
  rows.push(['Net Total (including VAT)', money(doc.grandTotal, currency), true]);

  const blockW = 86;
  const blockX = W - M - blockW;
  const rowH = 6.4;
  if (y + rows.length * rowH + 4 > 270) { pdf.addPage(); y = 20; }
  const blockTop = y;
  rows.forEach(([k, v, strong], i) => {
    const rowY = blockTop + i * rowH;
    if (strong) pdf.setFillColor(...TOTAL_BG).rect(blockX, rowY, blockW, rowH, 'F');
    else if (i % 2 === 1) pdf.setFillColor(...PANEL_BG).rect(blockX, rowY, blockW, rowH, 'F');
    pdf.setFont('helvetica', strong ? 'bold' : 'normal').setFontSize(strong ? 9.5 : 8.5).setTextColor(...(strong ? BRAND : INK));
    pdf.text(k, blockX + 3, rowY + rowH / 2 + 1.3);
    pdf.text(v, blockX + blockW - 3, rowY + rowH / 2 + 1.3, { align: 'right' });
  });
  pdf.setDrawColor(...BRAND).setLineWidth(0.5).line(blockX, blockTop, blockX + blockW, blockTop);
  y = blockTop + rows.length * rowH + 6;

  // ── footer + draft watermark on every page ──────────────────────────────────
  // The watermark only ever appears on a DRAFT: it is not yet a legal tax invoice (no FTA-compliant
  // sequential number, not issued), so marking it prevents it being mistaken for the final document.
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
    pdf.text(`${company} · TAX INVOICE ${number}`, M, 290);
    pdf.text(`Page ${p} of ${pages}`, W - M, 290, { align: 'right' });
  }

  return { buffer: Buffer.from(pdf.output('arraybuffer')), fileName: pdfFileName('TAX_INVOICE', doc, company) };
}

/** "VAT @ 5%" when every line shares one rate, else the generic label (never a number invented for mixed rates). */
function vatLabel(items: any[]): string {
  const rates = Array.from(new Set((items || []).map((it) => Number(it.taxRate) || 0)));
  return rates.length === 1 ? `VAT @ ${rates[0]}%` : 'VAT';
}
function vatLabelShort(items: any[]): string {
  const rates = Array.from(new Set((items || []).map((it) => Number(it.taxRate) || 0)));
  return rates.length === 1 ? `${rates[0]}%` : 'Mixed';
}
