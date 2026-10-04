'use client';

import { Suspense } from 'react';
import DocumentBuilder from '@/components/documents/DocumentBuilder';

export default function NewProformaPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-xs text-muted">Loading Proforma Wizard...</div>}>
      <DocumentBuilder mode="proforma" />
    </Suspense>
  );
}
