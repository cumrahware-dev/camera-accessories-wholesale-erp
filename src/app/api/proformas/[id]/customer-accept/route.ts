import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { broadcastSystemEvent } from '@/lib/events-emitter';
import { canTransition, ProformaStatus } from '@/lib/proforma-workflow';

/**
 * Public "customer accepts this quotation" endpoint for the /quote/[id]
 * portal. Deliberately not guarded by guardApi/RBAC — the shareable quote
 * link (emailed to the customer) uses the proforma's own unguessable cuid
 * as its only credential, the same way a Stripe invoice or Google Doc
 * share link works. Unlike the general PUT /api/proformas/[id] endpoint,
 * this only performs the single CONFIRMED transition with an optional note
 * and never accepts arbitrary field edits (freight, pricing, etc.), and it
 * only ever looks the proforma up by its cuid id — never by the
 * human-readable, sequential proformaNumber — so it can't be used to
 * enumerate or read other customers' quotations.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const { notes } = body;

    let existing: any = null;
    try {
      existing = await prisma.proforma.findUnique({
        where: { id },
        include: { items: true },
      });
    } catch {
      // DB offline, proceed to fallback
    }

    if (!existing) {
      const fallback = dataStore.getProformaById(id);
      if (fallback && fallback.id === id) existing = fallback;
    }

    if (!existing) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }

    const check = canTransition(existing.status as ProformaStatus, 'CONFIRMED');
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 400 });
    }

    const updateData = {
      status: 'CONFIRMED' as const,
      notes: notes
        ? `${existing.notes ? existing.notes + '\n' : ''}[Customer Acceptance Note]: ${notes}`
        : existing.notes,
    };

    let proforma: any = null;
    try {
      proforma = await prisma.proforma.update({
        where: { id: existing.id },
        data: updateData,
        include: { customer: true, items: { include: { product: true } } },
      });
    } catch {
      // DB offline, proceed to fallback
    }

    if (!proforma) {
      proforma = dataStore.updateProforma(existing.id, updateData);
    }

    try {
      broadcastSystemEvent({
        type: 'PROFORMA_CONFIRMED',
        id: proforma.id,
        proformaNumber: proforma.proformaNumber,
        status: proforma.status,
        data: proforma,
      });
    } catch {}

    dataStore.addAuditLog({
      action: 'DEAL_CONFIRM',
      entityType: 'PROFORMA',
      entityId: proforma.id,
      entityLabel: proforma.proformaNumber,
      description: `Quotation accepted by the customer via the public quote portal`,
    });

    return NextResponse.json(proforma);
  } catch (error) {
    console.error('Error accepting proforma:', error);
    return NextResponse.json({ error: 'Failed to confirm quotation' }, { status: 500 });
  }
}
