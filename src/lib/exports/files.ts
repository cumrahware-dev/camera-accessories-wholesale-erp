/**
 * Builds XLSX / CSV downloads from plain rows. Used by the product catalogue, inventory report and data export.
 * Spreadsheet-injection safe: text starting with = + - @ is written as plain text, never as a formula.
 */
import 'server-only';
import * as XLSX from 'xlsx';
import { NextResponse } from 'next/server';

export type Cell = string | number | boolean | null | undefined;
export interface Sheet { name: string; head: string[]; rows: Cell[][]; foot?: Cell[]; widths?: number[]; note?: string[] }
export type ExportFormat = 'xlsx' | 'csv';

export const parseFormat = (v: string | null): ExportFormat | null => {
  const f = (v || 'xlsx').toLowerCase();
  return f === 'xlsx' || f === 'csv' ? f : null;
};

const FORMULA_START = /^[=+\-@\t\r]/;
const safeText = (v: string) => (FORMULA_START.test(v) ? `'${v}` : v);

/** Excel sheet names: max 31 chars, none of : \ / ? * [ ] */
const sheetName = (n: string) => n.replace(/[:\\/?*\[\]]/g, ' ').slice(0, 31) || 'Sheet';

function norm(c: Cell): string | number | boolean {
  if (c === null || c === undefined) return '';
  if (typeof c === 'string') return safeText(c);
  return c;
}

export function toXlsx(sheets: Sheet[]): Buffer {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sh of sheets) {
    const aoa: (string | number | boolean)[][] = [...(sh.note || []).map((n) => [n]), ...(sh.note?.length ? [[]] : []), sh.head, ...sh.rows.map((r) => r.map(norm)), ...(sh.foot ? [sh.foot.map(norm)] : [])] as any;
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = (sh.widths || sh.head.map((h, i) => Math.min(60, Math.max(h.length + 2, ...sh.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))))).map((w) => ({ wch: w }));
    let name = sheetName(sh.name), n = 2;
    while (used.has(name.toLowerCase())) name = sheetName(`${sh.name.slice(0, 28)} ${n++}`);
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
}

const csvCell = (c: Cell) => {
  const v = norm(c);
  const s = typeof v === 'number' ? String(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** UTF-8 with BOM (so Excel reads non-English names correctly) and CRLF line endings. */
export function toCsv(sheet: Sheet): Buffer {
  const lines = [...(sheet.note || []).map((n) => csvCell(n)), sheet.head.map(csvCell).join(','), ...sheet.rows.map((r) => r.map(csvCell).join(',')), ...(sheet.foot ? [sheet.foot.map(csvCell).join(',')] : [])];
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

export function fileResponse(format: ExportFormat, baseName: string, sheets: Sheet[]): NextResponse {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = baseName.replace(/[^A-Za-z0-9_-]+/g, '_');
  const buffer = format === 'csv' ? toCsv(sheets[0]) : toXlsx(sheets);
  const type = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': type,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `attachment; filename="${safe}_${stamp}.${format}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
