import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { assertDepotAccess, guardApi, depotIdFilter } from '@/lib/api-auth';
import { clientIp } from '@/lib/auth-rate-limit';
import { ShipmentUpdateError, findShipmentByRef, updateShipment } from '@/lib/services/shipment-update';
import { parsePagination } from '@/lib/pagination';
import { triggerShipmentDispatchedManagerEmail } from '@/lib/email-service';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'shipments.read');
  if (!auth.ok) return auth.response;

  try {
    const depotFilter = depotIdFilter(auth.user);
    const { take, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
    const q = req.nextUrl.searchParams.get('q')?.trim();
    const status = req.nextUrl.searchParams.get('status')?.trim();

    const where: any = {};
    if (depotFilter) where.depotId = depotFilter;
    if (status && status !== 'ALL') where.status = status;
    if (q) {
      where.OR = [
        { invoiceNumber: { contains: q, mode: 'insensitive' as const } },
        { airwayBillNumber: { contains: q, mode: 'insensitive' as const } },
        { shipmentNumber: { contains: q, mode: 'insensitive' as const } },
        { customerName: { contains: q, mode: 'insensitive' as const } },
        { customerCompany: { contains: q, mode: 'insensitive' as const } },
      ];
    }

    const shipments = await withDbTimeout(() =>
      prisma.shipment.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      })
    );
    return NextResponse.json(shipments, {
      headers: {
        'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
      },
    });
  } catch (error) {
    try {
      const q = req.nextUrl.searchParams.get('q')?.trim()?.toLowerCase();
      let list = dataStore.getShipments();
      if (q) {
        list = list.filter(
          (s) =>
            s.invoiceNumber.toLowerCase().includes(q) ||
            s.airwayBillNumber.toLowerCase().includes(q) ||
            s.shipmentNumber.toLowerCase().includes(q) ||
            s.customerName.toLowerCase().includes(q) ||
            (s.customerCompany && s.customerCompany.toLowerCase().includes(q))
        );
      }
      return NextResponse.json(list);
    } catch {
      return NextResponse.json([]);
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'shipments.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const { invoiceId, courier, airwayBillNumber, trackingUrl, totalWeightKg, packageCount, awbDocumentUrl, awbDocumentId } = body;

    // Same rule as the depot dispatch: the airway bill is kept as a document record the ERP can serve. An inline
    // (data:) payload is refused, because a browser cannot open it later.
    let awbDoc: { id: string | null; url: string | null } | null = null;
    if (awbDocumentId) {
      const d = await prisma.cloudDocument.findUnique({ where: { id: String(awbDocumentId) }, select: { id: true, cloudinaryUrl: true } }).catch(() => null);
      if (!d) return NextResponse.json({ error: 'The uploaded airway bill document could not be found. Upload it again.' }, { status: 400 });
      awbDoc = { id: d.id, url: d.cloudinaryUrl };
    } else if (typeof awbDocumentUrl === 'string' && awbDocumentUrl.trim()) {
      const u = awbDocumentUrl.trim();
      if (!/^https?:\/\//i.test(u)) {
        return NextResponse.json({ error: 'The airway bill document was not stored. Upload the file again.' }, { status: 400 });
      }
      const d = await prisma.cloudDocument.findFirst({ where: { cloudinaryUrl: u }, orderBy: { uploadedAt: 'desc' }, select: { id: true } }).catch(() => null);
      awbDoc = { id: d?.id || null, url: u };
    }

    let invoice: any = null;
    try {
      invoice = await prisma.taxInvoice.findUnique({
        where: { id: invoiceId },
        include: { customer: true, depot: true },
      });
    } catch {}

    if (!invoice) {
      invoice = dataStore.getInvoiceById(invoiceId);
    }

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const depotFilter = depotIdFilter(auth.user);
    if (depotFilter && invoice.depotId !== depotFilter) {
      return NextResponse.json({ error: 'Forbidden: invoice is outside your assigned depot' }, { status: 403 });
    }

    const finalAWB = airwayBillNumber?.trim() || `AWB-${Date.now()}`;
    const finalCourier = courier || 'DHL_EXPRESS';
    const finalWeight = totalWeightKg || 5.0;
    const finalPackages = packageCount || 1;
    const finalTrackingUrl = trackingUrl || `https://track.courier.com/?awb=${encodeURIComponent(finalAWB)}`;

    let shipment: any = null;
    try {
      const shipmentNumber = `SHP-2026-${Date.now()}`;
      shipment = await prisma.shipment.create({
        data: {
          shipmentNumber,
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          customerName: invoice.customerName,
          customerCompany: invoice.customerCompany,
          destinationCountry: invoice.customer?.country || 'International',
          shippingAddress: invoice.shippingAddress || '',
          depotId: invoice.depotId,
          depotName: invoice.depotName,
          courier: finalCourier,
          airwayBillNumber: finalAWB,
          trackingUrl: finalTrackingUrl,
          status: 'DISPATCHED',
          totalWeightKg: finalWeight,
          packageCount: finalPackages,
          dispatchedAt: new Date(),
          awbDocumentUrl: awbDoc?.url || null,
          awbDocumentId: awbDoc?.id || null,
        },
      });

      await prisma.taxInvoice.update({
        where: { id: invoiceId },
        data: {
          shipmentId: shipment.id,
          fulfilmentStatus: 'SHIPPED',
        },
      });
    } catch (dbErr) {
      dataStore.dispatchShipment(invoiceId);
      shipment = dataStore.createShipment({
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        depotId: invoice.depotId,
        depotName: invoice.depotName,
        courier: finalCourier,
        airwayBillNumber: finalAWB,
        trackingUrl: finalTrackingUrl,
        totalWeightKg: finalWeight,
        packageCount: finalPackages,
        awbDocumentUrl: awbDoc?.url || null,
        status: 'DISPATCHED',
      });
    }

    if (!shipment) {
      dataStore.dispatchShipment(invoiceId);
      shipment = dataStore.createShipment({
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        depotId: invoice.depotId,
        depotName: invoice.depotName,
        courier: finalCourier,
        airwayBillNumber: finalAWB,
        trackingUrl: finalTrackingUrl,
        totalWeightKg: finalWeight,
        packageCount: finalPackages,
        awbDocumentUrl: awbDoc?.url || null,
        status: 'DISPATCHED',
      });
    }

    return NextResponse.json(shipment, { status: 201 });
  } catch (error) {
    console.error('Error creating shipment:', error);
    return NextResponse.json({ error: 'Failed to create shipment' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await guardApi(req, 'shipments.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const ref = body.id || body.shipmentId;
    if (!ref) return NextResponse.json({ error: 'Shipment ID is required' }, { status: 400 });

    // Same rules as PATCH /api/shipments/[id]: status validated, the depot checked, shipment + invoice updated together
    // in one transaction, audited. (This route used to skip the depot check and the audit entry, accept any status text,
    // and swallow a failed invoice update - leaving a shipment Delivered while its invoice still said Shipped.)
    const existing = await findShipmentByRef(String(ref));
    if (!existing) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
    const denied = assertDepotAccess(auth.user, existing.depotId);
    if (denied) return denied;
    const updated = await updateShipment({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, existing, body, clientIp(req));
    return NextResponse.json({ success: true, shipment: updated });
  } catch (error: any) {
    if (error instanceof ShipmentUpdateError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error updating shipment:', error?.message);
    return NextResponse.json({ error: 'Failed to update shipment' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  return PATCH(req);
}

