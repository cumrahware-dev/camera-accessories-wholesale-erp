/**
 * Customer document email delivery (Proforma / Tax Invoice / Service Invoice).
 *
 *   prepareEmail  -> recipient (the customer's email in the ERP), template-rendered subject/body, attachment name
 *   queueEmail    -> validates, writes an EmailLog row (PENDING) and returns at once; the document is untouched
 *   processEmailLog (background) -> SENDING -> builds the PDF -> SMTP -> SENT (with provider message id) | FAILED
 *   retryEmail    -> re-sends the SAME log row; never creates a document or a number
 *
 * A document is marked Sent only after the mail server accepted the message. Email failures never roll back
 * or block the document itself.
 */
import 'server-only';
import { after } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { createTransporter, renderEmailWrapper } from '@/lib/email-service';
import { broadcastSystemEvent } from '@/lib/events-emitter';
import { writeAudit } from '@/lib/audit';
import type { Permission } from '@/lib/rbac';
import { buildDocumentPdf, documentNumberOf, pdfFileName, type DocType } from './pdf';
import { portalUrl } from '@/lib/documents/share-token';
import { getTemplate, renderTemplate, type TemplateVars } from './templates';

export type { DocType };
export const DOC_TYPES: DocType[] = ['PROFORMA', 'TAX_INVOICE', 'SERVICE_INVOICE'];
export const isDocType = (v: unknown): v is DocType => typeof v === 'string' && (DOC_TYPES as string[]).includes(v);

export const DOC_PERMISSIONS: Record<DocType, { read: Permission; write: Permission; label: string }> = {
  PROFORMA: { read: 'proformas.read', write: 'proformas.write', label: 'Proforma Invoice' },
  TAX_INVOICE: { read: 'invoices.read', write: 'invoices.write', label: 'Tax Invoice' },
  SERVICE_INVOICE: { read: 'service_invoices.read', write: 'service_invoices.write', label: 'Service Invoice' },
};

export class EmailError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

interface Sender { id: string; name: string; role: string }

const SEND_TIMEOUT_MS = 60_000;
const STUCK_SENDING_MS = 3 * 60_000;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
const log = (msg: string) => console.log(`[Email] ${msg}`);

// ── documents ───────────────────────────────────────────────────────────────
export async function loadDocument(type: DocType, id: string): Promise<any | null> {
  const where = { OR: [{ id }, type === 'PROFORMA' ? { proformaNumber: id } : { invoiceNumber: id }] } as any;
  const include = { items: true, customer: { select: { id: true, email: true, companyName: true, contactPerson: true } } };
  if (type === 'PROFORMA') return prisma.proforma.findFirst({ where, include });
  if (type === 'TAX_INVOICE') return prisma.taxInvoice.findFirst({ where, include });
  return prisma.serviceInvoice.findFirst({ where, include });
}

/** Why this document may not be emailed right now (null = it may). */
function blockedReason(type: DocType, doc: any): string | null {
  if (type === 'PROFORMA') {
    if (doc.status === 'CANCELLED') return 'A cancelled proforma cannot be emailed.';
    if (doc.status === 'CONVERTED') return `This proforma was converted to tax invoice ${doc.convertedToInvoiceNumber || ''}. Send the tax invoice instead.`;
  }
  if (type === 'TAX_INVOICE') {
    if (doc.documentStatus === 'DRAFT') return 'Issue the invoice before sending it to the customer.';
    if (doc.documentStatus === 'CANCELLED' || doc.fulfilmentStatus === 'CANCELLED') return 'A cancelled invoice cannot be emailed.';
  }
  if (type === 'SERVICE_INVOICE' && doc.status === 'CANCELLED') return 'A cancelled service invoice cannot be emailed.';
  return null;
}

/** The customer's CURRENT email in the ERP (the customer record), falling back to the copy on the document. */
const customerEmailOf = (doc: any) => String(doc.customer?.email || doc.customerEmail || '').trim();

async function companyName(): Promise<string> {
  const s = await prisma.companySettings.findUnique({ where: { id: 'global-settings' }, select: { companyName: true } }).catch(() => null);
  return s?.companyName || 'ARIB GLOBAL';
}

const fmtDate = (d: unknown) => {
  const v = d ? new Date(d as any) : null;
  return v && !isNaN(v.getTime()) ? v.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
};
const fmtNum = (n: unknown) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function varsFor(type: DocType, doc: any, company: string): TemplateVars {
  return {
    customer_name: doc.customerName || doc.customer?.contactPerson || doc.customerCompany || 'Customer',
    company_name: company,
    document_number: documentNumberOf(type, doc),
    document_date: fmtDate(type === 'TAX_INVOICE' && doc.issuedAt ? doc.issuedAt : doc.issueDate),
    due_date: fmtDate(type === 'PROFORMA' ? doc.expiryDate : doc.dueDate),
    total: fmtNum(doc.grandTotal),
    currency: doc.currency || 'USD',
    payment_terms: doc.paymentTerms || '',
    document_type: DOC_PERMISSIONS[type].label,
  };
}

const escapeHtml = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The HTML the customer receives: the (possibly edited) message text plus a fixed summary of the document. */
export function renderEmailHtml(type: DocType, doc: any, subject: string, bodyText: string, attachmentName: string): string {
  const paragraphs = escapeHtml(bodyText).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px; font-size:14px; line-height:1.6; color:#111827;">${p.replace(/\n/g, '<br/>')}</p>`).join('');
  const row = (k: string, v: string) => `<tr><td style="padding:6px 0; color:#6b7280; font-size:13px;">${k}</td><td style="padding:6px 0; text-align:right; font-weight:600; font-size:13px; color:#111827;">${escapeHtml(v)}</td></tr>`;
  const summary = `
    <div class="table-card"><table style="width:100%; border-collapse:collapse;">
      ${row(DOC_PERMISSIONS[type].label, documentNumberOf(type, doc))}
      ${row('Date', fmtDate(type === 'TAX_INVOICE' && doc.issuedAt ? doc.issuedAt : doc.issueDate))}
      ${row('Total', `${doc.currency || 'USD'} ${fmtNum(doc.grandTotal)}`)}
    </table></div>
    ${type === 'TAX_INVOICE' ? `<div style="text-align:center; margin:18px 0 6px;"><a href="${portalUrl('TAX_INVOICE', doc.id)}" class="btn-primary" target="_blank">View Invoice Online &rarr;</a></div>` : ''}
    <p style="font-size:12px; color:#6b7280; margin:0;">Attachment: ${escapeHtml(attachmentName)}</p>`;
  return renderEmailWrapper(subject, `${DOC_PERMISSIONS[type].label} ${documentNumberOf(type, doc)}`, paragraphs + summary);
}

// ── prepare (preview) ───────────────────────────────────────────────────────
export async function prepareEmail(type: DocType, id: string) {
  const doc = await loadDocument(type, id);
  if (!doc) throw new EmailError(404, `${DOC_PERMISSIONS[type].label} not found.`);
  const company = await companyName();
  const tpl = await getTemplate(type);
  const vars = varsFor(type, doc, company);
  const subject = renderTemplate(tpl.subject, vars);
  const body = renderTemplate(tpl.body, vars);
  const attachmentName = pdfFileName(type, doc, company);
  const to = customerEmailOf(doc);
  const transporter = await createTransporter();
  return {
    documentType: type,
    documentId: doc.id,
    documentNumber: documentNumberOf(type, doc),
    customerId: doc.customerId,
    customerName: doc.customerCompany || doc.customerName,
    to,
    missingEmail: !to,
    invalidEmail: !!to && !EMAIL_RE.test(to),
    blockedReason: blockedReason(type, doc),
    emailConfigured: transporter.isConfigured,
    subject,
    body,
    attachmentName,
    previewHtml: renderEmailHtml(type, doc, subject, body, attachmentName),
  };
}

function emailList(v: unknown, label: string, max = 5): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\s]+/) : [];
  const list = Array.from(new Set(raw.map((x) => String(x).trim().toLowerCase()).filter(Boolean)));
  if (list.length > max) throw new EmailError(400, `${label}: at most ${max} addresses.`);
  const bad = list.find((e) => !EMAIL_RE.test(e));
  if (bad) throw new EmailError(400, `${label}: "${bad}" is not a valid email address.`);
  return list;
}

// ── queue ───────────────────────────────────────────────────────────────────
export async function queueEmail(
  input: { type: DocType; id: string; to?: string; cc?: unknown; bcc?: unknown; subject?: string; body?: string },
  sender: Sender,
  canOverride: boolean
) {
  const doc = await loadDocument(input.type, input.id);
  if (!doc) throw new EmailError(404, `${DOC_PERMISSIONS[input.type].label} not found.`);
  const blocked = blockedReason(input.type, doc);
  if (blocked) throw new EmailError(409, blocked);

  const customerEmail = customerEmailOf(doc);
  const requested = String(input.to ?? '').trim().toLowerCase();
  if (!customerEmail && !requested) {
    throw new EmailError(400, 'Customer email address is missing.', { code: 'missing_email', customerId: doc.customerId });
  }
  const to = requested || customerEmail.toLowerCase();
  if (to !== customerEmail.toLowerCase() && !canOverride) {
    throw new EmailError(403, "Only a manager can send this document to an address other than the customer's email.");
  }
  if (!EMAIL_RE.test(to)) throw new EmailError(400, `"${to}" is not a valid email address.`, { code: 'invalid_email', customerId: doc.customerId });
  const cc = emailList(input.cc, 'CC').filter((e) => e !== to);
  const bcc = emailList(input.bcc, 'BCC');
  if (bcc.length && !canOverride) throw new EmailError(403, 'Only a manager can add BCC recipients.');

  const subject = String(input.subject ?? '').trim();
  const body = String(input.body ?? '').trim();
  if (!subject || subject.length > 250) throw new EmailError(400, 'Enter a subject (up to 250 characters).');
  if (!body || body.length > 10_000) throw new EmailError(400, 'Enter a message (up to 10,000 characters).');

  const company = await companyName();
  const number = documentNumberOf(input.type, doc);
  const row = await prisma.emailLog.create({
    data: {
      idempotencyKey: `DOC:${input.type}:${doc.id}:${randomUUID()}`,
      notificationType: 'DOCUMENT_EMAIL',
      documentType: input.type,
      recipientEmail: to,
      recipientName: doc.customerCompany || doc.customerName || '',
      ccEmails: cc,
      bccEmails: bcc,
      subject,
      bodyText: body,
      attachmentName: pdfFileName(input.type, doc, company),
      relatedEntityId: doc.id,
      relatedEntityRef: number,
      status: 'PENDING',
      sentById: sender.id,
      sentByName: sender.name,
    },
  });
  log(`queued ${row.id} | ${input.type} ${number} -> ${to}${cc.length ? ` (+${cc.length} cc)` : ''}`);
  schedule(row.id);
  return row;
}

/** Runs the send after the HTTP response; `after` keeps a serverless function alive until it finishes. */
function schedule(id: string) {
  const run = () => processEmailLog(id).catch((e) => console.error(`[Email] worker crashed for ${id}:`, e?.message));
  try { after(run); } catch { setImmediate(run); }
}

function friendlyError(e: any): string {
  const code = String(e?.code || '');
  const rc = Number(e?.responseCode) || 0;
  if (e?.friendly) return e.message;
  if (code === 'EAUTH') return 'The mail server rejected the login. Check SMTP_USER / SMTP_PASSWORD.';
  if (['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'EDNS', 'ECONNREFUSED'].includes(code)) return 'Could not reach the mail server (network error or timeout). Retry in a moment.';
  if (code === 'EENVELOPE') return 'The mail server rejected the recipient address.';
  if (rc >= 500) return `The mail server rejected the message: ${String(e?.response || e?.message).slice(0, 200)}`;
  if (rc >= 400) return `The mail server temporarily refused the message: ${String(e?.response || e?.message).slice(0, 200)}`;
  return String(e?.message || 'Unknown error while sending.').slice(0, 300);
}
const fail = (message: string) => Object.assign(new Error(message), { friendly: true });

// ── worker ──────────────────────────────────────────────────────────────────
export async function processEmailLog(id: string) {
  const claim = await prisma.emailLog.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'SENDING', failureReason: null } });
  if (claim.count !== 1) return; // someone else is sending it, or it is already finished
  const row = await prisma.emailLog.findUniqueOrThrow({ where: { id } });
  const type = row.documentType as DocType;
  log(`sending ${id} | ${type} ${row.relatedEntityRef} -> ${row.recipientEmail}`);
  const actor = await actorOf(row.sentById, row.sentByName);
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    if (!isDocType(type)) throw fail('This log entry is not a document email.');
    const doc = await loadDocument(type, row.relatedEntityId);
    if (!doc) throw fail('The document no longer exists.');
    const transporter = await createTransporter();
    if (!transporter.isConfigured) throw fail('Email is not configured on the server (SMTP settings are missing), so nothing was sent.');

    let pdf: { buffer: Buffer; fileName: string };
    try {
      pdf = await buildDocumentPdf(type, doc);
    } catch (e: any) {
      throw fail(`The PDF could not be generated, so the email was not sent (${e?.message || 'unknown error'}).`);
    }
    if (!pdf.buffer.length) throw fail('The PDF attachment is empty, so the email was not sent.');

    const html = renderEmailHtml(type, doc, row.subject, row.bodyText || '', pdf.fileName);
    const info: any = await Promise.race([
      transporter.sendMail({
        to: row.recipientEmail,
        cc: row.ccEmails.length ? row.ccEmails : undefined,
        bcc: row.bccEmails.length ? row.bccEmails : undefined,
        subject: row.subject,
        text: row.bodyText || '',
        html,
        attachments: [{ filename: pdf.fileName, content: pdf.buffer, contentType: 'application/pdf' }],
      }),
      new Promise((_, rej) => { timer = setTimeout(() => rej(fail('The mail server did not answer in time. Retry in a moment.')), SEND_TIMEOUT_MS); }),
    ]);
    const accepted: string[] = (info?.accepted || []).map(String);
    if (!accepted.some((a) => a.toLowerCase().includes(row.recipientEmail.toLowerCase()))) {
      throw fail(`The mail server did not accept ${row.recipientEmail}${info?.rejected?.length ? ' (rejected)' : ''}.`);
    }

    await prisma.emailLog.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date(), providerMessageId: info?.messageId ? String(info.messageId) : null, attachmentName: pdf.fileName, failureReason: null },
    });
    log(`SENT ${id} | ${type} ${row.relatedEntityRef} -> ${row.recipientEmail} | messageId=${info?.messageId || 'n/a'}`);
    await markDocumentSent(type, doc, row, actor);
  } catch (e: any) {
    const reason = friendlyError(e);
    await prisma.emailLog.update({ where: { id }, data: { status: 'FAILED', failureReason: reason } }).catch(() => {});
    console.warn(`[Email] FAILED ${id} | ${type} ${row.relatedEntityRef} -> ${row.recipientEmail} | ${reason}`);
    if (actor) {
      await writeAudit(actor, {
        action: 'EMAIL_FAILED', entityType: type === 'PROFORMA' ? 'Proforma' : type === 'TAX_INVOICE' ? 'TaxInvoice' : 'ServiceInvoice',
        entityId: row.relatedEntityId, entityLabel: row.relatedEntityRef, description: `Email of ${row.relatedEntityRef} to ${row.recipientEmail} failed: ${reason}`,
      });
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function actorOf(id?: string | null, name?: string | null): Promise<Sender | null> {
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, role: true } }).catch(() => null);
  return u ? { id: u.id, name: u.name, role: u.role } : { id, name: name || 'User', role: 'ERP_USER' };
}

/** Only called after the provider accepted the email. Proforma DRAFT -> SENT, invoice ISSUED -> SENT. */
async function markDocumentSent(type: DocType, doc: any, row: { id: string; recipientEmail: string; relatedEntityRef: string }, actor: Sender | null) {
  const now = new Date();
  const earlier = await prisma.emailLog.count({ where: { relatedEntityId: doc.id, documentType: type, status: 'SENT', id: { not: row.id } } });
  try {
    if (type === 'PROFORMA') {
      await prisma.proforma.update({ where: { id: doc.id }, data: { lastEmailedAt: now } });
      const moved = await prisma.proforma.updateMany({ where: { id: doc.id, status: 'DRAFT' }, data: { status: 'SENT' } });
      if (moved.count) broadcastSystemEvent({ type: 'PROFORMA_UPDATED', id: doc.id, proformaNumber: doc.proformaNumber, status: 'SENT', data: { ...doc, status: 'SENT' } });
    } else if (type === 'TAX_INVOICE') {
      await prisma.taxInvoice.update({ where: { id: doc.id }, data: { lastEmailedAt: now } });
      await prisma.taxInvoice.updateMany({ where: { id: doc.id, documentStatus: 'ISSUED' }, data: { documentStatus: 'SENT' } });
    } else {
      await prisma.serviceInvoice.update({ where: { id: doc.id }, data: { emailStatus: 'SENT', emailSentAt: now } });
      await prisma.serviceInvoice.updateMany({ where: { id: doc.id, status: 'DRAFT' }, data: { status: 'SENT' } });
    }
  } catch (e: any) {
    console.warn('[Email] sent, but the document status could not be updated:', e?.message);
  }
  if (actor) {
    const action = earlier > 0 ? 'EMAIL_RESENT' : type === 'PROFORMA' ? 'PROFORMA_SENT' : type === 'TAX_INVOICE' ? 'TAX_INVOICE_EMAILED' : 'SERVICE_INVOICE_EMAILED';
    await writeAudit(actor, {
      action, entityType: type === 'PROFORMA' ? 'Proforma' : type === 'TAX_INVOICE' ? 'TaxInvoice' : 'ServiceInvoice',
      entityId: doc.id, entityLabel: row.relatedEntityRef, description: `${DOC_PERMISSIONS[type].label} ${row.relatedEntityRef} emailed to ${row.recipientEmail}${earlier ? ' (resent)' : ''}`,
    });
  }
}

// ── retry / history ─────────────────────────────────────────────────────────
export async function retryEmail(logId: string, sender: Sender) {
  const row = await prisma.emailLog.findUnique({ where: { id: logId } });
  if (!row || !isDocType(row.documentType)) throw new EmailError(404, 'Email not found.');
  if (row.status !== 'FAILED') throw new EmailError(409, row.status === 'SENT' ? 'This email was already sent. Use Resend to send it again.' : 'This email is still being sent.');
  const doc = await loadDocument(row.documentType, row.relatedEntityId);
  if (!doc) throw new EmailError(404, 'The document no longer exists.');
  const blocked = blockedReason(row.documentType, doc);
  if (blocked) throw new EmailError(409, blocked);

  const claim = await prisma.emailLog.updateMany({ where: { id: logId, status: 'FAILED' }, data: { status: 'PENDING', retryCount: { increment: 1 }, failureReason: null } });
  if (claim.count !== 1) throw new EmailError(409, 'This email is already being retried.');
  await writeAudit(sender, {
    action: 'EMAIL_RETRIED', entityType: row.documentType === 'PROFORMA' ? 'Proforma' : row.documentType === 'TAX_INVOICE' ? 'TaxInvoice' : 'ServiceInvoice',
    entityId: row.relatedEntityId, entityLabel: row.relatedEntityRef, description: `Retrying email of ${row.relatedEntityRef} to ${row.recipientEmail}`,
  });
  schedule(logId);
  return prisma.emailLog.findUniqueOrThrow({ where: { id: logId } });
}

export async function listDocumentEmails(type: DocType, documentId: string) {
  const doc = await loadDocument(type, documentId);
  if (!doc) throw new EmailError(404, `${DOC_PERMISSIONS[type].label} not found.`);
  const rows = await prisma.emailLog.findMany({ where: { relatedEntityId: doc.id, documentType: type }, orderBy: { createdAt: 'desc' }, take: 50 });
  // Self-healing: a send interrupted mid-way (restart / crash) must not stay "Sending" forever.
  const now = Date.now();
  for (const r of rows) {
    if (r.status === 'SENDING' && now - r.updatedAt.getTime() > STUCK_SENDING_MS) {
      await prisma.emailLog.updateMany({ where: { id: r.id, status: 'SENDING' }, data: { status: 'FAILED', failureReason: 'Sending did not finish (the server was interrupted). Retry the email.' } });
      r.status = 'FAILED';
      r.failureReason = 'Sending did not finish (the server was interrupted). Retry the email.';
    } else if (r.status === 'PENDING' && now - r.createdAt.getTime() > 30_000) {
      schedule(r.id); // queued but never picked up: start it now (the atomic claim prevents a double send)
    }
  }
  return rows;
}

export async function getEmailLog(id: string) {
  const row = await prisma.emailLog.findUnique({ where: { id } });
  if (!row || !isDocType(row.documentType)) throw new EmailError(404, 'Email not found.');
  return row;
}
