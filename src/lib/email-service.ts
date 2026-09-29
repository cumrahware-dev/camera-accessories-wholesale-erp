import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { formatUSD, formatDate } from '@/lib/utils';
import { NotificationType, EmailLog } from '@/types/erp';

// Base URL for CTA links inside transactional emails
const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';

/**
 * Configure Nodemailer transport using Environment Variables with DB Settings Fallback
 */
export async function createTransporter() {
  let host = process.env.SMTP_HOST;
  let port = Number(process.env.SMTP_PORT) || 587;
  let user = process.env.SMTP_USER;
  let pass = process.env.SMTP_PASS;
  let fromName = process.env.SMTP_FROM_NAME || 'ARIB GLOBAL ERP';
  let fromEmail = process.env.SMTP_FROM || 'contact@aribglobal.com';

  if (!user || !pass) {
    try {
      const settings = await prisma.companySettings.findUnique({ where: { id: 'global-settings' } });
      if (settings) {
        host = host || settings.smtpHost;
        port = port || settings.smtpPort;
        user = user || settings.smtpUser;
        pass = pass || settings.smtpPassword;
        fromName = fromName || settings.smtpFromName || 'ARIB GLOBAL ERP';
        fromEmail = fromEmail || settings.smtpFromEmail || 'contact@aribglobal.com';
      }
    } catch {}
  }

  const isConfigured = Boolean(user && pass && host);

  if (!isConfigured) {
    return {
      isConfigured: false,
      from: `"${fromName}" <${fromEmail}>`,
      sendMail: async (options: any) => {
        console.log('📧 [SMTP SIMULATION MODE] Email would be sent to:', options.to);
        console.log('Subject:', options.subject);
        return { messageId: `sim_${Date.now()}` };
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: host || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return {
    isConfigured: true,
    from: `"${fromName}" <${fromEmail}>`,
    sendMail: (options: any) => transporter.sendMail({ from: `"${fromName}" <${fromEmail}>`, ...options }),
  };
}

/**
 * ARIB GLOBAL Premium White Enterprise HTML Email Wrapper
 */
export function renderEmailWrapper(title: string, preheader: string, contentHtml: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111827; -webkit-font-smoothing: antialiased; }
    .container { max-width: 600px; margin: 30px auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { background-color: #005e82; padding: 24px 32px; text-align: left; }
    .header-title { color: #ffffff; font-size: 20px; font-weight: 700; margin: 0; letter-spacing: -0.02em; }
    .header-sub { color: #e6f4f8; font-size: 12px; font-weight: 500; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    .body { padding: 32px; }
    .title { font-size: 20px; font-weight: 700; color: #111827; margin-top: 0; margin-bottom: 8px; }
    .subtitle { font-size: 14px; color: #4b5563; margin-bottom: 24px; line-height: 1.5; }
    .table-card { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
    .data-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    .data-row:last-child { border-bottom: none; }
    .data-label { color: #6b7280; font-weight: 500; }
    .data-val { color: #111827; font-weight: 600; font-family: monospace; text-align: right; }
    .btn-primary { display: inline-block; background-color: #005e82; color: #ffffff !important; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px; text-align: center; margin-top: 16px; }
    .btn-primary:hover { background-color: #004b68; }
    .badge-orange { background-color: #fff0eb; color: #d9471b; border: 1px solid #ffc1ad; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
    .footer { background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div style="display:none;font-size:1px;color:#333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${preheader}
  </div>
  <div class="container">
    <div class="header">
      <div class="header-title">ARIB GLOBAL</div>
      <div class="header-sub">Camera & Cine Wholesale ERP</div>
    </div>
    <div class="body">
      ${contentHtml}
    </div>
    <div class="footer">
      ARIB GLOBAL General Trading LLC · Central Logistics Hub<br/>
      This is an automated system notification from your wholesale ERP.
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Fixed Workflow Email Recipients (Production Target)
 */
export const FIXED_RECIPIENTS = {
  SUPER_ADMIN: 'prajwal0shetty11@gmail.com',
  DEPOT: 'growthbridge16@gmail.com',
};

/**
 * Render Template: Invoice Created → Depot Team Email
 */
export function renderInvoiceCreatedDepotEmail(invoice: any): { subject: string; html: string } {
  const invoiceNum = invoice.invoiceNumber || invoice.id;
  const subject = `New Invoice Received — ${invoiceNum}`;
  const itemCount = (invoice.items || []).reduce((s: number, i: any) => s + (i.quantity || 0), 0);
  const depotName = invoice.depotName || invoice.assignedDepotName || 'Central Depot';
  const ctaUrl = `${APP_BASE_URL}/depot/pick?invoiceId=${invoice.id}`;

  const contentHtml = `
    <h1 class="title">New Invoice Received for Fulfilment</h1>
    <p class="subtitle">
      Tax Invoice <strong>${invoiceNum}</strong> has been issued and assigned to <strong>${depotName}</strong>. Please process item picking and packing.
    </p>

    <div class="table-card">
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; color:#6b7280; font-weight:500;">Invoice / Order Number</td>
          <td style="padding:10px 0; font-weight:700; font-family:monospace; color:#005e82; text-align:right;">${invoiceNum}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; color:#6b7280; font-weight:500;">Customer Name</td>
          <td style="padding:10px 0; font-weight:600; color:#111827; text-align:right;">${escapeHtml(invoice.customerCompany || invoice.customerName || 'Customer')}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; color:#6b7280; font-weight:500;">Invoice Date</td>
          <td style="padding:10px 0; color:#111827; text-align:right;">${formatDate(invoice.issueDate || invoice.createdAt)}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; color:#6b7280; font-weight:500;">Assigned Depot</td>
          <td style="padding:10px 0; font-weight:600; color:#005e82; text-align:right;">${depotName}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; color:#6b7280; font-weight:500;">Total Quantity</td>
          <td style="padding:10px 0; font-weight:600; color:#111827; text-align:right;">${(invoice.items || []).length} line items (${itemCount} total units)</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td colspan="2" style="padding:12px 0 6px 0;">
            <div style="font-weight:600; color:#111827; margin-bottom:8px; font-size:13px; text-transform:uppercase; letter-spacing:0.05em;">Order Items:</div>
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
              ${(invoice.items || [])
                .map(
                  (item: any) => `
                <tr style="border-bottom:1px solid #f1f5f9;">
                  <td style="padding:8px 0; color:#111827;">
                    <strong>${escapeHtml(item.productName || item.name || 'Product')}</strong>
                    <span style="display:block; color:#6b7280; font-size:11px; font-family:monospace;">SKU: ${escapeHtml(item.productSku || item.sku || 'N/A')}</span>
                  </td>
                  <td style="padding:8px 0; text-align:right; font-weight:700; color:#005e82; font-family:monospace; white-space:nowrap;">
                    Qty: ${item.quantity || 1}
                  </td>
                </tr>
              `
                )
                .join('')}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 0 4px 0; color:#6b7280; font-weight:600;">Total Amount</td>
          <td style="padding:12px 0 4px 0; font-weight:700; font-size:16px; color:#15803d; text-align:right;">${formatUSD(invoice.grandTotal || 0)}</td>
        </tr>
      </table>
    </div>

    <div style="background-color:#fff0eb; border:1px solid #ffc1ad; border-radius:8px; padding:12px 16px; margin-bottom:20px; font-size:13px; color:#d9471b;">
      <strong>Required Action:</strong> Pick & Pack Order — Open the Depot app to verify stock, pick serial numbers, and prepare the shipment package.
    </div>

    <div style="text-align:center;">
      <a href="${ctaUrl}" class="btn-primary" target="_blank">Open Order in Depot &rarr;</a>
    </div>
  `;

  return {
    subject,
    html: renderEmailWrapper(subject, `New invoice ${invoiceNum} received for depot fulfilment`, contentHtml),
  };
}

/**
 * Render Template: Shipment Dispatched → Super Admin Email
 */
export function renderShipmentDispatchedManagerEmail(shipment: any, invoice: any): { subject: string; html: string } {
  const invoiceNum = invoice?.invoiceNumber || shipment.invoiceNumber || 'INV-ORDER';
  const subject = `Shipment Dispatched — ${invoiceNum}`;
  const courier = shipment.courierProvider || shipment.courier || 'Express Courier';
  const awb = shipment.airwayBillNumber || shipment.trackingNumber || 'PENDING-AWB';
  const depot = shipment.depotName || invoice?.depotName || 'Central Depot';
  const ctaUrl = `${APP_BASE_URL}/shipments/${shipment.id || invoice?.id}`;
  const docLink = shipment.awbDocumentUrl || shipment.awbUrl || shipment.trackingUrl || invoice?.pdfUrl;
  const packageDetails = `${shipment.totalWeightKg || shipment.weightKg || '4.5'} kg (${shipment.packageCount || shipment.packagesCount || 1} Box/Parcel)`;

  const contentHtml = `
    <h1 class="title">Order Shipment Dispatched</h1>
    <p class="subtitle">
      Shipment for invoice <strong>${invoiceNum}</strong> has been handed over to <strong>${courier}</strong> and marked as DISPATCHED.
    </p>

    <div class="table-card">
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; color:#6b7280; font-weight:500;">Invoice / Order Number</td>
          <td style="padding:10px 0; font-weight:700; font-family:monospace; color:#005e82; text-align:right;">${invoiceNum}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; color:#6b7280; font-weight:500;">Customer Name</td>
          <td style="padding:10px 0; font-weight:600; color:#111827; text-align:right;">${escapeHtml(invoice?.customerCompany || shipment.customerCompany || shipment.customerName || 'Wholesale Client')}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; color:#6b7280; font-weight:500;">Depot Hub</td>
          <td style="padding:10px 0; font-weight:600; color:#005e82; text-align:right;">${depot}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; color:#6b7280; font-weight:500;">Shipment Date</td>
          <td style="padding:10px 0; color:#111827; text-align:right;">${formatDate(shipment.dispatchedAt || shipment.updatedAt || new Date().toISOString())}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; color:#6b7280; font-weight:500;">Courier / Shipping Provider</td>
          <td style="padding:10px 0; font-weight:600; color:#111827; text-align:right;">${courier}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; color:#6b7280; font-weight:500;">AWB / Tracking Number</td>
          <td style="padding:10px 0; font-weight:700; font-family:monospace; color:#f15a29; text-align:right;">${awb}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; color:#6b7280; font-weight:500;">Package Details</td>
          <td style="padding:10px 0; color:#111827; text-align:right;">${packageDetails}</td>
        </tr>
        <tr>
          <td style="padding:12px 0 4px 0; color:#6b7280; font-weight:600;">Total Amount</td>
          <td style="padding:12px 0 4px 0; font-weight:700; font-size:16px; color:#15803d; text-align:right;">${formatUSD(invoice?.grandTotal || shipment.grandTotal || 0)}</td>
        </tr>
      </table>
    </div>

    ${
      docLink
        ? `
      <div style="background-color:#e6f4f8; border:1px solid #b8e2f0; border-radius:8px; padding:12px 16px; margin-bottom:20px; font-size:13px; color:#005e82;">
        <strong>Airway Bill Document:</strong> <a href="${docLink}" target="_blank" style="color:#005e82; font-weight:700;">View AWB / Shipping Document &rarr;</a>
      </div>
    `
        : ''
    }

    <div style="text-align:center;">
      <a href="${ctaUrl}" class="btn-primary" target="_blank">View Shipment Details &rarr;</a>
    </div>
  `;

  return {
    subject,
    html: renderEmailWrapper(subject, `Shipment ${awb} for invoice ${invoiceNum} has been dispatched`, contentHtml),
  };
}

/**
 * Resolve Target Email Recipients (Fixed Recipients)
 */
export async function resolveRecipients(notificationType: NotificationType, depotId?: string): Promise<{ email: string; name?: string }[]> {
  if (notificationType === 'INVOICE_CREATED_DEPOT') {
    return [{ email: FIXED_RECIPIENTS.DEPOT, name: 'Depot Fulfilment Team' }];
  }

  if (notificationType === 'SHIPMENT_DISPATCHED_MANAGER') {
    return [{ email: FIXED_RECIPIENTS.SUPER_ADMIN, name: 'Super Admin' }];
  }

  return [{ email: FIXED_RECIPIENTS.SUPER_ADMIN, name: 'Super Admin' }];
}

/**
 * Idempotency Protection: Create or find existing EmailLog entry in Database
 */
async function getOrCreateEmailLog(params: {
  idempotencyKey: string;
  notificationType: NotificationType;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  relatedEntityId: string;
  relatedEntityRef: string;
}): Promise<{ log: any; isDuplicate: boolean }> {
  try {
    const existing = await prisma.emailLog.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });

    if (existing) {
      // If already sent or currently pending, treat as duplicate to avoid double emails
      if (existing.status === 'SENT' || existing.status === 'PENDING') {
        return { log: existing, isDuplicate: true };
      }
      return { log: existing, isDuplicate: false };
    }

    const log = await prisma.emailLog.create({
      data: {
        idempotencyKey: params.idempotencyKey,
        notificationType: params.notificationType,
        recipientEmail: params.recipientEmail,
        recipientName: params.recipientName || '',
        subject: params.subject,
        relatedEntityId: params.relatedEntityId,
        relatedEntityRef: params.relatedEntityRef,
        status: 'PENDING',
      },
    });

    return { log, isDuplicate: false };
  } catch (err: any) {
    // A concurrent request created the log first (unique idempotencyKey): this one is a duplicate.
    if (err?.code === 'P2002') {
      const existing = await prisma.emailLog.findUnique({ where: { idempotencyKey: params.idempotencyKey } }).catch(() => null);
      return { log: existing || { id: `log-${Date.now()}`, ...params, status: 'PENDING' }, isDuplicate: true };
    }
    console.error('Error creating EmailLog record in DB:', err);
    // Return mock log struct for fallback execution
    return {
      log: {
        id: `log-${Date.now()}`,
        idempotencyKey: params.idempotencyKey,
        notificationType: params.notificationType,
        recipientEmail: params.recipientEmail,
        recipientName: params.recipientName,
        subject: params.subject,
        relatedEntityId: params.relatedEntityId,
        relatedEntityRef: params.relatedEntityRef,
        status: 'PENDING',
      },
      isDuplicate: false,
    };
  }
}

/**
 * Update EmailLog Status in DB
 */
async function updateEmailLog(id: string, status: 'SENT' | 'FAILED', failureReason?: string) {
  try {
    await prisma.emailLog.update({
      where: { id },
      data: {
        status,
        sentAt: status === 'SENT' ? new Date() : undefined,
        failureReason: failureReason || null,
        retryCount: { increment: 1 },
      },
    });
  } catch {}
}

/**
 * Asynchronous Background Email Dispatcher (Non-Blocking)
 */
async function dispatchEmailAsync(params: {
  idempotencyKey: string;
  notificationType: NotificationType;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  html: string;
  relatedEntityId: string;
  relatedEntityRef: string;
}) {
  // Use setImmediate to ensure the caller API response returns instantly without waiting for SMTP network socket
  setImmediate(async () => {
    try {
      const { log, isDuplicate } = await getOrCreateEmailLog(params);
      if (isDuplicate) {
        console.log(`ℹ️ [IDEMPOTENCY] Email skipped (already sent/queued): ${params.idempotencyKey}`);
        return;
      }

      const transporter = await createTransporter();
      if (!transporter.isConfigured) {
        // Never report a simulated send as delivered: record it as failed so it can be retried
        // once SMTP is configured.
        await updateEmailLog(log.id, 'FAILED', 'SMTP is not configured - email was not sent');
        console.warn(`⚠️ [EMAIL NOT SENT] SMTP not configured: ${params.notificationType} -> ${params.recipientEmail}`);
        return;
      }
      await transporter.sendMail({
        to: `"${params.recipientName || 'User'}" <${params.recipientEmail}>`,
        subject: params.subject,
        html: params.html,
      });

      await updateEmailLog(log.id, 'SENT');
      console.log(`✅ [EMAIL SENT] ${params.notificationType} -> ${params.recipientEmail} (${params.relatedEntityRef})`);
    } catch (err: any) {
      console.error(`❌ [EMAIL FAILED] ${params.notificationType} -> ${params.recipientEmail}:`, err.message);
      try {
        const existing = await prisma.emailLog.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
        if (existing) {
          await updateEmailLog(existing.id, 'FAILED', err.message || 'SMTP transmission error');
        }
      } catch {}
    }
  });
}

/**
 * PUBLIC TRIGGER: Invoice Created → Depot Notification
 */
export async function triggerInvoiceCreatedDepotEmail(invoice: any) {
  if (!invoice || !invoice.id) return;
  const invoiceRef = invoice.invoiceNumber || invoice.id;
  const recipients = await resolveRecipients('INVOICE_CREATED_DEPOT', invoice.depotId);

  const { subject, html } = renderInvoiceCreatedDepotEmail(invoice);

  for (const recipient of recipients) {
    const idempotencyKey = `inv_created_${invoice.id}_${recipient.email.toLowerCase()}`;
    dispatchEmailAsync({
      idempotencyKey,
      notificationType: 'INVOICE_CREATED_DEPOT',
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      subject,
      html,
      relatedEntityId: invoice.id,
      relatedEntityRef: invoiceRef,
    });
  }
}

/**
 * PUBLIC TRIGGER: Shipment Dispatched → Manager Notification
 */
export async function triggerShipmentDispatchedManagerEmail(shipment: any, invoice?: any) {
  if (!shipment) return;
  const invoiceRef = invoice?.invoiceNumber || shipment.invoiceNumber || shipment.id;
  const recipients = await resolveRecipients('SHIPMENT_DISPATCHED_MANAGER');

  const { subject, html } = renderShipmentDispatchedManagerEmail(shipment, invoice);

  for (const recipient of recipients) {
    const idempotencyKey = `shipment_dispatched_${shipment.id || invoiceRef}_${recipient.email.toLowerCase()}`;
    dispatchEmailAsync({
      idempotencyKey,
      notificationType: 'SHIPMENT_DISPATCHED_MANAGER',
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      subject,
      html,
      relatedEntityId: shipment.id || invoice?.id || invoiceRef,
      relatedEntityRef: invoiceRef,
    });
  }
}

/**
 * PUBLIC RETRY: Re-send a failed notification log manually
 */
export async function retryEmailLog(logId: string): Promise<{ success: boolean; message: string }> {
  try {
    const log = await prisma.emailLog.findUnique({ where: { id: logId } });
    if (!log) return { success: false, message: 'Notification log not found' };

    let subject = log.subject;
    let html = '';

    if (log.notificationType === 'INVOICE_CREATED_DEPOT') {
      const invoice = await prisma.taxInvoice.findUnique({
        where: { id: log.relatedEntityId },
        include: { items: true },
      });
      if (invoice) {
        const rendered = renderInvoiceCreatedDepotEmail(invoice);
        subject = rendered.subject;
        html = rendered.html;
      }
    } else if (log.notificationType === 'SHIPMENT_DISPATCHED_MANAGER') {
      const shipment = await prisma.shipment.findUnique({ where: { id: log.relatedEntityId } });
      const invoice = shipment?.invoiceId ? await prisma.taxInvoice.findUnique({ where: { id: shipment.invoiceId } }) : null;
      if (shipment) {
        const rendered = renderShipmentDispatchedManagerEmail(shipment, invoice);
        subject = rendered.subject;
        html = rendered.html;
      }
    }

    if (!html) {
      return { success: false, message: 'Could not rebuild email template for target entity' };
    }

    const transporter = await createTransporter();
    if (!transporter.isConfigured) {
      await updateEmailLog(logId, 'FAILED', 'SMTP is not configured - email was not sent');
      return { success: false, message: 'SMTP is not configured. Add SMTP settings, then retry.' };
    }
    await transporter.sendMail({
      to: `"${log.recipientName || 'User'}" <${log.recipientEmail}>`,
      subject,
      html,
    });

    await updateEmailLog(log.id, 'SENT');
    return { success: true, message: `Email notification successfully retried and sent to ${log.recipientEmail}` };
  } catch (err: any) {
    console.error('Failed to retry email log:', err);
    await updateEmailLog(logId, 'FAILED', err.message || 'Retry failed');
    return { success: false, message: err.message || 'Retry failed due to SMTP error' };
  }
}

/**
 * PUBLIC HELP: Direct Proforma Email sender to Customer
 */
export interface SendProformaEmailResult {
  success: boolean;
  message: string;
  recipient?: string;
  /** True when SMTP isn't configured and the email was only simulated/logged. */
  simulated?: boolean;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sends a proforma quotation to the customer.
 *
 * Financials and line items are read from the database rather than taken from
 * the caller, so the email can never disagree with the stored document.
 * Every send is recorded in EmailLog so it shows up in the notifications log
 * and can be retried.
 */
export async function sendProformaEmail(
  proformaId: string,
  appUrl?: string
): Promise<SendProformaEmailResult> {
  let proforma: any = null;
  try {
    proforma = await prisma.proforma.findFirst({
      where: { OR: [{ id: proformaId }, { proformaNumber: proformaId }] },
      include: { items: true },
    });
  } catch {}

  if (!proforma) {
    proforma = dataStore.getProformaById(proformaId);
  }

  if (!proforma) {
    return { success: false, message: 'Proforma not found.' };
  }

  const recipientEmail = (proforma.customerEmail || '').trim();
  if (!recipientEmail) {
    return {
      success: false,
      message: 'This customer has no email address on record. Add one to the customer profile first.',
    };
  }

  const baseUrl = appUrl || APP_BASE_URL;
  const subject = `Proforma Invoice ${proforma.proformaNumber} — ARIB GLOBAL`;
  const ctaUrl = `${baseUrl}/quote/${proforma.id}`;

  const itemRows = (proforma.items || [])
    .map(
      (item: any) => `
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:10px 0; color:#111827;">
              ${escapeHtml(item.productName)}
              <div style="color:#6b7280; font-size:12px; font-family:monospace; margin-top:2px;">${escapeHtml(item.productSku)}</div>
            </td>
            <td style="padding:10px 8px; color:#4b5563; text-align:center;">${item.quantity}</td>
            <td style="padding:10px 0; color:#111827; font-family:monospace; text-align:right;">${formatUSD(item.totalPrice)}</td>
          </tr>`
    )
    .join('');

  const totalsRow = (label: string, value: string, emphasise = false) => `
          <tr${emphasise ? ' style="border-top:2px solid #e5e7eb;"' : ''}>
            <td colspan="2" style="padding:${emphasise ? '12px' : '6px'} 0; color:${emphasise ? '#111827' : '#6b7280'}; font-weight:${emphasise ? '700' : '500'};">${label}</td>
            <td style="padding:${emphasise ? '12px' : '6px'} 0; text-align:right; font-family:monospace; font-weight:700; color:${emphasise ? '#005e82' : '#111827'}; font-size:${emphasise ? '16px' : '14px'};">${value}</td>
          </tr>`;

  const contentHtml = `
      <h1 class="title">Proforma Invoice ${escapeHtml(proforma.proformaNumber)}</h1>
      <p class="subtitle">
        Dear ${escapeHtml(proforma.customerName)}, please find your quotation from ARIB GLOBAL below.
        This proforma is valid until ${escapeHtml(formatDate(proforma.expiryDate as any))}.
      </p>

      <div class="table-card">
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <thead>
            <tr style="border-bottom:1px solid #e5e7eb;">
              <th style="text-align:left; padding:0 0 8px; color:#6b7280; font-size:11px; text-transform:uppercase; letter-spacing:0.05em;">Item</th>
              <th style="text-align:center; padding:0 8px 8px; color:#6b7280; font-size:11px; text-transform:uppercase; letter-spacing:0.05em;">Qty</th>
              <th style="text-align:right; padding:0 0 8px; color:#6b7280; font-size:11px; text-transform:uppercase; letter-spacing:0.05em;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows || '<tr><td colspan="3" style="padding:12px 0; color:#6b7280;">No line items on this proforma.</td></tr>'}
            ${totalsRow('Subtotal', formatUSD(proforma.subtotal))}
            ${proforma.discountAmount > 0 ? totalsRow('Discount', `− ${formatUSD(proforma.discountAmount)}`) : ''}
            ${totalsRow('Tax', formatUSD(proforma.taxAmount))}
            ${proforma.shippingCost > 0 ? totalsRow('Shipping', formatUSD(proforma.shippingCost)) : ''}
            ${totalsRow('Total', formatUSD(proforma.grandTotal), true)}
          </tbody>
        </table>
      </div>

      <div style="text-align:center;">
        <a href="${ctaUrl}" class="btn-primary" target="_blank">View &amp; Download Proforma PDF &rarr;</a>
        <p style="font-size:12px; color:#6b7280; margin-top:12px;">
          You can review the full quotation, download it as a PDF, and confirm your order from that page.
        </p>
      </div>
    `;

  const html = renderEmailWrapper(subject, `Proforma ${proforma.proformaNumber} from ARIB GLOBAL`, contentHtml);

  // One log row per proforma send attempt, so repeated sends stay visible and retryable.
  const idempotencyKey = `PROFORMA_SENT_CUSTOMER:${proforma.id}:${Date.now()}`;
  let logId: string | null = null;
  try {
    const created = await prisma.emailLog.create({
      data: {
        idempotencyKey,
        notificationType: 'PROFORMA_SENT_CUSTOMER',
        recipientEmail,
        recipientName: proforma.customerName || '',
        subject,
        relatedEntityId: proforma.id,
        relatedEntityRef: proforma.proformaNumber,
        status: 'PENDING',
      },
    });
    logId = created.id;
  } catch (logErr) {
    console.warn('Could not create proforma email log:', logErr);
  }

  try {
    const transporter = await createTransporter();
    await transporter.sendMail({
      to: `"${proforma.customerName}" <${recipientEmail}>`,
      subject,
      html,
    });

    if (logId) await updateEmailLog(logId, 'SENT');

    return {
      success: true,
      recipient: recipientEmail,
      simulated: !transporter.isConfigured,
      message: transporter.isConfigured
        ? `Proforma sent to ${recipientEmail}.`
        : `SMTP is not configured, so the email was logged but not delivered. Add SMTP credentials in Settings.`,
    };
  } catch (err: any) {
    console.error('Error sending proforma email:', err);
    if (logId) await updateEmailLog(logId, 'FAILED', err?.message || 'SMTP send failed');
    return {
      success: false,
      recipient: recipientEmail,
      message: err?.message || 'The email could not be sent. Check your SMTP settings.',
    };
  }
}
