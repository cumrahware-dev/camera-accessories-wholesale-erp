import { NextRequest, NextResponse } from 'next/server';
import { stampSnapshot, validateSelectedBankAccount } from '@/lib/company';
import { sendProformaEmail } from '@/lib/email-service';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi } from '@/lib/api-auth';
import { broadcastSystemEvent } from '@/lib/events-emitter';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'proformas.write');
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    let proforma: any = null;
    try {
      proforma = await prisma.proforma.findFirst({
        where: { OR: [{ id }, { proformaNumber: id }] },
        select: { id: true, proformaNumber: true, status: true, bankAccountId: true, currency: true },
      });
    } catch {}

    if (!proforma) {
      proforma = dataStore.getProformaById(id);
    }

    if (!proforma) {
      return NextResponse.json({ error: 'Proforma quotation not found' }, { status: 404 });
    }

    if (proforma.status === 'DRAFT') {
      if (!proforma.bankAccountId) {
        return NextResponse.json({ error: 'Select a bank account for this proforma before sending it.' }, { status: 400 });
      }
      const bankCheck = await validateSelectedBankAccount(prisma, proforma.bankAccountId, proforma.currency);
      if ('error' in bankCheck) return NextResponse.json({ error: bankCheck.error }, { status: 400 });
    }

    // The link in the email comes from the configured public address (APP_BASE_URL), never from the request.
    const result = await sendProformaEmail(proforma.id);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 502 });
    }

    let updatedProforma = null;
    if (proforma.status === 'DRAFT') {
      try {
        updatedProforma = await prisma.proforma.update({
          where: { id: proforma.id },
          data: { status: 'SENT' },
        });
        await stampSnapshot(prisma, 'proforma', proforma.id, proforma.bankAccountId).catch(() => {});
      } catch {}

      dataStore.updateProforma(proforma.id, { status: 'SENT' });
      if (!updatedProforma) {
        updatedProforma = dataStore.getProformaById(proforma.id);
      }

      try {
        broadcastSystemEvent({
          type: 'PROFORMA_UPDATED',
          id: proforma.id,
          proformaNumber: proforma.proformaNumber,
          status: 'SENT',
          data: updatedProforma,
        });
      } catch {}
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      recipient: result.recipient,
      simulated: result.simulated ?? false,
      statusChanged: Boolean(updatedProforma),
      proforma: updatedProforma,
    });
  } catch (error: any) {
    console.error('Error sending proforma email:', error);
    return NextResponse.json({ error: error.message || 'Failed to send email' }, { status: 500 });
  }
}
