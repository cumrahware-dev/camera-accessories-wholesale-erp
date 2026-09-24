import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { broadcastSystemEvent } from '@/lib/events-emitter';
import { guardApi } from '@/lib/api-auth';
import { canTransition, isProformaStatus, ProformaStatus } from '@/lib/proforma-workflow';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'proformas.read');
  if (!auth.ok) return auth.response;

  try {
    let proforma: any = null;
    try {
      proforma = await prisma.proforma.findUnique({
        where: { id },
        include: {
          customer: true,
          items: {
            include: { product: true },
          },
        },
      });

      if (!proforma) {
        proforma = await prisma.proforma.findUnique({
          where: { proformaNumber: id },
          include: {
            customer: true,
            items: {
              include: { product: true },
            },
          },
        });
      }
    } catch (dbErr) {
      // DB offline, proceed to fallback
    }

    if (!proforma && process.env.NODE_ENV !== 'production') {
      proforma = dataStore.getProformaById(id);
    }

    if (!proforma) {
      return NextResponse.json({ error: 'Proforma not found' }, { status: 404 });
    }

    return NextResponse.json(proforma);
  } catch (error) {
    console.error('Error fetching proforma:', error);
    return NextResponse.json({ error: 'Failed to fetch proforma' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'proformas.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { status, notes } = body;

    let existing: any = null;
    try {
      existing = await prisma.proforma.findFirst({
        where: {
          OR: [{ id }, { proformaNumber: id }],
        },
      });
    } catch {}

    if (!existing && process.env.NODE_ENV !== 'production') {
      existing = dataStore.getProformaById(id);
    }

    if (!existing) {
      return NextResponse.json({ error: 'Proforma not found' }, { status: 404 });
    }

    const targetId = existing.id;

    if (status !== undefined) {
      if (!isProformaStatus(status)) {
        return NextResponse.json({ error: `Unknown proforma status "${status}".` }, { status: 400 });
      }
      const check = canTransition(existing.status as ProformaStatus, status);
      if (!check.ok) {
        return NextResponse.json({ error: check.reason }, { status: 400 });
      }
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (existing.status === 'DRAFT') {
      if (body.paymentTerms !== undefined) updateData.paymentTerms = body.paymentTerms;
      if (body.deliveryTerms !== undefined) updateData.deliveryTerms = body.deliveryTerms;
      if (body.discountPercent !== undefined) updateData.discountPercent = Number(body.discountPercent);
      if (body.shippingCost !== undefined) updateData.shippingCost = Number(body.shippingCost);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No supported fields to update.' }, { status: 400 });
    }

    let proforma: any = null;
    try {
      proforma = await prisma.proforma.update({
        where: { id: targetId },
        data: updateData,
        include: {
          customer: true,
          items: {
            include: { product: true },
          },
        },
      });
    } catch (dbErr) {
      // Fallback to dataStore (dev only — ephemeral in production)
      if (process.env.NODE_ENV !== 'production') {
        proforma = dataStore.updateProforma(targetId, updateData);
      }
    }

    if (!proforma && process.env.NODE_ENV !== 'production') {
      proforma = dataStore.updateProforma(targetId, updateData);
    }

    // Broadcast real-time event to open client portals and admin dashboards
    try {
      broadcastSystemEvent({
        type: proforma.status === 'CONFIRMED' ? 'PROFORMA_CONFIRMED' : 'PROFORMA_UPDATED',
        id: proforma.id,
        proformaNumber: proforma.proformaNumber,
        status: proforma.status,
        data: proforma,
      });
    } catch (evtErr) {}

    return NextResponse.json(proforma);
  } catch (error) {
    console.error('Error updating proforma:', error);
    return NextResponse.json({ error: 'Failed to update proforma' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'proformas.write');
  if (!auth.ok) return auth.response;

  try {
    let existing: any = null;
    try {
      existing = await prisma.proforma.findFirst({
        where: { OR: [{ id }, { proformaNumber: id }] },
      });
    } catch {}

    if (!existing && process.env.NODE_ENV !== 'production') {
      existing = dataStore.getProformaById(id);
    }

    if (!existing) {
      return NextResponse.json({ error: 'Proforma not found' }, { status: 404 });
    }

    if (existing.status === 'CONVERTED') {
      return NextResponse.json(
        { error: 'Cannot delete a proforma that has already been converted to a tax invoice.' },
        { status: 400 }
      );
    }

    try {
      await prisma.proforma.delete({
        where: { id: existing.id },
      });
    } catch (dbErr) {
      // DB offline, proceed to fallback
    }

    dataStore.deleteProforma(existing.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting proforma:', error);
    return NextResponse.json({ error: 'Failed to delete proforma' }, { status: 500 });
  }
}
