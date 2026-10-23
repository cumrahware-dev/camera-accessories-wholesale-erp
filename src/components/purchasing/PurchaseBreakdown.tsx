'use client';
import React from 'react';
import type { PurchaseSummary } from '@/lib/purchasing/calc';
import { money } from '@/components/purchasing/parts';

const Row = ({ label, value, strong, muted, hint }: { label: string; value: string; strong?: boolean; muted?: boolean; hint?: string }) => (
  <div className={`flex justify-between gap-3 ${strong ? 'border-t border-line pt-1.5 font-semibold' : ''}`}>
    <dt className={muted ? 'text-muted' : strong ? '' : 'text-ink-secondary'}>{label}{hint && <span className="block text-[11px] font-normal text-muted">{hint}</span>}</dt>
    <dd className={`shrink-0 font-mono ${strong ? 'text-primary' : ''}`}>{value}</dd>
  </div>
);

/**
 * One breakdown of a purchase invoice, used by the form, the details page and the posting confirmation, always fed by the
 * same calculation (lib/purchasing/calc). The supplier payable and the stock (inventory) cost are separate lines.
 */
export function PurchaseBreakdown({ s, currency, includesTax }: { s: PurchaseSummary; currency: string; includesTax?: boolean }) {
  const m = (v: number) => money(v, currency);
  return (
    <dl className="space-y-1.5 text-sm">
      <Row label="Net purchase amount" value={m(s.subtotal)} hint={includesTax ? 'unit costs entered including VAT; VAT split out' : 'lines after line discounts, excl. VAT'} />
      {s.discount > 0 && <Row label="Invoice discount" value={`-${m(s.discount)}`} muted />}
      <Row label="Taxable amount" value={m(s.taxable)} muted />
      {s.vatByRate.filter((b) => b.taxRate > 0 || b.vat > 0).map((b) => <Row key={b.taxRate} label={`VAT ${b.taxRate}% on ${m(b.taxable)}`} value={m(b.vat)} />)}
      {s.vatByRate.every((b) => b.taxRate === 0 && b.vat === 0) && <Row label="VAT" value={m(0)} hint="no VAT rate on any line" />}
      <Row label="Total VAT" value={m(s.vat)} />
      {s.freight > 0 && <Row label="Freight" value={m(s.freight)} />}
      {s.otherCharges > 0 && <Row label="Other charges" value={m(s.otherCharges)} />}
      <Row strong label="Gross supplier invoice total (payable)" value={m(s.grandTotal)} />
      <div className="mt-2 space-y-1.5 rounded-lg bg-surface p-2.5">
        <Row label="Recoverable VAT (input VAT receivable)" value={m(s.recoverableVat)} muted />
        <Row label={`Non-recoverable VAT${s.nonRecoverableVatPercent > 0 ? ` (${s.nonRecoverableVatPercent}%)` : ''} added to stock cost`} value={m(s.nonRecoverableVat)} muted />
        <Row label="Inventory cost to be booked" value={m(s.inventoryCost)} hint="net amount − discount + freight + other charges + non-recoverable VAT" />
      </div>
    </dl>
  );
}
