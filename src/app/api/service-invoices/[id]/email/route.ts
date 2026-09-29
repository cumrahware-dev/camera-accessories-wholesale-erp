import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { createTransporter, renderEmailWrapper } from '@/lib/email-service';
import { formatUSD, formatDate } from '@/lib/utils';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'service_invoices.write');
  if (!auth.ok) return auth.response;

  try {
    const invoice = await (prisma as any).serviceInvoice.findFirst({
      where: { OR: [{ id }, { invoiceNumber: id }] },
      include: { items: true, customer: true },
    });

    if (!invoice) {
      return NextResponse.json({ error: 'Service invoice not found' }, { status: 404 });
    }

    const recipient = (invoice.customerEmail || invoice.customer?.email || '').trim();
    if (!recipient) {
      return NextResponse.json({ error: 'Customer email address is required' }, { status: 400 });
    }

    const subject = `SERVICE INVOICE — ${invoice.invoiceNumber} from ARIB GLOBAL`;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const invoiceLink = `${appUrl}/service-invoices/${invoice.id}`;

    const itemsRows = (invoice.items || [])
      .map(
        (item: any) => `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0; font-weight:600; color:#111827;">${item.description}</td>
          <td style="padding:10px 0; color:#6b7280; font-family:monospace; text-align:center;">${item.category}</td>
          <td style="padding:10px 0; text-align:center; font-family:monospace;">${item.quantity}</td>
          <td style="padding:10px 0; text-align:right; font-family:monospace;">${formatUSD(item.unitPrice)}</td>
          <td style="padding:10px 0; text-align:right; font-weight:700; font-family:monospace; color:#005e82;">${formatUSD(item.totalPrice)}</td>
        </tr>
      `
      )
      .join('');

    const contentHtml = `
      <h1 class="title" style="color:#005e82;">SERVICE INVOICE</h1>
      <p class="subtitle">
        Dear <strong>${invoice.customerCompany || invoice.customerName}</strong>, please find your manual service invoice details below.
      </p>

      <div class="table-card" style="background-color:#ffffff; border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin-bottom:20px;">
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tr style="border-bottom:1px solid #e5e7eb;">
            <td style="padding:8px 0; color:#6b7280;">Service Invoice Number</td>
            <td style="padding:8px 0; font-weight:700; font-family:monospace; color:#005e82; text-align:right;">${invoice.invoiceNumber}</td>
          </tr>
          <tr style="border-bottom:1px solid #e5e7eb;">
            <td style="padding:8px 0; color:#6b7280;">Issue Date</td>
            <td style="padding:8px 0; text-align:right;">${formatDate(invoice.issueDate)}</td>
          </tr>
          <tr style="border-bottom:1px solid #e5e7eb;">
            <td style="padding:8px 0; color:#6b7280;">Payment Due Date</td>
            <td style="padding:8px 0; font-weight:600; color:#d9471b; text-align:right;">${formatDate(invoice.dueDate)}</td>
          </tr>
        </table>
      </div>

      <div style="margin-bottom:20px;">
        <h3 style="font-size:13px; font-weight:700; text-transform:uppercase; color:#6b7280; letter-spacing:0.5px; margin-bottom:8px;">Billed Service Items</h3>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid #e5e7eb; color:#6b7280; text-align:left;">
              <th style="padding:8px 0;">Description</th>
              <th style="padding:8px 0; text-align:center;">Category</th>
              <th style="padding:8px 0; text-align:center;">Qty</th>
              <th style="padding:8px 0; text-align:right;">Rate</th>
              <th style="padding:8px 0; text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>
      </div>

      <div style="background-color:#f8fafc; border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin-bottom:20px; text-align:right;">
        <div style="font-size:13px; color:#6b7280; margin-bottom:4px;">Subtotal: <strong>${formatUSD(invoice.subtotal)}</strong></div>
        ${invoice.discountAmount > 0 ? `<div style="font-size:13px; color:#15803d; margin-bottom:4px;">Discount: -${formatUSD(invoice.discountAmount)}</div>` : ''}
        ${invoice.taxAmount > 0 ? `<div style="font-size:13px; color:#6b7280; margin-bottom:4px;">Tax: +${formatUSD(invoice.taxAmount)}</div>` : ''}
        ${invoice.otherCharges > 0 ? `<div style="font-size:13px; color:#6b7280; margin-bottom:4px;">Other Charges: +${formatUSD(invoice.otherCharges)}</div>` : ''}
        <div style="font-size:18px; font-weight:700; color:#005e82; margin-top:8px;">Grand Total: ${formatUSD(invoice.grandTotal)} ${invoice.currency}</div>
      </div>

      <div style="text-align:center; margin-top:24px;">
        <a href="${invoiceLink}" class="btn-primary" style="background-color:#005e82; color:#ffffff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:700; inline-block;" target="_blank">View Service Invoice Online &rarr;</a>
      </div>
    `;

    const fullHtml = renderEmailWrapper(subject, `Service invoice ${invoice.invoiceNumber} from ARIB GLOBAL`, contentHtml);

    try {
      const transporter = await createTransporter();
      await transporter.sendMail({
        to: `"${invoice.customerCompany || invoice.customerName}" <${recipient}>`,
        subject,
        html: fullHtml,
      });

      await (prisma as any).serviceInvoice.update({
        where: { id: invoice.id },
        data: {
          emailStatus: 'SENT',
          emailSentAt: new Date(),
          status: invoice.status === 'DRAFT' ? 'SENT' : invoice.status,
        },
      });

      return NextResponse.json({
        success: true,
        simulated: !transporter.isConfigured,
        message: transporter.isConfigured
          ? `Service Invoice sent successfully to ${recipient}`
          : `SMTP is not configured, so the email was logged but not delivered. Add SMTP credentials in Settings.`,
      });
    } catch (sendErr: any) {
      await (prisma as any).serviceInvoice.update({
        where: { id: invoice.id },
        data: {
          emailStatus: 'FAILED',
        },
      });

      return NextResponse.json({ error: sendErr?.message || 'Failed to deliver invoice email' }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Error sending service invoice email:', error);
    return NextResponse.json({ error: error.message || 'Failed to send email' }, { status: 500 });
  }
}
