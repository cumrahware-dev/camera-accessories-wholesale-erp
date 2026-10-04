import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { writeAudit } from '@/lib/audit';
import { guardApi } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';
import { createProforma, ServiceError } from '@/lib/services/proforma-service';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'proformas.read');
  if (!auth.ok) return auth.response;

  try {
    const q = req.nextUrl.searchParams.get('q')?.trim();
    const status = req.nextUrl.searchParams.get('status')?.trim();
    const { take, skip } = parsePagination(req);

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }
    if (q) {
      where.OR = [
        { proformaNumber: { contains: q, mode: 'insensitive' as const } },
        { customerCompany: { contains: q, mode: 'insensitive' as const } },
        { customerName: { contains: q, mode: 'insensitive' as const } },
        { customerEmail: { contains: q, mode: 'insensitive' as const } },
      ];
    }

    const proformas = await withDbTimeout(() =>
      prisma.proforma.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      })
    );
    return NextResponse.json(proformas);
  } catch (error) {
    try {
      const q = req.nextUrl.searchParams.get('q')?.trim()?.toLowerCase();
      const status = req.nextUrl.searchParams.get('status')?.trim();
      let list = dataStore.getProformas();
      if (status && status !== 'ALL') {
        list = list.filter((p) => p.status === status);
      }
      if (q) {
        list = list.filter(
          (p) =>
            p.proformaNumber.toLowerCase().includes(q) ||
            p.customerCompany.toLowerCase().includes(q) ||
            p.customerName.toLowerCase().includes(q) ||
            p.customerEmail.toLowerCase().includes(q)
        );
      }
      return NextResponse.json(list);
    } catch {
      return NextResponse.json([]);
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'proformas.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const proforma = await createProforma(body);
    if (proforma?.id) {
      await writeAudit({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, {
        action: 'PROFORMA_CREATED', entityType: 'Proforma', entityId: proforma.id, entityLabel: proforma.proformaNumber,
        description: `Proforma ${proforma.proformaNumber} created for ${proforma.customerCompany}`,
      });
    }
    return NextResponse.json(proforma, { status: 201 });
  } catch (error: any) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error creating proforma:', error);
    return NextResponse.json({ error: error?.message || 'Failed to create proforma' }, { status: 500 });
  }
}
