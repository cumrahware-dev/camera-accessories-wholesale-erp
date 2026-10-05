/**
 * Customer email templates. Admins can override subject/body per template in Settings → Email Templates
 * (stored in EmailTemplate); anything not overridden falls back to the defaults below.
 * Templates use {{variable}} placeholders and never contain customer names or document numbers.
 */
import { prisma } from '@/lib/prisma';

export type TemplateKey = 'PROFORMA' | 'TAX_INVOICE' | 'SERVICE_INVOICE' | 'SHIPMENT';

export const TEMPLATE_VARIABLES = [
  'customer_name', 'company_name', 'document_number', 'document_date', 'due_date',
  'total', 'currency', 'payment_terms', 'document_type',
  // Company details, read from Settings -> Company & Business Details (frozen on an issued document)
  'company_address', 'company_phone', 'company_email', 'company_website', 'company_trn', 'bank_details',
] as const;
export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string>>;

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  PROFORMA: 'Proforma Invoice',
  TAX_INVOICE: 'Tax Invoice',
  SERVICE_INVOICE: 'Service Invoice',
  SHIPMENT: 'Shipment notification',
};

export const DEFAULT_TEMPLATES: Record<TemplateKey, { subject: string; body: string }> = {
  PROFORMA: {
    subject: 'Proforma Invoice {{document_number}} from {{company_name}}',
    body: `Dear {{customer_name}},

Please find attached the Proforma Invoice {{document_number}} from {{company_name}}.

Total: {{currency}} {{total}}
Payment terms: {{payment_terms}}

Please review the details and let us know if you have any questions.

Regards,
{{company_name}}`,
  },
  TAX_INVOICE: {
    subject: 'Tax Invoice {{document_number}} from {{company_name}}',
    body: `Dear {{customer_name}},

Please find attached Tax Invoice {{document_number}} dated {{document_date}} from {{company_name}}.

Amount due: {{currency}} {{total}}
Due date: {{due_date}}
Payment terms: {{payment_terms}}

Please review the invoice details and contact us if any clarification is required.

Regards,
{{company_name}}`,
  },
  SERVICE_INVOICE: {
    subject: 'Service Invoice {{document_number}} from {{company_name}}',
    body: `Dear {{customer_name}},

Please find attached Service Invoice {{document_number}} from {{company_name}}.

Amount due: {{currency}} {{total}}
Due date: {{due_date}}

Please contact us if any clarification is required.

Regards,
{{company_name}}`,
  },
  SHIPMENT: {
    subject: 'Your order {{document_number}} has been shipped',
    body: `Dear {{customer_name}},

Your order {{document_number}} from {{company_name}} has been dispatched.

Regards,
{{company_name}}`,
  },
};

export const isTemplateKey = (v: unknown): v is TemplateKey => typeof v === 'string' && v in DEFAULT_TEMPLATES;

export async function getTemplate(key: TemplateKey): Promise<{ subject: string; body: string; customized: boolean }> {
  const row = await prisma.emailTemplate.findUnique({ where: { key } }).catch(() => null);
  return row ? { subject: row.subject, body: row.body, customized: true } : { ...DEFAULT_TEMPLATES[key], customized: false };
}

/** Replaces {{variable}} placeholders. Unknown placeholders are left visible so a typo is noticed in the preview. */
export function renderTemplate(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in vars ? String((vars as any)[k] ?? '') : m));
}
