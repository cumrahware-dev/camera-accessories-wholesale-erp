/** Validation for the Company & Business Details form and bank accounts. Returns per-field messages the form can show. */
import 'server-only';
import { cleanText } from '@/lib/documents/terms';

export type FieldErrors = Record<string, string>;

const digitsOf = (s: string) => s.replace(/\D/g, '');
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

export const COMPANY_TEXT_FIELDS = ['companyName', 'tradingName', 'addressOffice', 'addressBuilding', 'addressStreet', 'addressArea', 'addressCity', 'addressCountry', 'poBox', 'phone', 'mobile', 'email', 'website', 'vatGstNumber', 'corporateTaxNumber', 'tradeLicenceNumber', 'dunsNumber', 'currency', 'currencySymbol', 'logoUrl', 'invoicePrefix', 'proformaPrefix'] as const;

export function validateCompany(body: any, current: any): { errors: FieldErrors; data: Record<string, any> } {
  const errors: FieldErrors = {};
  const data: Record<string, any> = {};
  const has = (k: string) => body && body[k] !== undefined;
  const text = (k: string, max: number) => { if (has(k)) data[k] = k === 'addressOffice' ? String(body[k] ?? '').split(/\r?\n/).map((l) => cleanText(l, 120)).filter(Boolean).join('\n').slice(0, 300) : cleanText(body[k], max); };

  text('companyName', 120); text('tradingName', 120); text('addressOffice', 300); text('addressBuilding', 120); text('addressStreet', 120); text('addressArea', 120);
  text('addressCity', 80); text('addressCountry', 80); text('poBox', 40); text('phone', 40); text('mobile', 40); text('email', 200); text('website', 200);
  text('vatGstNumber', 40); text('corporateTaxNumber', 40); text('tradeLicenceNumber', 40); text('dunsNumber', 40); text('logoUrl', 500);
  text('currencySymbol', 4); text('invoicePrefix', 20); text('proformaPrefix', 20);
  if (has('currency')) data.currency = cleanText(body.currency, 3).toUpperCase();

  // The record after this save, to check required fields against what will actually be stored.
  const after = { ...current, ...data };
  const req = (k: string, label: string) => { if (!String(after[k] ?? '').trim()) errors[k] = `${label} is required.`; };
  req('companyName', 'Company name'); req('addressOffice', 'Office address'); req('addressCity', 'City'); req('addressCountry', 'Country'); req('email', 'Email'); req('vatGstNumber', 'TRN / VAT registration number');

  if (after.email && !EMAIL_RE.test(after.email)) errors.email = 'Enter a valid email address.';
  for (const k of ['phone', 'mobile'] as const) {
    if (has(k) && data[k]) { const n = digitsOf(data[k]).length; if (n < 7 || n > 15 || !/^[+\d][\d\s().-]*$/.test(data[k])) errors[k] = 'Enter a valid phone number (7-15 digits).'; }
  }
  if (has('website') && data.website && !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(data.website)) errors.website = 'Enter a valid website address.';
  if (has('vatGstNumber') && data.vatGstNumber && !/^[A-Za-z0-9-]{5,30}$/.test(data.vatGstNumber)) errors.vatGstNumber = 'TRN must be 5-30 letters, digits or dashes.';
  if (has('currency') && !/^[A-Z]{3}$/.test(data.currency)) errors.currency = 'Use a 3-letter currency code, for example AED or USD.';
  if (has('invoicePrefix') && !data.invoicePrefix) errors.invoicePrefix = 'Invoice prefix is required.';
  if (has('proformaPrefix') && !data.proformaPrefix) errors.proformaPrefix = 'Proforma prefix is required.';

  // Next numbers may go up but never down: a lower number could repeat one that is already used.
  for (const [k, label] of [['invoiceNextNumber', 'Next invoice number'], ['proformaNextNumber', 'Next proforma number']] as const) {
    if (has(k)) {
      const n = Number(body[k]);
      if (!Number.isInteger(n) || n < 1) errors[k] = `${label} must be a whole number of 1 or more.`;
      else if (n < Number(current?.[k] ?? 1)) errors[k] = `${label} cannot be lower than the current ${current?.[k]}, it could repeat a number already used.`;
      else data[k] = n;
    }
  }
  return { errors, data };
}

export const BANK_FIELDS = ['label', 'bankName', 'branch', 'accountName', 'accountNumber', 'iban', 'swiftBic', 'routingCode', 'currency', 'bankAddress', 'paymentInstructions', 'otherInfo'] as const;

export function validateBank(body: any, creating: boolean): { errors: FieldErrors; data: Record<string, any> } {
  const errors: FieldErrors = {};
  const data: Record<string, any> = {};
  const has = (k: string) => body && body[k] !== undefined;
  const t = (k: string, max: number) => { if (has(k)) data[k] = cleanText(body[k], max); };
  t('label', 60); t('bankName', 120); t('branch', 120); t('accountName', 120); t('accountNumber', 40); t('routingCode', 40); t('bankAddress', 250); t('otherInfo', 300);
  if (has('paymentInstructions')) data.paymentInstructions = String(body.paymentInstructions ?? '').split(/\r?\n/).map((l) => cleanText(l, 200)).filter(Boolean).join('\n').slice(0, 500);
  if (has('iban')) data.iban = cleanText(body.iban, 40).toUpperCase();
  if (has('swiftBic')) data.swiftBic = cleanText(body.swiftBic, 15).toUpperCase().replace(/\s/g, '');
  if (has('currency')) data.currency = cleanText(body.currency, 3).toUpperCase();
  if (creating && !data.bankName) errors.bankName = 'Bank name is required.';
  if (has('bankName') && !data.bankName) errors.bankName = 'Bank name is required.';
  if (data.iban && !/^[A-Z]{2}\d{2}[A-Z0-9 ]{10,32}$/.test(data.iban)) errors.iban = 'Enter a valid IBAN (for example AE07 0331 2345 6789 0123 456).';
  if (data.swiftBic && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(data.swiftBic)) errors.swiftBic = 'SWIFT / BIC must be 8 or 11 characters.';
  if (has('currency') && data.currency && !/^[A-Z]{3}$/.test(data.currency)) errors.currency = 'Use a 3-letter currency code, for example AED or USD.';
  if (creating && !data.iban && !data.accountNumber) errors.accountNumber = 'Enter an account number or an IBAN.';
  if (has('isActive')) data.isActive = !!body.isActive;
  if (has('isDefault')) data.isDefault = !!body.isDefault;
  return { errors, data };
}
