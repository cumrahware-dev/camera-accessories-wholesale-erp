import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { calculateFreight } from '@/lib/freight';
import { broadcastSystemEvent } from '@/lib/events-emitter';
import { triggerInvoiceCreatedDepotEmail } from '@/lib/email-service';
import { canTransition, ProformaStatus } from '@/lib/proforma-workflow';

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
    const {
      items = [],
      customerId,
      discountPercent,
      shippingCost,
      notes,
      deliveryTerms,
      paymentTerms,
      expiryDays,
      freight,
    } = body;

    // Get customer details (DB first, then dataStore fallback)
    let customer: any = null;
    try {
      customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });
    } catch {}

    if (!customer) {
      customer = dataStore.getCustomerById(customerId);
    }

    if (!customer) {
      throw new ServiceError(404, 'Customer not found');
    }

    // Freight defaults (volumetric divisor / rate) are configurable, never
    // hardcoded — read from CompanySettings unless the caller overrides them.
    let freightDefaults: { freightVolumetricDivisor?: number; freightDefaultRatePerKg?: number } | null = null;
    try {
      freightDefaults = await prisma.companySettings.findUnique({ where: { id: 'global-settings' } });
    } catch {}
    if (!freightDefaults) freightDefaults = dataStore.getCompanySettings() as any;

    // Resolve items and calculate totals. Product and depot details come from the database;
    // the in-memory dataStore is only a development fallback.
    let subtotal = 0;
    let totalTax = 0;

    const dbProducts = new Map<string, any>();
    const dbDepots = new Map<string, any>();
    try {
      const ids = Array.from(new Set(items.map((i: any) => String(i.productId)).filter(Boolean)));
      const depotIds = Array.from(new Set(items.map((i: any) => String(i.selectedDepotId)).filter(Boolean)));
      (await prisma.product.findMany({ where: { id: { in: ids as string[] } } })).forEach((p: any) => dbProducts.set(p.id, p));
      (await prisma.depot.findMany({ where: { id: { in: depotIds as string[] } }, select: { id: true, name: true } })).forEach((d: any) => dbDepots.set(d.id, d));
    } catch {}

    const resolvedItems = items.map((item: any) => {
      const fallbackProduct: any = dbProducts.get(item.productId) || dataStore.getProductById(item.productId);
      const depotName = dbDepots.get(item.selectedDepotId)?.name;
      const taxRate = Number(fallbackProduct?.taxRate ?? item.taxRate ?? 5);
      const unitPrice = Number(item.unitPrice || fallbackProduct?.wholesalePrice || fallbackProduct?.sellingPrice || 0);
      const quantity = Number(item.quantity) || 1;
      const itemDisc = Number(item.discountPercent) || 0;
      const itemSub = quantity * unitPrice * (1 - itemDisc / 100);
      const itemTax = itemSub * (taxRate / 100);
      const itemTotal = itemSub + itemTax;

      subtotal += quantity * unitPrice;
      totalTax += itemTax;

      return {
        id: `pfi-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        productId: item.productId,
        productSku: fallbackProduct?.sku || item.productSku || 'SKU',
        productName: fallbackProduct?.name || item.productName || 'Product',
        brand: fallbackProduct?.brand || item.brand || 'Brand',
        quantity,
        unitPrice,
        discountPercent: itemDisc,
        taxRate,
        taxAmount: Number(itemTax.toFixed(2)),
        totalPrice: Number(itemTotal.toFixed(2)),
        selectedDepotId: item.selectedDepotId || 'dep-central',
        selectedDepotName: depotName || item.selectedDepotName || 'Central Depot',
        trackSerial: fallbackProduct?.trackSerial ?? true,
        unitWeightKg: Number(item.unitWeightKg) || 0,
        lengthCm: Number(item.lengthCm) || 0,
        widthCm: Number(item.widthCm) || 0,
        heightCm: Number(item.heightCm) || 0,
      };
    });

    const discPercent = Number(discountPercent) || 0;
    const discountAmount = (subtotal * discPercent) / 100;

    // Total Freight is computed authoritatively here (never trusted verbatim
    // from the client) so it can never drift from the weights/rate that
    // produced it, and is used once — as shippingCost — never duplicated.
    // Callers that don't send a `freight` breakdown (legacy/manual entry, or
    // AI PDF extraction) fall back to treating the raw shippingCost as a
    // manual override, preserving prior behavior exactly.
    const freightResult = calculateFreight({
      items: resolvedItems,
      volumetricDivisor: Number(freight?.volumetricDivisor ?? freightDefaults?.freightVolumetricDivisor) || 0,
      freightRatePerKg: Number(freight?.freightRatePerKg ?? freightDefaults?.freightDefaultRatePerKg) || 0,
      additionalFreightCharges: Number(freight?.additionalFreightCharges) || 0,
      isManualOverride: freight ? Boolean(freight.isManualOverride) : true,
      manualTotalFreight: Number(freight?.manualTotalFreight ?? shippingCost) || 0,
    });
    const shipCost = freightResult.totalFreight;
    const grandTotal = Number((subtotal - discountAmount + totalTax + shipCost).toFixed(2));

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
          items: resolvedItems,
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
export async function confirmProforma(id: string): Promise<any> {
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

  try {
    broadcastSystemEvent({ type: 'PROFORMA_CONFIRMED', id: proforma.id, proformaNumber: proforma.proformaNumber, status: proforma.status, data: proforma });
  } catch (evtErr) {
    console.warn('Could not broadcast confirmation event:', evtErr);
  }
  return proforma;
}

/** Atomic CONFIRMED -> CONVERTED tax invoice creation (shared with POST /api/proformas/[id]/convert). */
export async function convertProformaToInvoice(id: string, depotId?: string): Promise<any> {
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

    const finalDepotId = depotId || 'dep-central';
    const depot = dataStore.getDepotById(finalDepotId);
    const finalDepotName = depot?.name || 'Central Depot';

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

        const settings = await tx.companySettings.update({
          where: { id: 'global-settings' },
          data: { invoiceNextNumber: { increment: 1 } },
        });
        const invoiceNumber = `${settings.invoicePrefix || 'INV-2026-'}${String(settings.invoiceNextNumber - 1).padStart(5, '0')}`;

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
            notes: proforma.notes,
            subtotal: proforma.subtotal,
            discountAmount: proforma.discountAmount,
            taxAmount: proforma.taxAmount,
            shippingCost: proforma.shippingCost,
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
