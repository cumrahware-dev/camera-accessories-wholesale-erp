import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { depotIdFilter, guardApi } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';
import { parsePagination } from '@/lib/pagination';
import { convertProformaToInvoice, ServiceError } from '@/lib/services/proforma-service';
import { createDirectInvoice } from '@/lib/services/invoice-service';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'invoices.read');
  if (!auth.ok) return auth.response;

  try {
    const scopedDepotId = depotIdFilter(auth.user);
    const { take, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
    const q = req.nextUrl.searchParams.get('q')?.trim();
    const paymentStatus = req.nextUrl.searchParams.get('paymentStatus')?.trim();
    const fulfilmentStatus = req.nextUrl.searchParams.get('fulfilmentStatus')?.trim();

    const where: any = {};
    if (scopedDepotId) where.depotId = scopedDepotId;
    // Drafts are not real invoices yet: only people who can create invoices see them (never the depot).
    if (!hasPermission(auth.user.role, 'invoices.write')) where.documentStatus = { not: 'DRAFT' };
    if (paymentStatus && paymentStatus !== 'ALL') where.paymentStatus = paymentStatus;
    if (fulfilmentStatus && fulfilmentStatus !== 'ALL') where.fulfilmentStatus = fulfilmentStatus;
    if (q) {
      where.OR = [
        { invoiceNumber: { contains: q, mode: 'insensitive' as const } },
        { customerCompany: { contains: q, mode: 'insensitive' as const } },
        { customerName: { contains: q, mode: 'insensitive' as const } },
        { proformaNumber: { contains: q, mode: 'insensitive' as const } },
      ];
    }

    const invoices = await withDbTimeout(() =>
      prisma.taxInvoice.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        include: {
          items: true,
          packingDetails: true,
          shipment: {
            select: {
              courier: true,
              airwayBillNumber: true,
              trackingUrl: true,
              totalWeightKg: true,
              packageCount: true,
              awbDocumentUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      })
    );

    const mappedInvoices = invoices.map((inv) => ({
      ...inv,
      shippingDetails: inv.shipment
        ? {
            courier: inv.shipment.courier,
            airwayBillNumber: inv.shipment.airwayBillNumber,
            trackingUrl: inv.shipment.trackingUrl,
            shippingCost: inv.shippingCost,
            weightKg: inv.shipment.totalWeightKg,
            packageCount: inv.shipment.packageCount,
            awbDocumentUrl: inv.shipment.awbDocumentUrl,
          }
        : undefined,
    }));

    return NextResponse.json(mappedInvoices, {
      headers: {
        'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
      },
    });
  } catch (error) {
    try {
      const q = req.nextUrl.searchParams.get('q')?.trim()?.toLowerCase();
      let list = dataStore.getInvoices();
      if (q) {
        list = list.filter(
          (inv) =>
            inv.invoiceNumber.toLowerCase().includes(q) ||
            inv.customerCompany.toLowerCase().includes(q) ||
            inv.customerName.toLowerCase().includes(q) ||
            (inv.proformaNumber && inv.proformaNumber.toLowerCase().includes(q))
        );
      }
      return NextResponse.json(list);
    } catch {
      return NextResponse.json([]);
    }
  }
}

/**
 * Two ways to create a tax invoice, one set of business rules:
 *  - { proformaId, depotId }  -> converts a CONFIRMED proforma (atomic, can never run twice)
 *  - { customerId, items, ... } -> direct tax invoice, saved as a DRAFT until it is issued
 * Totals for both come from the shared document calculator.
 */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'invoices.write');
  if (!auth.ok) return auth.response;
  const actor = { id: auth.user.id, name: auth.user.name, role: auth.user.role };

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });

    if (body.proformaId) {
      const invoice = await convertProformaToInvoice(String(body.proformaId), body.depotId, actor);
      return NextResponse.json(invoice, { status: 201 });
    }
    if (!body.customerId) return NextResponse.json({ error: 'Select a customer.' }, { status: 400 });
    if (!Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: 'Add at least one product.' }, { status: 400 });

    const invoice = await createDirectInvoice(body, actor);
    return NextResponse.json(invoice, { status: 201 });
  } catch (error: any) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message, ...(error.extra || {}) }, { status: error.status });
    console.error('Error creating invoice:', error);
    return NextResponse.json({ error: 'Failed to create invoice. Please try again.' }, { status: 500 });
  }
}
