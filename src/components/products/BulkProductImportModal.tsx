'use client';

import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  X,
  AlertCircle,
  Package,
  Layers,
  ArrowRight,
  RefreshCw,
  Eye,
  FileText,
  ToggleLeft,
  ToggleRight,
  PackagePlus,
  PackageCheck,
} from 'lucide-react';
import { formatUSD } from '@/lib/utils';
import { Depot } from '@/types/erp';

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ImportMode = 'CREATE' | 'UPDATE_STOCK';

interface ParsedRow {
  rowNum: number;
  sku: string;
  name: string;
  brand: string;
  model?: string;
  category: string;
  description?: string;
  barcode?: string;
  purchasePrice: number;
  wholesalePrice: number;
  sellingPrice: number;
  taxRate?: number;
  minStockLevel: number;
  trackSerial: boolean;
  imageUrl?: string;
  stock: number;
  depotBreakdown: Record<string, number>;
  isValid: boolean;
  errors: string[];
}

export default function BulkProductImportModal({
  isOpen,
  onClose,
  onSuccess,
}: BulkImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMode, setImportMode] = useState<ImportMode>('CREATE');
  const [file, setFile] = useState<File | null>(null);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [filterView, setFilterView] = useState<'ALL' | 'VALID' | 'INVALID'>('ALL');
  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<{
    total: number;
    imported: number;
    created?: number;
    updated?: number;
    failed: number;
    errors: { row: number; sku?: string; error: string }[];
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/depots')
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => setDepots(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Switch mode resets everything
  const handleModeSwitch = (mode: ImportMode) => {
    setImportMode(mode);
    setParsedRows([]);
    setFile(null);
    setImportSummary(null);
  };

  // 1. Template Downloader
  const handleDownloadTemplate = (format: 'csv' | 'xlsx') => {
    const headers =
      importMode === 'UPDATE_STOCK'
        ? ['sku', 'stock']
        : [
            'sku',
            'name',
            'brand',
            'model',
            'category',
            'description',
            'barcode',
            'purchasePrice',
            'wholesalePrice',
            'sellingPrice',
            'taxRate',
            'stock',
            'minStockLevel',
            'trackSerial',
          ];

    const sampleRows =
      importMode === 'UPDATE_STOCK'
        ? [
            { sku: 'SONY-A7M4', stock: 25 },
            { sku: 'CANON-RF-50-12', stock: 12 },
            { sku: 'RED-KOMODO-6K', stock: 8 },
          ]
        : [
            {
              sku: 'SONY-A7M4',
              name: 'Sony Alpha 7 IV Full-Frame Camera Body',
              brand: 'Sony',
              model: 'ILCE-7M4',
              category: 'Camera Bodies',
              description: '33MP Full-Frame Exmor R CMOS Sensor with 4K 60p 10-Bit Recording',
              barcode: '4548736133730',
              purchasePrice: 1800,
              wholesalePrice: 2150,
              sellingPrice: 2498,
              taxRate: 0,
              stock: 25,
              minStockLevel: 10,
              trackSerial: 'TRUE',
            },
            {
              sku: 'CANON-RF-50-12',
              name: 'Canon RF 50mm f/1.2 L USM Prime Lens',
              brand: 'Canon',
              model: 'RF5012L',
              category: 'Cinema Lenses',
              description: 'Ultra-fast prime lens with ring-type USM and weather-sealed build',
              barcode: '4549292115598',
              purchasePrice: 1650,
              wholesalePrice: 1950,
              sellingPrice: 2299,
              taxRate: 0,
              stock: 15,
              minStockLevel: 5,
              trackSerial: 'TRUE',
            },
            {
              sku: 'DJI-RONIN-RS3-PRO',
              name: 'DJI RS 3 Pro Gimbal Stabilizer Combo',
              brand: 'DJI',
              model: 'CP.RN.00000219.01',
              category: 'Gimbals & Stabilizers',
              description: 'Automated axis locks, extended carbon fiber arms, 4.5kg payload capacity',
              barcode: '6941565929600',
              purchasePrice: 650,
              wholesalePrice: 790,
              sellingPrice: 999,
              taxRate: 0,
              stock: 30,
              minStockLevel: 8,
              trackSerial: 'TRUE',
            },
          ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows, { header: headers });
    const workbook = XLSX.utils.book_new();
    const sheetName = importMode === 'UPDATE_STOCK' ? 'Stock_Update_Template' : 'Product_Import_Template';
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    const fileName =
      importMode === 'UPDATE_STOCK'
        ? `arib_global_stock_update_template.${format}`
        : `arib_global_product_import_template.${format}`;

    if (format === 'xlsx') {
      XLSX.writeFile(workbook, fileName);
    } else {
      XLSX.writeFile(workbook, fileName, { bookType: 'csv' });
    }
  };

  // 2. Process Uploaded File
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) processFile(selectedFile);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) processFile(droppedFile);
  };

  const processFile = (fileToProcess: File) => {
    setFile(fileToProcess);
    setIsParsing(true);
    setImportSummary(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (rawJson.length === 0) {
          alert('Uploaded file contains no rows or headers.');
          setIsParsing(false);
          return;
        }

        const primaryDepot = depots.find((d) => d.isCentralHub) || depots[0];
        const seenSkus = new Set<string>();

        const parsed: ParsedRow[] = rawJson.map((row, idx) => {
          const rowNum = idx + 2;
          const errors: string[] = [];

          const getVal = (...keys: string[]) => {
            for (const key of keys) {
              const matchKey = Object.keys(row).find(
                (k) => k.trim().toLowerCase().replace(/[^a-z0-9]/g, '') === key.toLowerCase().replace(/[^a-z0-9]/g, '')
              );
              if (matchKey && row[matchKey] !== undefined && row[matchKey] !== null && String(row[matchKey]).trim() !== '') {
                return String(row[matchKey]).trim();
              }
            }
            return '';
          };

          const sku = getVal('sku', 'product_sku', 'item_code', 'code').toUpperCase();

          // Validation
          if (!sku) errors.push('Missing SKU');
          if (seenSkus.has(sku)) {
            errors.push(`Duplicate SKU "${sku}" in spreadsheet`);
          } else if (sku) {
            seenSkus.add(sku);
          }

          // Smart Stock Extraction
          const depotBreakdown: Record<string, number> = {};
          let hasSpecificDepot = false;

          depots.forEach((depot) => {
            const depotCodeClean = depot.code.toLowerCase().replace('dep-', '');
            const depotNameClean = depot.name.toLowerCase().replace(/[^a-z0-9]/g, '');

            const val = getVal(
              `${depotCodeClean}Stock`,
              `${depotCodeClean}_stock`,
              `${depotNameClean}Stock`,
              depot.id,
              depot.code,
              depot.name
            );

            if (val !== '') {
              const qty = Math.max(0, parseInt(val) || 0);
              depotBreakdown[depot.id] = qty;
              hasSpecificDepot = true;
            } else {
              depotBreakdown[depot.id] = 0;
            }
          });

          const genericStockVal = getVal(
            'stock',
            'quantity',
            'qty',
            'totalStock',
            'total_stock',
            'initialStock',
            'initial_stock',
            'units',
            'count'
          );
          const genericStock = genericStockVal !== '' ? Math.max(0, parseInt(genericStockVal) || 0) : 0;

          if (!hasSpecificDepot && primaryDepot) {
            depotBreakdown[primaryDepot.id] = genericStock;
          }

          // If depotBreakdown is empty (e.g. depots didn't load), preserve the generic stock 
          // so the backend can assign it to its own primary depot.
          let totalStock = Object.values(depotBreakdown).reduce((sum, q) => sum + q, 0);
          if (totalStock === 0 && genericStock > 0 && Object.keys(depotBreakdown).length === 0) {
            totalStock = genericStock;
          }

          // Create-mode specific fields
          const name = importMode === 'CREATE' ? getVal('name', 'productName', 'title', 'item_name') : sku;
          const brand = importMode === 'CREATE' ? getVal('brand', 'manufacturer', 'make') : '—';
          const category =
            importMode === 'CREATE'
              ? getVal('category', 'categoryName', 'category_name', 'type') || 'General Optics'
              : '—';
          const model = getVal('model', 'model_number', 'series');
          const description = getVal('description', 'details', 'specs');
          const barcode = getVal('barcode', 'ean', 'upc');
          const imageUrl = '/placeholder-product.svg';

          const purchasePrice = parseFloat(getVal('purchasePrice', 'cost', 'costPrice', 'purchase_price')) || 0;
          const wholesalePrice = parseFloat(getVal('wholesalePrice', 'wholesale_price', 'price', 'wholesale')) || purchasePrice;
          const sellingPrice = parseFloat(getVal('sellingPrice', 'selling_price', 'msrp', 'retailPrice')) || wholesalePrice;
          // Optional column: blank = follow the configured default tax. An explicit 0 is a real value.
          const taxRaw = getVal('taxRate', 'tax', 'tax_rate').replace('%', '').trim();
          const taxRate = taxRaw !== '' && Number.isFinite(Number(taxRaw)) ? Number(taxRaw) : undefined;
          const minStockLevel = parseInt(getVal('minStockLevel', 'min_stock', 'reorder_level')) || 10;

          const trackSerialRaw = getVal('trackSerial', 'track_serial', 'serialTracked').toLowerCase();
          const trackSerial =
            trackSerialRaw === 'true' ||
            trackSerialRaw === 'yes' ||
            trackSerialRaw === '1' ||
            trackSerialRaw === '' ||
            trackSerialRaw === undefined;

          if (importMode === 'CREATE') {
            if (!name) errors.push('Missing Product Name');
            if (!brand) errors.push('Missing Brand');
          }

          return {
            rowNum,
            sku,
            name,
            brand,
            model,
            category,
            description,
            barcode,
            purchasePrice,
            wholesalePrice,
            sellingPrice,
            taxRate,
            minStockLevel,
            trackSerial,
            imageUrl,
            stock: totalStock,
            depotBreakdown,
            isValid: errors.length === 0,
            errors,
          };
        });

        setParsedRows(parsed);
      } catch (err: any) {
        alert(`Failed to parse file: ${err.message || 'Unknown format'}`);
      } finally {
        setIsParsing(false);
      }
    };
    reader.readAsArrayBuffer(fileToProcess);
  };

  // 3a. Confirm and Execute Bulk CREATE / UPSERT
  const handleConfirmImport = async () => {
    const validRows = parsedRows.filter((r) => r.isValid);
    if (validRows.length === 0) return;

    setIsImporting(true);
    try {
      const payload = validRows.map((r) => ({
        sku: r.sku,
        name: r.name,
        brand: r.brand,
        model: r.model,
        categoryName: r.category,
        description: r.description,
        barcode: r.barcode,
        purchasePrice: r.purchasePrice,
        wholesalePrice: r.wholesalePrice,
        sellingPrice: r.sellingPrice,
        taxRate: r.taxRate,
        minStockLevel: r.minStockLevel,
        trackSerial: r.trackSerial,
        imageUrl: '/placeholder-product.svg',
        stock: r.stock,
        depotBreakdown: r.depotBreakdown,
      }));

      const res = await fetch('/api/products/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: payload }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import request failed');

      setImportSummary({
        total: parsedRows.length,
        imported: data.importedCount || 0,
        created: data.createdCount || 0,
        updated: data.updatedCount || 0,
        failed: (data.failedCount || 0) + (parsedRows.length - validRows.length),
        errors: data.errors || [],
      });

      onSuccess();
    } catch (err: any) {
      alert(`Bulk Import Error: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  // 3b. Confirm and Execute Bulk STOCK UPDATE
  const handleConfirmStockUpdate = async () => {
    const validRows = parsedRows.filter((r) => r.isValid);
    if (validRows.length === 0) return;

    setIsImporting(true);
    try {
      const payload = validRows.map((r) => ({
        sku: r.sku,
        stock: r.stock,
        depotBreakdown: r.depotBreakdown,
      }));

      const res = await fetch('/api/products/bulk-update-stock', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: payload }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stock update failed');

      const skippedErrors = (data.skipped || []).map((s: any, i: number) => ({
        row: i + 2,
        sku: s.sku,
        error: s.reason,
      }));

      setImportSummary({
        total: parsedRows.length,
        imported: data.updatedCount || 0,
        updated: data.updatedCount || 0,
        failed: (data.skippedCount || 0) + (parsedRows.length - validRows.length),
        errors: skippedErrors,
      });

      onSuccess();
    } catch (err: any) {
      alert(`Stock Update Error: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const validCount = parsedRows.filter((r) => r.isValid).length;
  const invalidCount = parsedRows.filter((r) => !r.isValid).length;

  const displayRows = parsedRows.filter((r) => {
    if (filterView === 'VALID') return r.isValid;
    if (filterView === 'INVALID') return !r.isValid;
    return true;
  });

  const isUpdateMode = importMode === 'UPDATE_STOCK';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/50 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-5xl h-full max-h-[92vh] rounded-3xl border border-line bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="shrink-0 flex items-center justify-between p-5 border-b border-line bg-white/95 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-2xl border ${
                isUpdateMode
                  ? 'bg-amber-500/10 text-warning border-amber-500/20'
                  : 'bg-emerald-500/10 text-success border-emerald-500/20'
              }`}
            >
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-ink">
                  {isUpdateMode ? 'Bulk Stock Update' : 'Bulk Product Master Import'}
                </h3>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${
                    isUpdateMode
                      ? 'bg-amber-500/20 text-warning border-amber-500/40'
                      : 'bg-emerald-500/20 text-success border-emerald-500/40'
                  }`}
                >
                  {isUpdateMode ? 'Update Inventory' : 'Create & Update Products'}
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                {isUpdateMode
                  ? 'Update warehouse inventory quantities for existing SKUs via CSV or Excel.'
                  : 'Import product catalog master with descriptions, wholesale prices, barcodes, and initial stock.'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-muted hover:text-ink hover:bg-surface-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* Mode Switcher Tabs */}
          <div className="flex items-center justify-between gap-4 p-3 rounded-2xl bg-surface border border-line">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleModeSwitch('CREATE')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  !isUpdateMode
                    ? 'bg-primary text-white'
                    : 'text-muted hover:text-ink hover:bg-white'
                }`}
              >
                <PackagePlus className="h-4 w-4" />
                <span>1. Product Catalog Import (Create &amp; Update)</span>
              </button>

              <button
                type="button"
                onClick={() => handleModeSwitch('UPDATE_STOCK')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  isUpdateMode
                    ? 'bg-warning text-white'
                    : 'text-muted hover:text-ink hover:bg-white'
                }`}
              >
                <PackageCheck className="h-4 w-4" />
                <span>2. Fast Stock Update by SKU</span>
              </button>
            </div>

            {/* Template Downloaders */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted font-mono hidden sm:inline">Templates:</span>
              <button
                type="button"
                onClick={() => handleDownloadTemplate('csv')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-surface-muted text-ink-secondary text-xs font-mono font-medium transition-colors"
              >
                <Download className="h-3.5 w-3.5 text-primary" />
                <span>.CSV</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadTemplate('xlsx')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-surface-muted text-ink-secondary text-xs font-mono font-medium transition-colors"
              >
                <Download className="h-3.5 w-3.5 text-success" />
                <span>.XLSX</span>
              </button>
            </div>
          </div>

          {/* Import Summary Results Screen */}
          {importSummary && (
            <div className="p-5 rounded-2xl bg-surface border border-line space-y-4 animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-success border border-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-ink">Batch Import Completed</h4>
                  <p className="text-xs text-muted">
                    Processed {importSummary.total} rows from spreadsheet.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center font-mono">
                <div className="p-3 rounded-xl bg-white border border-line">
                  <div className="text-muted text-[10px]">TOTAL ROWS</div>
                  <div className="text-lg font-bold text-ink mt-0.5">{importSummary.total}</div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                  <div className="text-success text-[10px]">SUCCESSFULLY PROCESSED</div>
                  <div className="text-lg font-bold text-success mt-0.5">
                    {importSummary.imported}
                  </div>
                  {(importSummary.created !== undefined || importSummary.updated !== undefined) && (
                    <div className="text-[10px] text-success/80 mt-0.5">
                      {importSummary.created || 0} created · {importSummary.updated || 0} updated
                    </div>
                  )}
                </div>
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30">
                  <div className="text-danger text-[10px]">FAILED ROWS</div>
                  <div className="text-lg font-bold text-danger mt-0.5">{importSummary.failed}</div>
                </div>
              </div>

              {importSummary.errors.length > 0 && (
                <div className="p-3 rounded-xl bg-white border border-line space-y-2">
                  <span className="text-xs font-bold text-danger font-mono">Detailed Error Log:</span>
                  <div className="max-h-32 overflow-y-auto space-y-1 text-xs font-mono text-muted">
                    {importSummary.errors.map((err, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-muted">Row {err.row}:</span>
                        {err.sku && <span className="text-primary">[{err.sku}]</span>}
                        <span className="text-danger">{err.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Drag & Drop File Upload Area */}
          {!parsedRows.length && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-3xl p-8 sm:p-12 text-center cursor-pointer transition-all group ${
                isUpdateMode
                  ? 'border-line hover:border-amber-500 bg-surface hover:bg-surface'
                  : 'border-line hover:border-brand-500 bg-surface hover:bg-surface'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv, .xlsx, .xls"
                onChange={handleFileChange}
                className="hidden"
              />

              <div
                className={`mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-3 transition-transform group-hover:scale-110 ${
                  isUpdateMode
                    ? 'bg-amber-500/10 text-warning border border-amber-500/20'
                    : 'bg-brand-500/10 text-primary border border-brand-500/20'
                }`}
              >
                {isParsing ? (
                  <RefreshCw className="h-7 w-7 animate-spin" />
                ) : (
                  <Upload className="h-7 w-7" />
                )}
              </div>

              <h4 className="text-sm font-bold text-ink">
                {isParsing
                  ? 'Reading & Validating Spreadsheet...'
                  : 'Drop your CSV or Excel file here, or click to browse'}
              </h4>
              <p className="text-xs text-muted mt-1 max-w-md mx-auto">
                Supports standard <strong>.CSV</strong>, <strong>.XLSX</strong>, and <strong>.XLS</strong> files.
                Stock columns like <code>stock</code>, <code>quantity</code>, or <code>qty</code> are automatically recognized.
              </p>

              <div
                className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                  isUpdateMode
                    ? 'bg-surface-muted text-ink border-line group-hover:bg-warning group-hover:text-white group-hover:border-warning'
                    : 'bg-surface-muted text-ink border-line group-hover:bg-primary group-hover:text-white group-hover:border-primary'
                }`}
              >
                <span>Browse Files</span>
              </div>
            </div>
          )}

          {/* Parsed Rows Toolbar and KPI Bar */}
          {parsedRows.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-surface border border-line">
                <div className="flex items-center gap-3">
                  <div className="text-xs">
                    <span className="text-muted">File: </span>
                    <span className="font-bold text-ink font-mono">{file?.name}</span>
                  </div>
                  <button
                    onClick={() => {
                      setParsedRows([]);
                      setFile(null);
                      setImportSummary(null);
                    }}
                    className="text-[11px] text-primary hover:text-primary-hover underline font-mono"
                  >
                    Change File
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFilterView('ALL')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all ${
                      filterView === 'ALL'
                        ? 'bg-surface-muted text-ink border border-line'
                        : 'text-muted hover:text-ink'
                    }`}
                  >
                    All Rows ({parsedRows.length})
                  </button>
                  <button
                    onClick={() => setFilterView('VALID')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all ${
                      filterView === 'VALID'
                        ? 'bg-emerald-500/20 text-success border border-emerald-500/40'
                        : 'text-muted hover:text-success'
                    }`}
                  >
                    Valid ({validCount})
                  </button>
                  <button
                    onClick={() => setFilterView('INVALID')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all ${
                      filterView === 'INVALID'
                        ? 'bg-rose-500/20 text-danger border border-rose-500/40'
                        : 'text-muted hover:text-danger'
                    }`}
                  >
                    Errors ({invalidCount})
                  </button>
                </div>
              </div>

              {/* Pre-Import Preview Table */}
              <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-inner">
                <div className="overflow-x-auto max-h-[380px]">
                  <table className="w-full text-left text-xs border-collapse font-sans">
                    <thead className="sticky top-0 bg-white border-b border-line text-[10px] font-mono uppercase text-muted z-10">
                      <tr>
                        <th className="p-3 text-center w-12">Status</th>
                        <th className="p-3">SKU / Code</th>
                        {!isUpdateMode && (
                          <>
                            <th className="p-3">Product Name</th>
                            <th className="p-3">Brand & Category</th>
                            <th className="p-3 text-right">Wholesale ($)</th>
                            <th className="p-3 text-right">MSRP ($)</th>
                          </>
                        )}
                        <th className="p-3 text-center">Initial Stock</th>
                        {!isUpdateMode && (
                          <th className="p-3 text-center">Serial Track</th>
                        )}
                        <th className="p-3">Validation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line font-medium">
                      {displayRows.map((row) => (
                        <tr
                          key={row.rowNum}
                          className={
                            row.isValid
                              ? 'hover:bg-surface transition-colors'
                              : 'bg-rose-500/5 hover:bg-rose-500/10 transition-colors'
                          }
                        >
                          <td className="p-3 text-center">
                            {row.isValid ? (
                              <CheckCircle2 className="h-4 w-4 text-success mx-auto" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-danger mx-auto" />
                            )}
                          </td>
                          <td className="p-3 font-mono font-bold text-ink whitespace-nowrap">
                            {row.sku || <span className="text-danger italic">Missing</span>}
                          </td>
                          {!isUpdateMode && (
                            <>
                              <td className="p-3 max-w-xs truncate text-ink">
                                {row.name || <span className="text-danger italic">Missing</span>}
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                <span className="text-ink font-semibold">{row.brand}</span>
                                <span className="text-muted text-[10px] block font-mono">
                                  {row.category}
                                </span>
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-ink whitespace-nowrap">
                                {formatUSD(row.wholesalePrice)}
                              </td>
                              <td className="p-3 text-right font-mono text-ink-secondary whitespace-nowrap">
                                {formatUSD(row.sellingPrice)}
                              </td>
                            </>
                          )}
                          <td className="p-3 text-center font-mono text-[11px] whitespace-nowrap">
                            <span className="font-bold text-success">
                              {row.stock} units
                            </span>
                          </td>
                          {!isUpdateMode && (
                            <td className="p-3 text-center whitespace-nowrap">
                              {row.trackSerial ? (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-primary-soft text-primary border border-primary/30">
                                  Tracked
                                </span>
                              ) : (
                                <span className="text-muted text-[10px] font-mono">No</span>
                              )}
                            </td>
                          )}
                          <td className="p-3 text-[11px] max-w-xs">
                            {row.isValid ? (
                              <span className="text-success font-mono text-[10px]">
                                {isUpdateMode ? 'Ready to update stock' : 'Ready for database import'}
                              </span>
                            ) : (
                              <span className="text-danger font-mono text-[10px] line-clamp-2">
                                {row.errors.join(' • ')}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Fixed Sticky Footer */}
        <div className="shrink-0 flex items-center justify-between p-4 px-6 border-t border-line bg-white/95 backdrop-blur-md">
          <div className="text-xs text-muted">
            {parsedRows.length > 0 && (
              <span>
                <strong className="text-ink font-mono">{validCount}</strong>{' '}
                {isUpdateMode ? 'products ready to update' : 'valid products ready to import'}
                {invalidCount > 0 && (
                  <span className="text-danger ml-2">
                    ({invalidCount} invalid rows will be skipped)
                  </span>
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-line bg-surface-muted hover:bg-line text-ink-secondary text-xs font-semibold transition-colors"
            >
              {importSummary ? 'Close' : 'Cancel'}
            </button>

            {parsedRows.length > 0 && !importSummary && (
              <button
                onClick={isUpdateMode ? handleConfirmStockUpdate : handleConfirmImport}
                disabled={validCount === 0 || isImporting}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-white text-xs font-bold transition-all disabled:opacity-40 ${
                  isUpdateMode
                    ? 'bg-warning hover:bg-warning/90'
                    : 'bg-primary hover:bg-primary-hover'
                }`}
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>{isUpdateMode ? 'Updating Stocks...' : 'Writing to Database...'}</span>
                  </>
                ) : (
                  <>
                    <span>
                      {isUpdateMode
                        ? `Update Stock for ${validCount} SKUs`
                        : `Import / Update ${validCount} Products`}
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
