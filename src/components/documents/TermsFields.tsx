'use client';

import React, { useEffect, useState } from 'react';
import { CUSTOM_TERMS, DOCUMENT_TERMS_LABELS, INCOTERMS, INCOTERM_OTHER, PAYMENT_METHODS } from '@/lib/documents/terms';

export interface TermsValue {
  paymentTerms: string;
  paymentMethod: string;
  /** '' = not specified. A known code (FOB...) or custom text. */
  incoterm: string;
  incotermPlace: string;
  deliveryTerms: string;
}

const sel = 'h-11 md:h-9 w-full rounded-md border border-line bg-white px-2.5 text-xs disabled:bg-surface-muted';

/**
 * Payment terms, payment method, Incoterm + place and delivery note for one document.
 * Used by the document builder and by the proforma / draft-invoice editors, so they all behave the same.
 * Nothing here is ever pre-selected: the caller decides the starting values (e.g. the customer's own defaults).
 */
export function TermsFields({ value, onChange, disabled }: { value: TermsValue; onChange: (next: TermsValue, field: keyof TermsValue) => void; disabled?: boolean }) {
  const isPreset = (t: string) => DOCUMENT_TERMS_LABELS.includes(t);
  const [customTerms, setCustomTerms] = useState(!!value.paymentTerms && !isPreset(value.paymentTerms));
  const incIsCode = (INCOTERMS as readonly string[]).includes(value.incoterm);
  const [otherInc, setOtherInc] = useState(!!value.incoterm && !incIsCode);

  // Follow changes made from outside (e.g. the customer's defaults arriving, or a document reloading).
  useEffect(() => {
    if (value.paymentTerms) setCustomTerms(!isPreset(value.paymentTerms));
  }, [value.paymentTerms]);
  useEffect(() => {
    if (value.incoterm) setOtherInc(!(INCOTERMS as readonly string[]).includes(value.incoterm));
  }, [value.incoterm]);

  const set = (field: keyof TermsValue, v: string) => onChange({ ...value, [field]: v }, field);
  const incSelect = otherInc ? INCOTERM_OTHER : value.incoterm;
  const hasIncoterm = !!value.incoterm || otherInc;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
      <label className="flex flex-col gap-1">
        <span className="font-medium text-ink">Payment Terms</span>
        <select
          aria-label="Payment Terms"
          disabled={disabled}
          className={sel}
          value={customTerms ? CUSTOM_TERMS : value.paymentTerms}
          onChange={(e) => {
            if (e.target.value === CUSTOM_TERMS) { setCustomTerms(true); set('paymentTerms', ''); }
            else { setCustomTerms(false); set('paymentTerms', e.target.value); }
          }}
        >
          <option value="">Not specified</option>
          {DOCUMENT_TERMS_LABELS.map((t) => <option key={t} value={t}>{t}</option>)}
          <option value={CUSTOM_TERMS}>{CUSTOM_TERMS}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium text-ink">Payment Method</span>
        <select aria-label="Payment Method" disabled={disabled} className={sel} value={value.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
          <option value="">Not specified</option>
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          {value.paymentMethod && !(PAYMENT_METHODS as readonly string[]).includes(value.paymentMethod) && <option value={value.paymentMethod}>{value.paymentMethod}</option>}
        </select>
      </label>
      {customTerms && (
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-medium text-ink">Custom payment terms</span>
          <input aria-label="Custom payment terms" disabled={disabled} className={sel} value={value.paymentTerms} maxLength={120} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="e.g. 40% advance, balance before dispatch" />
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="font-medium text-ink">Incoterms</span>
        <select
          aria-label="Incoterms"
          disabled={disabled}
          className={sel}
          value={incSelect}
          onChange={(e) => {
            if (e.target.value === INCOTERM_OTHER) { setOtherInc(true); set('incoterm', ''); }
            else { setOtherInc(false); onChange({ ...value, incoterm: e.target.value, incotermPlace: e.target.value ? value.incotermPlace : '' }, 'incoterm'); }
          }}
        >
          <option value="">Not specified</option>
          {INCOTERMS.map((t) => <option key={t} value={t}>{t}</option>)}
          <option value={INCOTERM_OTHER}>{INCOTERM_OTHER}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium text-ink">Incoterm place</span>
        <input aria-label="Incoterm place" disabled={disabled || !hasIncoterm} className={sel} value={value.incotermPlace} maxLength={100} onChange={(e) => set('incotermPlace', e.target.value)} placeholder={hasIncoterm ? 'e.g. Dubai Port' : 'Choose an Incoterm first'} />
      </label>
      {otherInc && (
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-medium text-ink">Custom Incoterm</span>
          <input aria-label="Custom Incoterm" disabled={disabled} className={sel} value={value.incoterm} maxLength={40} onChange={(e) => set('incoterm', e.target.value)} placeholder="Enter the term as it should appear" />
        </label>
      )}
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="font-medium text-ink">Delivery note <span className="text-muted font-normal">(optional)</span></span>
        <input aria-label="Delivery note" disabled={disabled} className={sel} value={value.deliveryTerms} maxLength={200} onChange={(e) => set('deliveryTerms', e.target.value)} placeholder="e.g. Air freight via courier" />
      </label>
    </div>
  );
}

/** One-line summary used on review screens. */
export function termsSummary(v: TermsValue): string {
  const inc = v.incoterm ? (v.incotermPlace ? `${v.incoterm} — ${v.incotermPlace}` : v.incoterm) : 'Not specified';
  return `Terms: ${v.paymentTerms || 'Not specified'} · Method: ${v.paymentMethod || 'Not specified'} · Incoterm: ${inc}`;
}
