import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';
import { calculateFreight } from '@/lib/freight';

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
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    // Freight defaults (volumetric divisor / rate) are configurable, never
    // hardcoded — read from CompanySettings unless the caller overrides them.
    let freightDefaults: { freightVolumetricDivisor?: number; freightDefaultRatePerKg?: number } | null = null;
    try {
      freightDefaults = await prisma.companySettings.findUnique({ where: { id: 'global-settings' } });
    } catch {}
    if (!freightDefaults) freightDefaults = dataStore.getCompanySettings() as any;

    // Resolve items and calculate totals
    let subtotal = 0;
    let totalTax = 0;

    const resolvedItems = items.map((item: any) => {
      const fallbackProduct = dataStore.getProductById(item.productId);
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
        productSku: item.productSku || fallbackProduct?.sku || 'SKU',
        productName: item.productName || fallbackProduct?.name || 'Product',
        brand: item.brand || fallbackProduct?.brand || 'Brand',
        quantity,
        unitPrice,
        discountPercent: itemDisc,
        taxRate,
        taxAmount: Number(itemTax.toFixed(2)),
        totalPrice: Number(itemTotal.toFixed(2)),
        selectedDepotId: item.selectedDepotId || 'dep-central',
        selectedDepotName: item.selectedDepotName || 'Central Depot',
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
        return NextResponse.json(
          { error: 'Failed to save proforma. The database may be temporarily unavailable — please try again.' },
          { status: 503 }
        );
      }
    }

    return NextResponse.json(proforma, { status: 201 });
  } catch (error: any) {
    console.error('Error creating proforma:', error);
    return NextResponse.json({ error: error?.message || 'Failed to create proforma' }, { status: 500 });
  }
}
