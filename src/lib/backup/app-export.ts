/**
 * "Application Data Export": the business records (customers, products, stock, documents, ...) read from the database
 * and written as one JSON file or one Excel workbook.
 *
 * This is NOT a database backup: it contains the selected business tables only, in their application shape.
 * Credentials never leave: password hashes, depot access codes, SMTP password, session counters and rate-limit state are
 * removed by an explicit per-table list AND by a name-based scrub that applies to every table.
 */
import 'server-only';
import { prisma } from '@/lib/prisma';

export interface TableDef {
  key: string;                 // key in the export file
  label: string;
  delegate: string;            // prisma client delegate
  idField?: string;            // primary key used for paging (default "id")
  exclude?: string[];          // columns that must never be exported
  group: string;
}

// Anything whose NAME looks like a credential is dropped from every table, whatever the list below says.
const SECRET_NAME = /password|passwd|secret|access_?code|api_?key|token|credential|private_?key|sessionVersion/i;

export const TABLES: TableDef[] = [
  { key: 'customers', label: 'Customers', delegate: 'customer', group: 'Parties' },
  { key: 'suppliers', label: 'Suppliers', delegate: 'supplier', group: 'Parties' },
  { key: 'categories', label: 'Categories', delegate: 'category', group: 'Products & stock' },
  { key: 'products', label: 'Products', delegate: 'product', group: 'Products & stock' },
  { key: 'depots', label: 'Depots', delegate: 'depot', group: 'Products & stock', exclude: ['accessCodeHash', 'accessCodeVersion', 'accessCodeRotatedAt', 'accessCodeRevokedAt'] },
  { key: 'inventory', label: 'Inventory (stock per depot)', delegate: 'depotInventory', group: 'Products & stock' },
  { key: 'stockTransactions', label: 'Stock movements', delegate: 'stockTransaction', group: 'Products & stock' },
  { key: 'serialNumbers', label: 'Serial numbers', delegate: 'serialNumber', group: 'Products & stock' },
  { key: 'stockTransfers', label: 'Stock transfers', delegate: 'stockTransfer', group: 'Products & stock' },
  { key: 'stockTransferItems', label: 'Stock transfer items', delegate: 'stockTransferItem', group: 'Products & stock' },
  { key: 'stockAdjustments', label: 'Stock adjustments', delegate: 'stockAdjustment', group: 'Products & stock' },
  { key: 'proformas', label: 'Proformas', delegate: 'proforma', group: 'Sales' },
  { key: 'proformaItems', label: 'Proforma items', delegate: 'proformaItem', group: 'Sales' },
  { key: 'taxInvoices', label: 'Tax invoices', delegate: 'taxInvoice', group: 'Sales' },
  { key: 'taxInvoiceItems', label: 'Tax invoice items', delegate: 'invoiceItem', group: 'Sales' },
  { key: 'serviceInvoices', label: 'Service invoices', delegate: 'serviceInvoice', group: 'Sales' },
  { key: 'serviceInvoiceItems', label: 'Service invoice items', delegate: 'serviceInvoiceItem', group: 'Sales' },
  { key: 'packingDetails', label: 'Packing details', delegate: 'packingDetails', group: 'Sales' },
  { key: 'shipments', label: 'Shipments', delegate: 'shipment', group: 'Sales' },
  { key: 'purchaseInvoices', label: 'Purchase invoices', delegate: 'purchaseInvoice', group: 'Purchasing & accounting' },
  { key: 'purchaseInvoiceItems', label: 'Purchase invoice items', delegate: 'purchaseInvoiceItem', group: 'Purchasing & accounting' },
  { key: 'supplierPriceSupports', label: 'Supplier price support', delegate: 'supplierPriceSupport', group: 'Purchasing & accounting' },
  { key: 'supplierPriceSupportEvents', label: 'Supplier price support history', delegate: 'supplierPriceSupportEvent', group: 'Purchasing & accounting' },
  { key: 'accountingHeads', label: 'Accounting heads', delegate: 'accountingHead', group: 'Purchasing & accounting' },
  { key: 'journalEntries', label: 'Journal entries', delegate: 'journalEntry', group: 'Purchasing & accounting' },
  { key: 'journalLines', label: 'Journal lines', delegate: 'journalLine', group: 'Purchasing & accounting' },
  { key: 'documentSequences', label: 'Document numbering', delegate: 'documentSequence', idField: 'key', group: 'Purchasing & accounting' },
  { key: 'users', label: 'Users (no passwords)', delegate: 'user', group: 'System', exclude: ['passwordHash', 'sessionVersion'] },
  { key: 'companySettings', label: 'Company settings (no SMTP password)', delegate: 'companySettings', group: 'System', exclude: ['smtpPassword'] },
  { key: 'emailTemplates', label: 'Email templates', delegate: 'emailTemplate', idField: 'key', group: 'System' },
  { key: 'auditLogs', label: 'Audit logs', delegate: 'auditLog', group: 'System' },
];

/** Not exported on purpose (shown to the user so nothing is a surprise). */
export const NOT_INCLUDED = [
  'Passwords, depot access codes, API keys and other credentials (never exported)',
  'Uploaded files and photos (they live in Cloudinary, not in the database)',
  'OCR intake records and raw OCR results',
  'Email delivery logs, notifications and sign-in rate-limit state',
];

const PAGE = 2000;

const scrub = (row: Record<string, unknown>, exclude: string[] = []) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (exclude.includes(k) || SECRET_NAME.test(k)) continue;
    out[k] = v;
  }
  return out;
};

const delegateOf = (t: TableDef): any => (prisma as any)[t.delegate];

export async function countTables(): Promise<{ key: string; label: string; group: string; count: number }[]> {
  return Promise.all(TABLES.map(async (t) => ({ key: t.key, label: t.label, group: t.group, count: await delegateOf(t).count().catch(() => 0) })));
}

/** Reads a table in pages so memory stays flat however large it is. */
export async function* readTable(t: TableDef): AsyncGenerator<Record<string, unknown>[]> {
  const idField = t.idField || 'id';
  let cursor: unknown;
  for (;;) {
    const rows: any[] = await delegateOf(t).findMany({ take: PAGE, orderBy: { [idField]: 'asc' }, ...(cursor !== undefined ? { skip: 1, cursor: { [idField]: cursor } } : {}) });
    if (!rows.length) return;
    yield rows.map((r) => scrub(r, t.exclude));
    if (rows.length < PAGE) return;
    cursor = rows[rows.length - 1][idField];
  }
}

export interface ExportMeta { generatedAt: string; app: string; kind: 'application-data-export'; notADatabaseBackup: true; tables: string[]; excludedByDesign: string[] }

/** Streams the complete export as one JSON document. `done` receives row counts and bytes written once it has finished. */
export function jsonExportStream(done: (r: { rowCounts: Record<string, number>; bytes: number; error?: string }) => void): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const rowCounts: Record<string, number> = {};
  let bytes = 0;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (s: string) => { const b = enc.encode(s); bytes += b.length; controller.enqueue(b); };
      try {
        const meta: ExportMeta = { generatedAt: new Date().toISOString(), app: 'ARIB GLOBAL', kind: 'application-data-export', notADatabaseBackup: true, tables: TABLES.map((t) => t.key), excludedByDesign: NOT_INCLUDED };
        write(`{"meta":${JSON.stringify(meta)},"data":{`);
        let firstTable = true;
        for (const t of TABLES) {
          write(`${firstTable ? '' : ','}${JSON.stringify(t.key)}:[`);
          firstTable = false;
          let n = 0;
          for await (const batch of readTable(t)) {
            write((n ? ',' : '') + batch.map((r) => JSON.stringify(r)).join(','));
            n += batch.length;
          }
          rowCounts[t.key] = n;
          write(']');
        }
        write(`},"rowCounts":${JSON.stringify(rowCounts)}}`);
        controller.close();
        done({ rowCounts, bytes });
      } catch (e: any) {
        controller.error(e);
        done({ rowCounts, bytes, error: e?.message || 'export failed' });
      }
    },
  });
}

/** Workbook rows for the Excel version: one sheet per table. Refuses sizes Excel cannot hold, rather than cutting data. */
export const XLSX_MAX_ROWS = 300_000;
export async function workbookSheets(): Promise<{ sheets: { name: string; head: string[]; rows: (string | number | boolean | null)[][] }[]; rowCounts: Record<string, number> }> {
  const sheets: { name: string; head: string[]; rows: (string | number | boolean | null)[][] }[] = [];
  const rowCounts: Record<string, number> = {};
  let total = 0;
  for (const t of TABLES) {
    const all: Record<string, unknown>[] = [];
    for await (const batch of readTable(t)) {
      all.push(...batch);
      total += batch.length;
      if (total > XLSX_MAX_ROWS) throw new Error(`The data is too large for an Excel workbook (over ${XLSX_MAX_ROWS.toLocaleString()} rows). Use the JSON export, which has no size limit.`);
    }
    rowCounts[t.key] = all.length;
    const head = Array.from(new Set(all.flatMap((r) => Object.keys(r))));
    const cell = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v).slice(0, 32000) : typeof v === 'string' ? v.slice(0, 32000) : (v as number | boolean));
    sheets.push({ name: t.label, head: head.length ? head : ['(no rows)'], rows: all.map((r) => head.map((h) => cell(r[h]) as any)) });
  }
  return { sheets, rowCounts };
}
