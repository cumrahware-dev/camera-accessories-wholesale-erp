import { NextRequest, NextResponse } from 'next/server';
import { withCompanyProfile } from '@/lib/company';
import { cleanIncoterm, cleanText, MAX_PLACE, printableDelivery } from '@/lib/documents/terms';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { portalUrl } from '@/lib/documents/share-token';
import { repairItemDetails } from '@/lib/repair-items';
import { restoreStockForCancelledInvoice } from '@/lib/inventory-service';
import { deleteDraftInvoice } from '@/lib/services/invoice-service';
import { ServiceError } from '@/lib/services/proforma-service';
import { clientIp } from '@/lib/auth-rate-limit';
import {
  allocateFreight,
  computeChargeableWeightKg,
  computeFreightCharge,
  computeTotalFreight,
  FreightAllocationMethod,
} from '@/lib/freight';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.read');
  if (!auth.ok) return auth.response;

  try {
    let invoice: any = null;
    try {
      invoice = await prisma.taxInvoice.findFirst({
        where: {
          OR: [
            { id },
            { invoiceNumber: id },
            { id: { equals: id, mode: 'insensitive' } },
            { invoiceNumber: { equals: id, mode: 'insensitive' } },
            { proformaId: id },
            { proformaNumber: { equals: id, mode: 'insensitive' } },
          ],
        },
        include: {
          customer: true,
          depot: true,
          items: {
            include: { product: true },
          },
          serialNumbers: true,
          packingDetails: true,
          shipment: true,
        },
      });
    } catch (dbErr) {}

    if (!invoice) {
      invoice = dataStore.getInvoiceById(id);
    }

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const depotDenied = assertDepotAccess(auth.user, invoice.depotId);
    if (depotDenied) return depotDenied;
    if (invoice.documentStatus === 'DRAFT' && !hasPermission(auth.user.role, 'invoices.write')) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const replacedBy = invoice.documentStatus === 'CANCELLED'
      ? await prisma.taxInvoice.findFirst({ where: { amendsInvoiceId: invoice.id }, select: { id: true, invoiceNumber: true, documentStatus: true } }).catch(() => null)
      : null;
    const mapped = {
      ...(await withCompanyProfile(repairItemDetails(invoice) as any)),
      replacedBy,
      portalUrl: invoice.documentStatus !== 'DRAFT' && hasPermission(auth.user.role, 'invoices.write') ? portalUrl('TAX_INVOICE', invoice.id) : undefined,
      shippingDetails: invoice.shipment
        ? {
            courier: invoice.shipment.courier,
            airwayBillNumber: invoice.shipment.airwayBillNumber,
            trackingUrl: invoice.shipment.trackingUrl,
            shippingCost: invoice.shippingCost,
            weightKg: invoice.shipment.totalWeightKg,
            packageCount: invoice.shipment.packageCount,
            awbDocumentUrl: invoice.shipment.awbDocumentUrl,
          }
        : undefined,
    };

    return NextResponse.json(mapped);
  } catch (error) {
    console.error('Error fetching invoice:', error);
    return NextResponse.json({ error: 'Failed to fetch invoice' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req);
  if (!auth.ok) return auth.response;
  if (!hasPermission(auth.user.role, 'invoices.write') && !hasPermission(auth.user.role, 'invoices.fulfil')) {
    return NextResponse.json({ error: 'Forbidden: your role cannot update invoices' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      fulfilmentStatus,
      paymentStatus,
      notes,
      internalRemarks,
      freight,
      freightAllocation,
    } = body;

    let existing: any = null;
    try {
      existing = await prisma.taxInvoice.findFirst({
        where: {
          OR: [
            { id },
            { invoiceNumber: id },
            { id: { equals: id, mode: 'insensitive' } },
            { invoiceNumber: { equals: id, mode: 'insensitive' } },
          ],
        },
        include: { items: true },
      });
    } catch {}

    if (!existing) {
      existing = dataStore.getInvoiceById(id);
    }

    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const depotDenied = assertDepotAccess(auth.user, existing.depotId);
    if (depotDenied) return depotDenied;

    // Depot roles can move an order through fulfilment. Money, notes, freight and cancellation are office functions.
    const canEditCommercial = hasPermission(auth.user.role, 'invoices.write', auth.user.permissionRevokes);
    if (!canEditCommercial) {
      if (paymentStatus !== undefined || notes !== undefined || internalRemarks !== undefined || freight !== undefined || freightAllocation !== undefined) {
        return NextResponse.json({ error: 'Forbidden: only office users can change payment, notes or freight.' }, { status: 403 });
      }
      if (fulfilmentStatus === 'CANCELLED') {
        return NextResponse.json({ error: 'Forbidden: only office users can cancel an invoice.' }, { status: 403 });
      }
      if (fulfilmentStatus !== undefined && !['PROCESSING', 'READY_FOR_PACKING', 'PACKED', 'SHIPPED', 'DELIVERED'].includes(fulfilmentStatus)) {
        return NextResponse.json({ error: 'Invalid fulfilment status.' }, { status: 400 });
      }
    }
    const isDraft = existing.documentStatus === 'DRAFT';
    if (isDraft && paymentStatus !== undefined && paymentStatus !== 'UNPAID') {
      return NextResponse.json({ error: 'Issue the invoice before recording a payment.' }, { status: 400 });
    }
    if (isDraft && fulfilmentStatus !== undefined && fulfilmentStatus !== 'DRAFT') {
      return NextResponse.json({ error: 'A draft invoice must be issued before it can enter fulfilment. Delete the draft instead of cancelling it.' }, { status: 400 });
    }

    // Cancellation Business Rules
    if (fulfilmentStatus === 'CANCELLED') {
      if (existing.fulfilmentStatus === 'DELIVERED') {
        return NextResponse.json(
          { error: 'Cannot cancel an invoice that has already been delivered to the customer.' },
          { status: 400 }
        );
      }
      if (existing.fulfilmentStatus === 'SHIPPED') {
        return NextResponse.json(
          { error: 'Cannot cancel an invoice currently in-transit with courier. Process a return instead.' },
          { status: 400 }
        );
      }

      // Restore stock & release allocated serials safely via operational workflow
      const itemsToRestore = (existing.items || []).map((it: any) => ({
        productId: it.productId,
        productSku: it.productSku,
        productName: it.productName,
        quantity: it.quantity,
        depotId: existing.depotId,
      }));
      // Stock only leaves the depot at dispatch, and a shipped invoice cannot be cancelled: release the serials,
      // and only put quantities back if a shipment really took them.
      await restoreStockForCancelledInvoice(
        existing.id,
        existing.invoiceNumber,
        itemsToRestore,
        existing.depotId,
        { restoreQuantities: Boolean(existing.shipmentId) }
      );
    }

    const updateData: any = {};
    if (fulfilmentStatus !== undefined) updateData.fulfilmentStatus = fulfilmentStatus;
    if (fulfilmentStatus === 'CANCELLED') updateData.documentStatus = 'CANCELLED';
    if (paymentStatus !== undefined) {
      if (!['UNPAID', 'PARTIALLY_PAID', 'PAID'].includes(paymentStatus)) return NextResponse.json({ error: 'Unknown payment status.' }, { status: 400 });
      if (existing.fulfilmentStatus === 'CANCELLED') return NextResponse.json({ error: 'A cancelled invoice cannot take payments.' }, { status: 400 });
      updateData.paymentStatus = paymentStatus;
    }
    if (notes !== undefined) updateData.notes = notes;
    if (internalRemarks !== undefined) updateData.internalRemarks = internalRemarks;
    // Commercial terms can be changed while the invoice is still a draft; an issued invoice keeps what it was issued with.
    const termsTouched = ['paymentTerms', 'paymentMethod', 'incoterm', 'incotermPlace', 'deliveryTerms'].some((k) => body[k] !== undefined);
    if (termsTouched) {
      if (!isDraft) return NextResponse.json({ error: 'An issued invoice keeps its payment terms and Incoterm. Only drafts can be changed.' }, { status: 400 });
      if (!canEditCommercial) return NextResponse.json({ error: 'Forbidden: only office users can change commercial terms.' }, { status: 403 });
      if (body.paymentTerms !== undefined) updateData.paymentTerms = cleanText(body.paymentTerms, 120);
      if (body.paymentMethod !== undefined) updateData.paymentMethod = cleanText(body.paymentMethod, 40);
      if (body.deliveryTerms !== undefined) updateData.deliveryTerms = printableDelivery(cleanText(body.deliveryTerms, 200));
      if (body.incoterm !== undefined) {
        updateData.incoterm = cleanIncoterm(body.incoterm);
        if (!updateData.incoterm) updateData.incotermPlace = '';
      }
      if (body.incotermPlace !== undefined && (updateData.incoterm ?? existing.incoterm)) updateData.incotermPlace = cleanText(body.incotermPlace, MAX_PLACE);
    }

    const isClosed = existing.fulfilmentStatus === 'CANCELLED' || existing.fulfilmentStatus === 'DELIVERED';

    // Freight edit: rate, additional charges, manual override, or a direct
    // actual/volumetric weight correction. Recomputed authoritatively here, same rule as
    // Proformas — a client-supplied Total Freight is never trusted verbatim.
    // Freight is part of the invoice total, so it can only change while the invoice is a draft.
    if (freight !== undefined && !isDraft) {
      return NextResponse.json({ error: 'An issued invoice keeps its freight and total. Use "Cancel & Reissue" to correct it.' }, { status: 400 });
    }
    if (freight !== undefined && !isClosed) {
      const actualWeightKg = Number(freight.actualWeightKg ?? existing.actualWeightKg) || 0;
      const volumetricWeightKg = Number(freight.volumetricWeightKg ?? existing.volumetricWeightKg) || 0;
      const chargeableWeightKg = computeChargeableWeightKg(actualWeightKg, volumetricWeightKg);
      const freightRatePerKg = Number(freight.freightRatePerKg ?? existing.freightRatePerKg) || 0;
      const freightCharge = computeFreightCharge(chargeableWeightKg, freightRatePerKg);
      const additionalFreightCharges = Number(freight.additionalFreightCharges ?? existing.additionalFreightCharges) || 0;
      const isManualOverride = Boolean(freight.isManualOverride);
      const totalFreight = isManualOverride
        ? Math.max(0, Number(freight.manualTotalFreight) || 0)
        : computeTotalFreight(freightCharge, additionalFreightCharges);

      updateData.actualWeightKg = actualWeightKg;
      updateData.volumetricWeightKg = volumetricWeightKg;
      updateData.chargeableWeightKg = chargeableWeightKg;
      updateData.freightRatePerKg = freightRatePerKg;
      updateData.freightCharge = freightCharge;
      updateData.additionalFreightCharges = additionalFreightCharges;
      updateData.freightIsManualOverride = isManualOverride;
      if (freight.volumetricDivisor !== undefined) {
        updateData.freightVolumetricDivisor = Number(freight.volumetricDivisor) || 0;
      }
      updateData.shippingCost = totalFreight;

      const subtotal = Number(existing.subtotal) || 0;
      const taxAmount = Number(existing.taxAmount) || 0;
      const discountAmount = Number(existing.discountAmount) || 0;
      const otherCharges = Number(existing.otherCharges) || 0;
      updateData.grandTotal = Number((subtotal - discountAmount + taxAmount + totalFreight + otherCharges).toFixed(2));
    }

    // Optional freight allocation to products — reporting only, never changes
    // subtotal/tax/shippingCost/grandTotal.
    let itemAllocationUpdates: { id: string; allocatedFreight: number }[] | null = null;
    if (freightAllocation && Array.isArray(existing.items)) {
      const method = freightAllocation.method as FreightAllocationMethod;
      const totalFreight = updateData.shippingCost !== undefined ? updateData.shippingCost : Number(existing.shippingCost) || 0;
      if (method === 'MANUAL') {
        const provided: { itemId: string; allocatedFreight: number }[] = freightAllocation.allocations || [];
        itemAllocationUpdates = provided.map((a) => ({ id: a.itemId, allocatedFreight: Number(a.allocatedFreight) || 0 }));
      } else {
        const shares = allocateFreight(
          existing.items.map((it: any) => ({
            quantity: it.quantity,
            unitWeightKg: it.unitWeightKg || 0,
            totalPrice: it.totalPrice,
          })),
          totalFreight,
          method
        );
        itemAllocationUpdates = existing.items.map((it: any, idx: number) => ({
          id: it.id,
          allocatedFreight: shares[idx] || 0,
        }));
      }
      updateData.freightAllocationMethod = method;
    }

    let invoice: any = null;
    try {
      if (itemAllocationUpdates) {
        await prisma.$transaction(
          itemAllocationUpdates.map((u) =>
            prisma.invoiceItem.update({ where: { id: u.id }, data: { allocatedFreight: u.allocatedFreight } })
          )
        );
      }
      invoice = await prisma.taxInvoice.update({
        where: { id: existing.id },
        data: updateData,
        include: {
          customer: true,
          depot: true,
          items: {
            include: { product: true },
          },
          serialNumbers: true,
          packingDetails: true,
          shipment: true,
        },
      });

      // Sync customer metrics whenever invoice status or payment changes
      if (existing.customerId) {
        try {
          const custInvoices = await prisma.taxInvoice.findMany({
            where: { customerId: existing.customerId, fulfilmentStatus: { not: 'CANCELLED' }, documentStatus: { not: 'DRAFT' } },
            select: { id: true, grandTotal: true, paymentStatus: true },
          });
          const totalOrders = custInvoices.length;
          const totalSpent = custInvoices
            .filter((i: any) => i.paymentStatus === 'PAID')
            .reduce((sum: number, i: any) => sum + (Number(i.grandTotal) || 0), 0);
          const currentBalance = custInvoices
            .filter((i: any) => i.paymentStatus !== 'PAID')
            .reduce((sum: number, i: any) => sum + (Number(i.grandTotal) || 0), 0);

          await prisma.customer.update({
            where: { id: existing.customerId },
            data: {
              totalOrders,
              totalSpent,
              currentBalance: Math.max(0, currentBalance),
            },
          });
        } catch {}

        try {
          dataStore.syncCustomerMetrics(existing.customerId);
        } catch {}
      }
    } catch (dbErr) {
      if (itemAllocationUpdates) {
        const itemMap = new Map(itemAllocationUpdates.map((u) => [u.id, u.allocatedFreight]));
        existing.items = (existing.items || []).map((it: any) =>
          itemMap.has(it.id) ? { ...it, allocatedFreight: itemMap.get(it.id) } : it
        );
      }
      invoice = dataStore.updateInvoice(existing.id, { ...updateData, items: existing.items });
    }

    if (!invoice) {
      invoice = dataStore.updateInvoice(existing.id, updateData);
    }

    const actor = { id: auth.user.id, name: auth.user.name, role: auth.user.role };
    if (paymentStatus !== undefined && paymentStatus !== existing.paymentStatus) {
      await writeAudit(actor, {
        action: 'TAX_INVOICE_PAYMENT_RECORDED', entityType: 'TaxInvoice', entityId: existing.id, entityLabel: existing.invoiceNumber,
        description: `Payment status of ${existing.invoiceNumber} changed from ${existing.paymentStatus} to ${paymentStatus}`, previousValue: existing.paymentStatus, newValue: paymentStatus,
      });
    }
    if (fulfilmentStatus === 'CANCELLED' && existing.fulfilmentStatus !== 'CANCELLED') {
      await writeAudit(actor, {
        action: 'TAX_INVOICE_CANCELLED', entityType: 'TaxInvoice', entityId: existing.id, entityLabel: existing.invoiceNumber,
        description: `Tax invoice ${existing.invoiceNumber} cancelled`,
      });
    }
    const termsAudit: [string, string, string][] = [
      ['paymentTerms', 'INVOICE_PAYMENT_TERMS_CHANGED', 'Payment terms'],
      ['paymentMethod', 'INVOICE_PAYMENT_METHOD_CHANGED', 'Payment method'],
      ['incoterm', 'INVOICE_INCOTERM_CHANGED', 'Incoterm'],
      ['incotermPlace', 'INVOICE_INCOTERM_CHANGED', 'Incoterm place'],
      ['deliveryTerms', 'INVOICE_DELIVERY_TERMS_CHANGED', 'Delivery note'],
    ];
    for (const [field, action, name] of termsAudit) {
      if (updateData[field] !== undefined && updateData[field] !== existing[field]) {
        await writeAudit(actor, {
          action, entityType: 'TaxInvoice', entityId: existing.id, entityLabel: existing.invoiceNumber,
          description: `${name} changed from "${existing[field] || 'Not specified'}" to "${updateData[field] || 'Not specified'}"`, previousValue: existing[field], newValue: updateData[field],
        });
      }
    }
    if (freight !== undefined && updateData.shippingCost !== undefined && updateData.shippingCost !== existing.shippingCost) {
      await writeAudit(actor, {
        action: 'INVOICE_FREIGHT_CHANGED', entityType: 'TaxInvoice', entityId: existing.id, entityLabel: existing.invoiceNumber,
        description: `Freight changed from ${existing.shippingCost} to ${updateData.shippingCost}`, previousValue: existing.shippingCost, newValue: updateData.shippingCost,
      });
    }

    return NextResponse.json(invoice);
  } catch (error: any) {
    console.error('Error updating invoice:', error);
    return NextResponse.json({ error: error.message || 'Failed to update invoice' }, { status: 500 });
  }
}

export const PATCH = PUT;

/** Only a DRAFT can be deleted; issued invoices stay on record. A draft from a proforma releases that proforma. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.write');
  if (!auth.ok) return auth.response;

  try {
    const existing = await prisma.taxInvoice.findFirst({ where: { OR: [{ id }, { invoiceNumber: id }] }, select: { id: true, depotId: true } });
    if (!existing) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    const denied = assertDepotAccess(auth.user, existing.depotId);
    if (denied) return denied;

    const result = await deleteDraftInvoice(existing.id, { id: auth.user.id, name: auth.user.name, role: auth.user.role }, clientIp(req));
    dataStore.deleteInvoice(existing.id);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error deleting invoice:', error);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }
}
