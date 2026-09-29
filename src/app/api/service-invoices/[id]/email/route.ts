import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { sendServiceInvoiceEmail } from '@/lib/email-service';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.write');
  if (!auth.ok) return auth.response;

  try {
    const result = await sendServiceInvoiceEmail(id);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      simulated: result.simulated ?? false,
    });
  } catch (error: any) {
    console.error('Error sending service invoice email:', error);
    return NextResponse.json({ error: error.message || 'Failed to send email' }, { status: 500 });
  }
}
