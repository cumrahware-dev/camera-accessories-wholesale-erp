import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { confirmProforma, ServiceError } from '@/lib/services/proforma-service';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'proformas.write');
  if (!auth.ok) return auth.response;

  try {
    const proforma = await confirmProforma(id, { id: auth.user.id, name: auth.user.name, role: auth.user.role });
    return NextResponse.json({ success: true, proforma });
  } catch (error: any) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error confirming proforma:', error);
    return NextResponse.json({ error: error.message || 'Failed to confirm proforma' }, { status: 500 });
  }
}
