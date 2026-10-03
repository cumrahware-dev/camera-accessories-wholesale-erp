'use client';

import { Suspense } from 'react';
import DocumentBuilder from '@/components/documents/DocumentBuilder';

/** Direct tax invoice (no proforma). Uses the same builder and totals as proformas. */
export default function NewDirectInvoicePage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-xs text-muted">Loading invoice builder...</div>}>
      <DocumentBuilder mode="invoice" />
    </Suspense>
  );
}
