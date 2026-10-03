import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { computeDocumentTotals, DocumentTotals, TotalsError } from '@/lib/documents/totals';
import { broadcastSystemEvent } from '@/lib/events-emitter';
import { triggerInvoiceCreatedDepotEmail } from '@/lib/email-service';
import { canTransition, ProformaStatus } from '@/lib/proforma-workflow';
import { allocateInvoiceNumber } from '@/lib/services/invoice-service';
import { writeAudit, type Actor } from '@/lib/audit';

export class ServiceError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

/**
 * Creates a DRAFT proforma / quotation. Single implementation shared by POST /api/proformas
 * and the OCR conversion service, so numbering, tax and freight rules never diverge.
 */
export async function createProforma(body: any): Promise<any> {
    const { customerId, notes, deliveryTerms, paymentTerms, expiryDays } = body;

    let totals: DocumentTotals;
    try {
      totals = await computeDocumentTotals(body);
    } catch (e: any) {
      if (e instanceof TotalsError) throw new ServiceError(e.status, e.message);
      throw e;
    }
    const { customer, lines: resolvedItems, subtotal, discountAmount, freight: freightResult, grandTotal } = totals;
    const discPercent = totals.discountPercent;
    const totalTax = totals.taxAmount;
    const shipCost = totals.shippingCost;

    // Preview only: same arithmetic as a real create, nothing is written. Used by the OCR
    // module to check the ERP will record the totals printed on the scanned document.
    if (body.dryRun) {
      return { subtotal, discountAmount, taxAmount: Number(totalTax.toFixed(2)), shippingCost: shipCost, grandTotal };
    }

    // Try DB proforma creation
    let proforma: any = null;
    try {
      const settings = await prisma.companySettings.findUnique({
        where: { id: 'global-settings' },
      });
      const nextNumber = settings?.proformaNextNumber || 1;
      const proformaNumber = `${settings?.proformaPrefix || 'PF-2026-'}${String(nextNumber).padStart(5, '0')}`;

      proforma = await prisma.proforma.create({
        data: {
          proformaNumber,
          customerId,
          customerName: customer.contactPerson || customer.companyName,
          customerEmail: customer.email,
          customerCompany: customer.companyName,
          customerPhone: customer.phone || '',
          billingAddress: customer.billingAddress || '',
          shippingAddress: customer.shippingAddress || customer.billingAddress || '',
          issueDate: new Date(),
          expiryDate: new Date(Date.now() + (expiryDays || 15) * 24 * 60 * 60 * 1000),
          paymentTerms: paymentTerms || 'Cash In Advance',
          deliveryTerms: deliveryTerms || 'C&F Vietnam Airport',
          notes: notes || '',
          subtotal,
          discountPercent: discPercent,
          discountAmount,
          taxAmount: Number(totalTax.toFixed(2)),
          shippingCost: shipCost,
          grandTotal,
          status: 'DRAFT',
          actualWeightKg: freightResult.actualWeightKg,
          volumetricWeightKg: freightResult.volumetricWeightKg,
          chargeableWeightKg: freightResult.chargeableWeightKg,
          freightRatePerKg: freightResult.freightRatePerKg,
          freightCharge: freightResult.freightCharge,
          additionalFreightCharges: freightResult.additionalFreightCharges,
          freightVolumetricDivisor: freightResult.freightVolumetricDivisor,
          freightIsManualOverride: freightResult.freightIsManualOverride,
          items: {
            create: resolvedItems.map((it: any) => ({
              productId: it.productId,
              productSku: it.productSku,
              productName: it.productName,
              brand: it.brand,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              discountPercent: it.discountPercent,
              taxRate: it.taxRate,
              taxAmount: it.taxAmount,
              totalPrice: it.totalPrice,
              selectedDepotId: it.selectedDepotId,
              selectedDepotName: it.selectedDepotName,
              trackSerial: it.trackSerial,
              unitWeightKg: it.unitWeightKg,
              lengthCm: it.lengthCm,
              widthCm: it.widthCm,
              heightCm: it.heightCm,
            })),
          },
        },
        include: { items: true, customer: true },
      });

      await prisma.companySettings.update({
        where: { id: 'global-settings' },
        data: { proformaNextNumber: nextNumber + 1 },
      }).catch(() => {});
    } catch (dbErr: any) {
      // On production (Vercel), the dataStore is ephemeral (serverless) — data
      // saved in memory won't be visible to the next request.  Only use the
      // fallback in development where the process is long-lived.
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Proforma POST] DB write failed, falling back to dataStore:', dbErr?.message);
        proforma = dataStore.createProforma({
          customerId,
          customerName: customer.contactPerson || customer.companyName,
          customerEmail: customer.email,
          customerCompany: customer.companyName,
          customerPhone: customer.phone || '',
          billingAddress: customer.billingAddress || '',
          shippingAddress: customer.shippingAddress || customer.billingAddress || '',
          paymentTerms: paymentTerms || 'Cash In Advance',
          deliveryTerms: deliveryTerms || 'C&F Vietnam Airport',
          notes: notes || '',
          subtotal,
          discountPercent: discPercent,
          discountAmount,
          taxAmount: Number(totalTax.toFixed(2)),
          shippingCost: shipCost,
          grandTotal,
          actualWeightKg: freightResult.actualWeightKg,
          volumetricWeightKg: freightResult.volumetricWeightKg,
          chargeableWeightKg: freightResult.chargeableWeightKg,
          freightRatePerKg: freightResult.freightRatePerKg,
          freightCharge: freightResult.freightCharge,
          additionalFreightCharges: freightResult.additionalFreightCharges,
          freightVolumetricDivisor: freightResult.freightVolumetricDivisor,
          freightIsManualOverride: freightResult.freightIsManualOverride,
          items: resolvedItems.map((it: any, i: number) => ({ id: `pfi-${Date.now()}-${i}`, ...it })),
          status: 'DRAFT',
        });
      } else {
        console.error('[Proforma POST] DB write failed on production:', dbErr);
        throw new ServiceError(503, 'Failed to save proforma. The database may be temporarily unavailable — please try again.');
      }
    }

  return proforma;
}

/** CONFIRMED status change (same rules as POST /api/proformas/[id]/confirm). */
export async function confirmProforma(id: string, actor?: Actor): Promise<any> {
  let existing: any = null;
  try {
    existing = await prisma.proforma.findFirst({ where: { OR: [{ id }, { proformaNumber: id }] } });
  } catch {}
  if (!existing) existing = dataStore.getProformaById(id);
  if (!existing) throw new ServiceError(404, 'Proforma not found');

  const check = canTransition(existing.status as ProformaStatus, 'CONFIRMED');
  if (!check.ok) throw new ServiceError(400, check.reason || 'Cannot confirm this proforma');

  let proforma: any = null;
  try {
    proforma = await prisma.proforma.update({ where: { id: existing.id }, data: { status: 'CONFIRMED' }, include: { customer: true, items: true } });
  } catch {
    proforma = dataStore.updateProforma(existing.id, { status: 'CONFIRMED' });
  }
  if (!proforma) proforma = dataStore.updateProforma(existing.id, { status: 'CONFIRMED' });
  if (actor) {
    await writeAudit(actor, {
      action: 'PROFORMA_CONFIRMED', entityType: 'Proforma', entityId: existing.id, entityLabel: existing.proformaNumber,
      description: `Proforma ${existing.proformaNumber} marked as confirmed by the customer`, previousValue: existing.status, newValue: 'CONFIRMED',
    });
  }

  try {
    broadcastSystemEvent({ type: 'PROFORMA_CONFIRMED', id: proforma.id, proformaNumber: proforma.proformaNumber, status: proforma.status, data: proforma });
  } catch (evtErr) {
    console.warn('Could not broadcast confirmation event:', evtErr);
  }
  return proforma;
}

/** Atomic CONFIRMED -> CONVERTED tax invoice creation (shared with POST /api/proformas/[id]/convert). */
export async function convertProformaToInvoice(id: string, depotId?: string, actor?: Actor): Promise<any> {
    // Get the proforma by ID or proformaNumber
    let proforma: any = null;
    try {
      proforma = await prisma.proforma.findUnique({
        where: { id },
        include: { items: true, customer: true },
      });

      if (!proforma) {
        proforma = await prisma.proforma.findUnique({
          where: { proformaNumber: id },
          include: { items: true, customer: true },
        });
      }
    } catch (dbErr) {}

    if (!proforma) {
      proforma = dataStore.getProformaById(id);
    }

    if (!proforma) {
      throw new ServiceError(404, 'Proforma not found');
    }

    if (proforma.status === 'CONVERTED' && (proforma as any).convertedToInvoiceId) {
      throw new ServiceError(409, `Proforma already converted to ${(proforma as any).convertedToInvoiceNumber || 'a tax invoice'}`, {
        invoiceId: (proforma as any).convertedToInvoiceId,
      });
    }

    const finalDepotId = depotId || proforma.items?.[0]?.selectedDepotId || 'dep-central';
    const dbDepot = await prisma.depot.findUnique({ where: { id: finalDepotId }, select: { name: true } }).catch(() => null);
    const finalDepotName = dbDepot?.name || dataStore.getDepotById(finalDepotId)?.name || 'Central Depot';

    // Only a CONFIRMED proforma may become a tax invoice (Draft/Sent/Cancelled may not).
    if (proforma.status !== 'CONFIRMED') {
      throw new ServiceError(
        409,
        proforma.status === 'CONVERTED'
          ? 'This proforma has already been converted.'
          : `Only a confirmed proforma can be converted (current status: ${String(proforma.status).toLowerCase()}).`
      );
    }

    // Convert atomically. The status claim (CONFIRMED -> CONVERTED) succeeds for exactly one
    // caller, so double-clicks / concurrent requests cannot create two invoices or burn two
    // invoice numbers. Any failure rolls the whole conversion back; there is no in-memory
    // fallback that could leave a "ghost" invoice behind.
    let invoice: any = null;
    try {
      invoice = await prisma.$transaction(async (tx) => {
        const claim = await tx.proforma.updateMany({
          where: { id: proforma.id, status: 'CONFIRMED' },
          data: { status: 'CONVERTED' },
        });
        if (claim.count !== 1) throw new Error('ALREADY_CONVERTED');

        const invoiceNumber = await allocateInvoiceNumber(tx);

        const created = await tx.taxInvoice.create({
          data: {
            invoiceNumber,
            customerId: proforma.customerId,
            customerName: proforma.customerName,
            customerEmail: proforma.customerEmail,
            customerCompany: proforma.customerCompany,
            customerPhone: proforma.customerPhone,
            billingAddress: proforma.billingAddress,
            shippingAddress: proforma.shippingAddress,
            depotId: finalDepotId,
            depotName: finalDepotName,
            issueDate: new Date(),
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            paymentTerms: proforma.paymentTerms,
            paymentStatus: 'UNPAID',
            fulfilmentStatus: 'READY_FOR_PACKING',
            // A confirmed order is issued straight away: the customer already agreed to it.
            documentStatus: 'ISSUED',
            issuedAt: new Date(),
            ...(actor ? { managerId: actor.id, managerName: actor.name } : {}),
            notes: proforma.notes,
            currency: proforma.currency || 'USD',
            subtotal: proforma.subtotal,
            discountAmount: proforma.discountAmount,
            taxAmount: proforma.taxAmount,
            shippingCost: proforma.shippingCost,
            otherCharges: proforma.otherCharges || 0,
            grandTotal: proforma.grandTotal,
            actualWeightKg: proforma.actualWeightKg,
            volumetricWeightKg: proforma.volumetricWeightKg,
            chargeableWeightKg: proforma.chargeableWeightKg,
            freightRatePerKg: proforma.freightRatePerKg,
            freightCharge: proforma.freightCharge,
            additionalFreightCharges: proforma.additionalFreightCharges,
            freightVolumetricDivisor: proforma.freightVolumetricDivisor,
            freightIsManualOverride: proforma.freightIsManualOverride,
            freightAllocationMethod: proforma.freightAllocationMethod,
            proformaId: proforma.id,
            proformaNumber: proforma.proformaNumber,
          },
        });

        if (Array.isArray(proforma.items) && proforma.items.length > 0) {
          await tx.invoiceItem.createMany({
            data: proforma.items.map((item: any) => ({
              invoiceId: created.id,
              productId: item.productId,
              productSku: item.productSku,
              productName: item.productName,
              brand: item.brand,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              taxRate: item.taxRate,
              taxAmount: item.taxAmount,
              totalPrice: item.totalPrice,
              depotId: item.selectedDepotId || finalDepotId,
              depotName: item.selectedDepotName || finalDepotName,
              trackSerial: item.trackSerial,
              unitWeightKg: item.unitWeightKg || 0,
              lengthCm: item.lengthCm || 0,
              widthCm: item.widthCm || 0,
              heightCm: item.heightCm || 0,
              allocatedFreight: item.allocatedFreight || 0,
            })),
          });
        }

        await tx.proforma.update({
          where: { id: proforma.id },
          data: {
            convertedToInvoiceId: created.id,
            convertedToInvoiceNumber: created.invoiceNumber,
            convertedAt: new Date(),
          },
        });

        if (proforma.customerId) {
          await tx.customer.update({
            where: { id: proforma.customerId },
            data: {
              totalOrders: { increment: 1 },
              currentBalance: { increment: proforma.grandTotal || 0 },
            },
          });
        }
        return tx.taxInvoice.findUnique({ where: { id: created.id }, include: { items: true } });
      });
    } catch (dbErr: any) {
      if (dbErr?.message === 'ALREADY_CONVERTED' || dbErr?.code === 'P2002') {
        const fresh = await prisma.proforma.findUnique({ where: { id: proforma.id } }).catch(() => null);
        throw new ServiceError(409, `Proforma already converted to ${fresh?.convertedToInvoiceNumber || 'a tax invoice'}`, {
          invoiceId: fresh?.convertedToInvoiceId,
        });
      }
      console.error('[Proforma convert] failed:', dbErr);
      throw new ServiceError(503, 'Conversion failed. Nothing was changed; please try again.');
    }

    if (actor) {
      await writeAudit(actor, {
        action: 'PROFORMA_CONVERTED', entityType: 'Proforma', entityId: proforma.id, entityLabel: proforma.proformaNumber,
        description: `Proforma ${proforma.proformaNumber} converted to tax invoice ${invoice?.invoiceNumber}`,
        newValue: { invoiceId: invoice?.id, invoiceNumber: invoice?.invoiceNumber },
      });
      await writeAudit(actor, {
        action: 'TAX_INVOICE_CREATED', entityType: 'TaxInvoice', entityId: invoice?.id, entityLabel: invoice?.invoiceNumber,
        description: `Tax invoice ${invoice?.invoiceNumber} created and issued from proforma ${proforma.proformaNumber}`,
      });
    }

    // Notify the Depot team (idempotent per invoice + recipient, so retries never double-send).
    triggerInvoiceCreatedDepotEmail(invoice).catch((e) => console.error('[Proforma convert] depot email failed:', e));

    try {
      broadcastSystemEvent({
        type: 'PROFORMA_UPDATED',
        id: proforma.id,
        proformaNumber: proforma.proformaNumber,
        status: 'CONVERTED',
        data: invoice,
      });
    } catch {}

  return invoice;
}
