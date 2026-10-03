/** Client-side PDF export for reports. jsPDF is loaded on demand so it never weighs on normal page loads. */

export interface ReportPdfSection {
  title: string;
  note?: string;
  head: string[];
  rows: (string | number)[][];
  /** column indexes (0-based) to right-align */
  right?: number[];
  /** optional bold totals row */
  foot?: (string | number)[];
}

export interface ReportPdfOptions {
  title: string;
  subtitle?: string;
  /** e.g. ["Period: 01 Sep 2026 – 30 Sep 2026", "Depot: Dubai"] */
  filters?: string[];
  kpis?: { label: string; value: string }[];
  sections: ReportPdfSection[];
  filename: string;
  company?: string;
  landscape?: boolean;
}

const BRAND: [number, number, number] = [0, 94, 130];
const INK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [107, 114, 128];

async function loadLogo(): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch('/pdflogo.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    const data: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const dims: { w: number; h: number } = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = reject;
      img.src = data;
    });
    return { data, ...dims };
  } catch {
    return null;
  }
}

export async function downloadReportPdf(opts: ReportPdfOptions): Promise<void> {
  const [{ jsPDF }, autoTableMod, logo] = await Promise.all([import('jspdf'), import('jspdf-autotable'), loadLogo()]);
  const autoTable = (autoTableMod as any).default || (autoTableMod as any).autoTable;

  const doc = new jsPDF({ orientation: opts.landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const generated = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  // ── header ──
  let y = margin;
  if (logo) {
    const h = 28;
    doc.addImage(logo.data, 'PNG', margin, y - 6, (logo.w / logo.h) * h, h);
  }
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...MUTED);
  doc.text(opts.company || 'ARIB GLOBAL', pageW - margin, y + 4, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(8);
  doc.text(`Generated ${generated}`, pageW - margin, y + 16, { align: 'right' });
  y += 38;
  doc.setDrawColor(...BRAND).setLineWidth(1.5).line(margin, y, pageW - margin, y);
  y += 24;

  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...INK);
  doc.text(opts.title, margin, y);
  y += 16;
  if (opts.subtitle) {
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...MUTED);
    doc.text(opts.subtitle, margin, y);
    y += 14;
  }
  if (opts.filters?.length) {
    doc.setFontSize(9).setTextColor(...MUTED);
    const line = doc.splitTextToSize(opts.filters.join('   ·   '), pageW - margin * 2);
    doc.text(line, margin, y);
    y += line.length * 12;
  }
  y += 6;

  // ── KPI tiles ──
  if (opts.kpis?.length) {
    const perRow = Math.min(opts.kpis.length, opts.landscape ? 6 : 4);
    const gap = 8;
    const tileW = (pageW - margin * 2 - gap * (perRow - 1)) / perRow;
    const tileH = 46;
    opts.kpis.forEach((k, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = margin + col * (tileW + gap);
      const ty = y + row * (tileH + gap);
      doc.setDrawColor(229, 231, 235).setFillColor(248, 250, 252).setLineWidth(0.8).roundedRect(x, ty, tileW, tileH, 6, 6, 'FD');
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED);
      doc.text(k.label.toUpperCase(), x + 9, ty + 15);
      doc.setFont('helvetica', 'bold').setFontSize(Math.min(14, Math.max(9, (tileW - 14) / (k.value.length * 0.62)))).setTextColor(...INK);
      doc.text(k.value, x + 9, ty + 34);
    });
    y += Math.ceil(opts.kpis.length / perRow) * (tileH + gap) + 18;
  }

  // ── sections ──
  for (const s of opts.sections) {
    if (y > pageH - 110) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...INK);
    doc.text(s.title, margin, y);
    y += 6;
    if (s.note) {
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED);
      doc.text(s.note, margin, y + 8);
      y += 10;
    }
    const columnStyles: Record<number, any> = {};
    (s.right || []).forEach((c) => { columnStyles[c] = { halign: 'right' }; });
    autoTable(doc, {
      startY: y + 4,
      head: [s.head],
      body: s.rows.length ? s.rows.map((r) => r.map(String)) : [[{ content: 'No data for the selected filters.', colSpan: s.head.length, styles: { halign: 'center', textColor: MUTED } }]],
      foot: s.foot && s.rows.length ? [s.foot.map(String)] : undefined,
      theme: 'striped',
      margin: { left: margin, right: margin, bottom: 44 },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 5, textColor: INK, overflow: 'linebreak' },
      headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      footStyles: { fillColor: [241, 245, 249], textColor: INK, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles,
      showFoot: 'lastPage',
      didParseCell: (d: any) => {
        if ((s.right || []).includes(d.column.index) && d.section !== 'body') d.cell.styles.halign = 'right';
      },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 24;
  }

  // ── footer on every page ──
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(229, 231, 235).setLineWidth(0.6).line(margin, pageH - 32, pageW - margin, pageH - 32);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
    doc.text(`${opts.company || 'ARIB GLOBAL'} · ${opts.title}`, margin, pageH - 18);
    doc.text(`Page ${p} of ${total}`, pageW - margin, pageH - 18, { align: 'right' });
  }

  doc.save(opts.filename.endsWith('.pdf') ? opts.filename : `${opts.filename}.pdf`);
}
