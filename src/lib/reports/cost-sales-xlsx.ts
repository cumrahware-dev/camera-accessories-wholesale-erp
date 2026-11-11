import 'server-only';
import ExcelJS from 'exceljs';
import type { CostSheet } from './cost-sales-sheet';

const thin = { style: 'thin' as const, color: { argb: 'FF9AA3AF' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const fmtOf = (cur: string, dp = 2) => `"${cur}" #,##0.${'0'.repeat(dp)}`;

/** Excel file for one invoice: reference table first (exact headings/order), then clearly separated extra sections. */
export async function costSheetXlsx(s: CostSheet): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Arib Global ERP'; wb.created = new Date();
  const ws = wb.addWorksheet('Cost & Sales', { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } } });
  const costCur = s.costCurrencies.length === 1 ? s.costCurrencies[0] : s.costCurrencies.length > 1 ? s.costCurrencies.join('/') : s.baseCurrency;
  ws.columns = [{ width: 8 }, { width: 18 }, { width: 44 }, { width: 9 }, { width: 14 }, { width: 28 }, { width: 18 }, { width: 14 }];

  ws.mergeCells('A1:H1');
  Object.assign(ws.getCell('A1'), { value: 'COST & SALES SHEET' });
  ws.getCell('A1').font = { bold: true, size: 15 }; ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.getCell('A2').value = 'Invoice Number:'; ws.getCell('C2').value = safe(s.invoiceNumber);
  ws.getCell('A3').value = 'Customer Name:'; ws.getCell('C3').value = safe(s.customerName);
  for (const a of ['A2', 'A3']) ws.getCell(a).font = { bold: true };
  ws.mergeCells('A2:B2'); ws.mergeCells('A3:B3');
  ws.getCell('C2').font = { bold: true, size: 12 }; ws.getCell('C3').font = { bold: true, size: 12 };

  const HEAD = 5;
  ['Sl. No', 'SKU', 'Product Desc', 'Qty', `Cost ${costCur}`, 'Supplier', 'Depot', `Sell ${s.sellCurrency}`].forEach((h, i) => {
    const c = ws.getCell(HEAD, i + 1);
    c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = box;
  });
  ws.getRow(HEAD).height = 22;
  let r = HEAD + 1;
  for (const row of s.rows) {
    const vals: (string | number | null)[] = [row.slNo, safe(row.sku), safe(row.description), row.qty, row.unitCost, row.supplier ? safe(row.supplier) : 'MISSING', row.depot ? safe(row.depot) : 'MISSING', row.unitSell];
    vals.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = i === 4 && v === null ? 'MISSING' : v;
      c.border = box; c.alignment = { vertical: 'top', wrapText: i === 2 || i === 5, horizontal: i === 0 || i === 3 ? 'center' : i === 4 || i === 7 ? 'right' : 'left' };
      if (i === 3) c.numFmt = '#,##0.###';
      if (i === 4) c.numFmt = fmtOf(row.costCurrency || costCur, 4);
      if (i === 7) c.numFmt = fmtOf(s.sellCurrency, 2);
      if (v === 'MISSING' || (i === 4 && v === null)) { c.font = { bold: true, color: { argb: 'FFB91C1C' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }; }
    });
    r++;
  }
  ws.views = [{ state: 'frozen', ySplit: HEAD }];
  ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD + Math.max(1, s.rows.length), column: 8 } };
  ws.pageSetup.printTitlesRow = `${HEAD}:${HEAD}`;

  // ---- additional sections (not part of the reference layout)
  r += 1;
  ws.mergeCells(r, 1, r, 8);
  const t = ws.getCell(r, 1); t.value = 'ADDITIONAL INFORMATION (not part of the reference layout) - line totals'; t.font = { bold: true }; t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  r++;
  ['Sl. No', 'SKU', 'Product Desc', 'Qty', `Total Cost ${costCur}`, `Total Sales ${s.sellCurrency}`, `Gross Profit ${s.sellCurrency}`, 'Line discount %'].forEach((h, i) => {
    const c = ws.getCell(r, i + 1); c.value = h; c.font = { bold: true }; c.border = box; c.alignment = { horizontal: 'center', wrapText: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  });
  ws.getRow(r).height = 30; r++;
  for (const row of s.rows) {
    [row.slNo, safe(row.sku), safe(row.description), row.qty, row.totalCost ?? 'MISSING', row.totalSales, row.grossProfit ?? 'n/a', row.discountPercent].forEach((v, i) => {
      const c = ws.getCell(r, i + 1); c.value = v; c.border = box;
      c.alignment = { vertical: 'top', wrapText: i === 2, horizontal: i === 0 || i === 3 ? 'center' : i >= 4 ? 'right' : 'left' };
      if (i === 3) c.numFmt = '#,##0.###';
      if (i === 4 && typeof v === 'number') c.numFmt = fmtOf(row.costCurrency || costCur);
      if (i === 5 || i === 6) c.numFmt = fmtOf(s.sellCurrency);
      if (i === 7) c.numFmt = '0.##"%"';
      if (v === 'MISSING') c.font = { bold: true, color: { argb: 'FFB91C1C' } };
    });
    r++;
  }

  r += 1;
  ws.mergeCells(r, 1, r, 8);
  const st = ws.getCell(r, 1); st.value = 'SUMMARY'; st.font = { bold: true }; st.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  r++;
  const sm = s.summary;
  const line = (label: string, v: number | string | null, fmt?: string) => {
    ws.mergeCells(r, 1, r, 4);
    const l = ws.getCell(r, 1); l.value = label; l.font = { bold: true }; l.border = box;
    const c = ws.getCell(r, 5); c.value = v ?? 'n/a'; c.border = box; c.alignment = { horizontal: 'right' }; if (fmt && typeof v === 'number') c.numFmt = fmt; c.font = { bold: true };
    r++;
  };
  line('Total Quantity', sm.totalQty, '#,##0.###');
  line(`Total Cost (${costCur})`, sm.totalCost === null ? 'INCOMPLETE - cost missing' : sm.totalCost, fmtOf(costCur));
  line(`Total Sales (${s.sellCurrency})`, sm.totalSales, fmtOf(s.sellCurrency));
  line(`Gross Profit (${s.sellCurrency})`, sm.grossProfit, fmtOf(s.sellCurrency));
  line('Gross Profit Margin (%)', sm.marginPercent, '0.00"%"');
  if (sm.profitNote) { ws.mergeCells(r, 1, r, 8); const n = ws.getCell(r, 1); n.value = sm.profitNote; n.font = { bold: true, color: { argb: 'FFB91C1C' } }; n.alignment = { wrapText: true }; ws.getRow(r).height = 30; r++; }

  r += 1;
  ws.mergeCells(r, 1, r, 8); ws.getCell(r, 1).value = 'NOTES'; ws.getCell(r, 1).font = { bold: true }; r++;
  for (const n of s.notes) { ws.mergeCells(r, 1, r, 8); const c = ws.getCell(r, 1); c.value = safe(n); c.alignment = { wrapText: true, vertical: 'top' }; c.font = { size: 9 }; ws.getRow(r).height = n.length > 110 ? 26 : 14; r++; }
  ws.headerFooter.oddFooter = '&LCost & Sales Sheet - ' + s.invoiceNumber.replace(/&/g, '') + '&RPage &P of &N';

  return Buffer.from(await wb.xlsx.writeBuffer());
}
