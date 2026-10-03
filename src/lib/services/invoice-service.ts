/**
 * Tax invoice lifecycle that is not tied to a proforma:
 *
 *   createDirectInvoice  -> DRAFT   (no invoice number yet, invisible to the depot, editable, deletable)
 *   issueInvoice         -> ISSUED  (real invoice number, customer balance, enters depot fulfilment)
 *   (email worker)       -> SENT    (only after the provider accepted the email)
 *
 * Totals come from computeDocumentTotals, the same calculator proformas use; invoice numbers come from
 * allocateInvoiceNumber, the same sequence proforma conversion uses.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { computeDocumentTotals, TotalsError } from '@/lib/documents/totals';
import { triggerInvoiceCreatedDepotEmail } from '@/lib/email-service';
import { broadcastSystemEvent } from '@/lib/events-emitter';
import { writeAudit, type Actor } from '@/lib/audit';
import { ServiceError } from '@/lib/services/proforma-service';

const DAY = 24 * 60 * 60 * 1000;

/** Next number from the single tax-invoice sequence. Must run inside the transaction that uses it. */
export async function allocateInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const settings = await tx.companySettings.update({
    where: { id: 'global-settings' },
    data: { invoiceNextNumber: { increment: 1 } },
  });
  return `${settings.invoicePrefix || 'INV-2026-'}${String(settings.invoiceNextNumber - 1).padStart(5, '0')}`;
}

export const isDraftNumber = (n: string | null | undefined) => !!n && n.startsWith('DRAFT-');

export async function createDirectInvoice(body: any, actor: Actor) {
  let totals;
  try {
    totals = await computeDocumentTotals(body);
  } catch (e: any) {
    if (e instanceof TotalsError) throw new ServiceError(e.status, e.message);
    throw e;
  }
  const { customer, lines, freight } = totals;
  if (!lines.length) throw new ServiceError(400, 'Add at least one product.');

  const depotId: string = body.depotId || lines[0].selectedDepotId || 'dep-central';
  const depot = await prisma.depot.findUnique({ where: { id: depotId }, select: { id: true, name: true } }).catch(() => null);
  if (!depot) throw new ServiceError(400, 'Select a valid depot.');
  const dueDays = Math.max(0, Math.min(365, Number(body.dueDays ?? 30) || 0));

  const invoice = await prisma.taxInvoice.create({
    data: {
      // The legal number is assigned at issue time, so deleting a draft never leaves a gap in the sequence.
      invoiceNumber: `DRAFT-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      documentStatus: 'DRAFT',
      fulfilmentStatus: 'DRAFT',
      paymentStatus: 'UNPAID',
      customerId: customer.id,
      customerName: customer.contactPerson || customer.companyName,
      customerEmail: customer.email || '',
      customerCompany: customer.companyName,
      customerPhone: customer.phone || '',
      billingAddress: customer.billingAddress || '',
      shippingAddress: customer.shippingAddress || customer.billingAddress || '',
      depotId: depot.id,
      depotName: depot.name,
      managerId: actor.id,
      managerName: actor.name,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + dueDays * DAY),
      paymentTerms: body.paymentTerms || 'NET 30 days from dispatch',
      notes: body.notes || '',
      currency: body.currency || 'USD',
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxAmount: totals.taxAmount,
      shippingCost: totals.shippingCost,
      grandTotal: totals.grandTotal,
      actualWeightKg: freight.actualWeightKg,
      volumetricWeightKg: freight.volumetricWeightKg,
      chargeableWeightKg: freight.chargeableWeightKg,
      freightRatePerKg: freight.freightRatePerKg,
      freightCharge: freight.freightCharge,
      additionalFreightCharges: freight.additionalFreightCharges,
      freightVolumetricDivisor: freight.freightVolumetricDivisor,
      freightIsManualOverride: freight.freightIsManualOverride,
      items: {
        create: lines.map((l) => ({
          productId: l.productId,
          productSku: l.productSku,
          productName: l.productName,
          brand: l.brand,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
          taxAmount: l.taxAmount,
          totalPrice: l.totalPrice,
          depotId: l.selectedDepotId || depot.id,
          depotName: l.selectedDepotName || depot.name,
          trackSerial: l.trackSerial,
          unitWeightKg: l.unitWeightKg,
          lengthCm: l.lengthCm,
          widthCm: l.widthCm,
          heightCm: l.heightCm,
        })),
      },
    },
    include: { items: true },
  });

  await writeAudit(actor, {
    action: 'TAX_INVOICE_CREATED', entityType: 'TaxInvoice', entityId: invoice.id, entityLabel: invoice.invoiceNumber,
    description: `Direct tax invoice draft created for ${invoice.customerCompany} (${invoice.currency} ${invoice.grandTotal.toFixed(2)})`,
  });
  return invoice;
}

/** DRAFT -> ISSUED. Exactly one caller can win the claim, so a double click can never burn two numbers. */
export async function issueInvoice(id: string, actor: Actor) {
  const existing = await prisma.taxInvoice.findFirst({ where: { OR: [{ id }, { invoiceNumber: id }] }, include: { items: true } });
  if (!existing) throw new ServiceError(404, 'Invoice not found');
  if (existing.documentStatus !== 'DRAFT') {
    throw new ServiceError(409, `Invoice ${existing.invoiceNumber} has already been issued.`);
  }
  if (!existing.items.length) throw new ServiceError(400, 'Add at least one product before issuing.');

  const termDays = Math.max(0, Math.round((existing.dueDate.getTime() - existing.issueDate.getTime()) / DAY));
  let invoice;
  try {
    invoice = await prisma.$transaction(async (tx) => {
      const claim = await tx.taxInvoice.updateMany({ where: { id: existing.id, documentStatus: 'DRAFT' }, data: { documentStatus: 'ISSUED' } });
      if (claim.count !== 1) throw new Error('ALREADY_ISSUED');
      const invoiceNumber = await allocateInvoiceNumber(tx);
      const now = new Date();
      const updated = await tx.taxInvoice.update({
        where: { id: existing.id },
        data: {
          invoiceNumber,
          issuedAt: now,
          issueDate: now,
          dueDate: new Date(now.getTime() + termDays * DAY),
          // Issuing is what releases the order to the depot.
          fulfilmentStatus: 'READY_FOR_PACKING',
        },
        include: { items: true },
      });
      await tx.customer.update({
        where: { id: existing.customerId },
        data: { totalOrders: { increment: 1 }, currentBalance: { increment: existing.grandTotal || 0 } },
      });
      return updated;
    });
  } catch (e: any) {
    if (e?.message === 'ALREADY_ISSUED') throw new ServiceError(409, 'This invoice has already been issued.');
    console.error('[Invoice issue] failed:', e?.message);
    throw new ServiceError(503, 'Issuing failed. Nothing was changed; please try again.');
  }

  await writeAudit(actor, {
    action: 'TAX_INVOICE_ISSUED', entityType: 'TaxInvoice', entityId: invoice.id, entityLabel: invoice.invoiceNumber,
    description: `Tax invoice ${invoice.invoiceNumber} issued to ${invoice.customerCompany}`,
  });
  triggerInvoiceCreatedDepotEmail(invoice).catch((e) => console.error('[Invoice issue] depot email failed:', e));
  try {
    broadcastSystemEvent({ type: 'INVOICE_UPDATED', id: invoice.id, invoiceNumber: invoice.invoiceNumber, status: 'ISSUED', data: invoice } as any);
  } catch {}
  return invoice;
}
