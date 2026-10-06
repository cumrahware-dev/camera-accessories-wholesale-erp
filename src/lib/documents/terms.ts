/**
 * Payment terms, payment method and Incoterms: one place for the option lists and the wording printed on documents.
 * Safe to import from both server and client code (no server-only imports).
 *
 *  - Payment TERMS  = when payment is due (Immediate, 30 Days, ...)
 *  - Payment METHOD = how the customer pays (Wire Transfer, Cash, ...)
 *  - INCOTERM       = who carries cost/risk in transit (EXW ... CIF). Chosen by the user, never defaulted.
 */

export interface Option { value: string; label: string }

/** Customer payment-terms choices. Values already stored on customers (ADVANCE_50, CASH_IN_ADVANCE) stay valid. */
export const PAYMENT_TERMS_OPTIONS: Option[] = [
  { value: 'IMMEDIATE', label: 'Immediate' },
  { value: 'NET_7', label: '7 Days' },
  { value: 'NET_15', label: '15 Days' },
  { value: 'NET_30', label: '30 Days' },
  { value: 'NET_45', label: '45 Days' },
  { value: 'NET_60', label: '60 Days' },
  { value: 'CUSTOM', label: 'Custom' },
];
const LEGACY_TERMS_LABELS: Record<string, string> = {
  ADVANCE_50: '50% Advance, 50% on Dispatch',
  CASH_IN_ADVANCE: 'Cash in Advance',
};
export const PAYMENT_TERMS_VALUES = [...PAYMENT_TERMS_OPTIONS.map((o) => o.value), ...Object.keys(LEGACY_TERMS_LABELS)];

/** Options for a customer form: the standard list, plus a legacy value the customer already has. */
export function termsOptionsFor(current?: string): Option[] {
  return current && LEGACY_TERMS_LABELS[current] ? [...PAYMENT_TERMS_OPTIONS, { value: current, label: LEGACY_TERMS_LABELS[current] }] : PAYMENT_TERMS_OPTIONS;
}

/** The wording that goes on a document for a customer's terms (e.g. NET_30 -> "30 Days"). */
export function termsLabel(code: string | null | undefined, custom?: string | null): string {
  if (!code) return '';
  if (code === 'CUSTOM') return (custom || '').trim();
  return PAYMENT_TERMS_OPTIONS.find((o) => o.value === code)?.label ?? LEGACY_TERMS_LABELS[code] ?? '';
}

/** Labels offered when editing a document. 'Custom' means free text. */
export const DOCUMENT_TERMS_LABELS = PAYMENT_TERMS_OPTIONS.filter((o) => o.value !== 'CUSTOM').map((o) => o.label);
export const CUSTOM_TERMS = 'Custom';

export const PAYMENT_METHODS = ['Wire Transfer', 'Bank Transfer', 'Cash', 'Card', 'Other'] as const;

export const INCOTERMS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'] as const;
export const INCOTERM_OTHER = 'Other / Custom';

export const MAX_INCOTERM = 40;
export const MAX_PLACE = 100;

/** Trims, strips control characters and caps the length. */
export const cleanText = (v: unknown, max: number): string =>
  String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Normalises an Incoterm entered by a user. Known codes are upper-cased; anything else is kept as typed (custom). */
export function cleanIncoterm(v: unknown): string {
  const t = cleanText(v, MAX_INCOTERM);
  const up = t.toUpperCase();
  return (INCOTERMS as readonly string[]).includes(up) ? up : t;
}

/**
 * Old documents were created with an Incoterm/delivery wording the system filled in by itself. Those exact strings are
 * not something a person chose, so they are never shown as if they were.
 */
const AUTO_FILLED_DELIVERY = new Set(['air freight via courier (cif)', 'c&f vietnam airport', 'air freight cif']);
export const isAutoFilledDelivery = (s: unknown) => AUTO_FILLED_DELIVERY.has(String(s ?? '').trim().toLowerCase());
const AUTO_FILLED_TERMS = new Set(['net 30 days from dispatch', 'net 30 days']);

/** Delivery text safe to print: empty when it is one of the old automatic values. */
export const printableDelivery = (s: unknown) => (isAutoFilledDelivery(s) ? '' : String(s ?? '').trim());

/** "FOB — Dubai Port", "FOB", or '' when nothing was chosen. */
export function incotermLine(incoterm?: string | null, place?: string | null): string {
  const i = (incoterm || '').trim();
  const p = (place || '').trim();
  if (!i) return '';
  return p ? `${i} — ${p}` : i;
}

/** What a stored payment-terms string means for display. Empty stays empty (the caller decides how to show it). */
export const printableTerms = (s: unknown) => String(s ?? '').trim();

/** True when a stored terms value looks like the legacy automatic default (kept for reporting only). */
export const isLegacyAutoTerms = (s: unknown) => AUTO_FILLED_TERMS.has(String(s ?? '').trim().toLowerCase());

/**
 * Days until payment is due for a document's terms wording: "Immediate" / advance terms -> 0, "30 Days" -> 30.
 * null when the wording does not say (custom text, empty): the caller keeps the due date it already has.
 */
export function dueDaysForTerms(terms: string | null | undefined): number | null {
  const t = String(terms ?? '').trim().toLowerCase();
  if (!t) return null;
  if (t === 'immediate' || t.includes('in advance') || t.includes('advance')) return 0;
  const m = /^(?:net\s*)?(\d{1,3})\s*days?\b/.exec(t);
  return m ? Math.min(365, Number(m[1])) : null;
}

/** Terms + method from a customer record, as the starting values for a NEW document. */
export function defaultsFromCustomer(c: { paymentTerms?: string | null; customPaymentTerms?: string | null; paymentMethod?: string | null } | null | undefined) {
  return {
    paymentTerms: termsLabel(c?.paymentTerms, c?.customPaymentTerms),
    paymentMethod: (c?.paymentMethod || '').trim(),
  };
}

/**
 * Validates the terms/method part of a customer payload. Returns the fields to store (only those supplied),
 * or an error message for the user.
 */
export function customerTermsFromBody(body: any): { error?: string; data: { paymentTerms?: string; customPaymentTerms?: string; paymentMethod?: string } } {
  const data: { paymentTerms?: string; customPaymentTerms?: string; paymentMethod?: string } = {};
  if (body?.paymentTerms !== undefined) {
    if (!PAYMENT_TERMS_VALUES.includes(String(body.paymentTerms))) return { error: 'Choose a valid payment term.', data };
    data.paymentTerms = String(body.paymentTerms);
  }
  if (body?.customPaymentTerms !== undefined) data.customPaymentTerms = cleanText(body.customPaymentTerms, 120);
  if (data.paymentTerms === 'CUSTOM' && !(data.customPaymentTerms ?? '').trim()) return { error: 'Describe the custom payment terms.', data };
  if (data.paymentTerms && data.paymentTerms !== 'CUSTOM') data.customPaymentTerms = '';
  if (body?.paymentMethod !== undefined) {
    const m = cleanText(body.paymentMethod, 40);
    if (m && !(PAYMENT_METHODS as readonly string[]).includes(m)) return { error: 'Choose a valid payment method.', data };
    data.paymentMethod = m;
  }
  return { data };
}
