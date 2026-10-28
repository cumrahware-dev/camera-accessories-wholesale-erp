import { NextRequest, NextResponse } from 'next/server';
import { stampSnapshot } from '@/lib/company';
import { sendProformaEmail } from '@/lib/email-service';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi } from '@/lib/api-auth';
import { broadcastSystemEvent } from '@/lib/events-emitter';

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'proformas.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const { proformaId, proformaNumber } = body as { proformaId?: string; proformaNumber?: string };

    const identifier = proformaId || proformaNumber;
    if (!identifier) {
      return NextResponse.json({ error: 'A proformaId or proformaNumber is required.' }, { status: 400 });
    }

    let proforma: any = null;
    try {
      proforma = await prisma.proforma.findFirst({
        where: { OR: [{ id: identifier }, { proformaNumber: identifier }] },
        select: { id: true, proformaNumber: true, status: true },
      });
    } catch {}

    if (!proforma) {
      proforma = dataStore.getProformaById(identifier);
    }

    if (!proforma) {
      return NextResponse.json({ error: 'Proforma not found' }, { status: 404 });
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
        await stampSnapshot(prisma, 'proforma', proforma.id).catch(() => {});
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
      } catch (evtErr) {
        console.warn('Could not broadcast email event:', evtErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      recipient: result.recipient,
      simulated: result.simulated ?? false,
      statusChanged: Boolean(updatedProforma),
      proforma: updatedProforma,
    });
  } catch (error) {
    console.error('Error sending proforma email:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
