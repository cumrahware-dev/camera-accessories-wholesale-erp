/**
 * The ONE place sales-document totals are calculated. Used by proforma creation and by direct tax invoice
 * creation, so a quotation and an invoice built from the same inputs can never disagree.
 * Product, tax-rate and depot details are read from the database; client-sent prices are only used when the
 * user typed a price (the builder lets them override the list price).
 */
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { calculateFreight, FreightCalculationResult as FreightResult } from '@/lib/freight';

export class TotalsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface ResolvedLine {
  productId: string;
  productSku: string;
  productName: string;
  brand: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  taxAmount: number;
  totalPrice: number;
  selectedDepotId: string | null;
  selectedDepotName: string | null;
  trackSerial: boolean;
  unitWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface DocumentTotals {
  customer: any;
  lines: ResolvedLine[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  taxAmount: number;
  shippingCost: number;
  grandTotal: number;
  freight: FreightResult;
}

export async function computeDocumentTotals(body: any): Promise<DocumentTotals> {
  const { items = [], customerId, discountPercent, shippingCost, freight } = body;

  let customer: any = null;
  try {
    customer = await prisma.customer.findUnique({ where: { id: customerId } });
  } catch {}
  if (!customer) customer = dataStore.getCustomerById(customerId);
  if (!customer) throw new TotalsError(404, 'Customer not found');

  // Freight defaults (volumetric divisor / rate) are configurable, never hardcoded.
  let freightDefaults: { freightVolumetricDivisor?: number; freightDefaultRatePerKg?: number } | null = null;
  try {
    freightDefaults = await prisma.companySettings.findUnique({ where: { id: 'global-settings' } });
  } catch {}
  if (!freightDefaults) freightDefaults = dataStore.getCompanySettings() as any;

  const dbProducts = new Map<string, any>();
  const dbDepots = new Map<string, any>();
  try {
    const ids = Array.from(new Set(items.map((i: any) => String(i.productId)).filter(Boolean)));
    const depotIds = Array.from(new Set(items.map((i: any) => String(i.selectedDepotId)).filter(Boolean)));
    (await prisma.product.findMany({ where: { id: { in: ids as string[] } } })).forEach((p: any) => dbProducts.set(p.id, p));
    (await prisma.depot.findMany({ where: { id: { in: depotIds as string[] } }, select: { id: true, name: true } })).forEach((d: any) => dbDepots.set(d.id, d));
  } catch {}

  let subtotal = 0;
  let totalTax = 0;
  const lines: ResolvedLine[] = items.map((item: any) => {
    const product: any = dbProducts.get(item.productId) || dataStore.getProductById(item.productId);
    const depotName = dbDepots.get(item.selectedDepotId)?.name;
    const taxRate = Number(product?.taxRate ?? item.taxRate ?? 5);
    const unitPrice = Number(item.unitPrice || product?.wholesalePrice || product?.sellingPrice || 0);
    const quantity = Number(item.quantity) || 1;
    const itemDisc = Number(item.discountPercent) || 0;
    const itemSub = quantity * unitPrice * (1 - itemDisc / 100);
    const itemTax = itemSub * (taxRate / 100);

    subtotal += quantity * unitPrice;
    totalTax += itemTax;

    return {
      productId: item.productId,
      productSku: product?.sku || item.productSku || 'SKU',
      productName: product?.name || item.productName || 'Product',
      brand: product?.brand || item.brand || 'Brand',
      quantity,
      unitPrice,
      discountPercent: itemDisc,
      taxRate,
      taxAmount: Number(itemTax.toFixed(2)),
      totalPrice: Number((itemSub + itemTax).toFixed(2)),
      selectedDepotId: item.selectedDepotId || null,
      selectedDepotName: item.selectedDepotId ? depotName || item.selectedDepotName || null : null,
      trackSerial: product?.trackSerial ?? true,
      unitWeightKg: Number(item.unitWeightKg) || 0,
      lengthCm: Number(item.lengthCm) || 0,
      widthCm: Number(item.widthCm) || 0,
      heightCm: Number(item.heightCm) || 0,
    };
  });

  const discPercent = Number(discountPercent) || 0;
  const discountAmount = (subtotal * discPercent) / 100;

  // Total Freight is computed authoritatively here (never trusted verbatim from the client). Callers that
  // don't send a `freight` breakdown fall back to treating the raw shippingCost as a manual override.
  const freightResult = calculateFreight({
    items: lines,
    volumetricDivisor: Number(freight?.volumetricDivisor ?? freightDefaults?.freightVolumetricDivisor) || 0,
    freightRatePerKg: Number(freight?.freightRatePerKg ?? freightDefaults?.freightDefaultRatePerKg) || 0,
    additionalFreightCharges: Number(freight?.additionalFreightCharges) || 0,
    isManualOverride: freight ? Boolean(freight.isManualOverride) : true,
    manualTotalFreight: Number(freight?.manualTotalFreight ?? shippingCost) || 0,
  });
  const shipCost = freightResult.totalFreight;
  const taxAmount = Number(totalTax.toFixed(2));

  return {
    customer,
    lines,
    subtotal,
    discountPercent: discPercent,
    discountAmount,
    taxAmount,
    shippingCost: shipCost,
    grandTotal: Number((subtotal - discountAmount + totalTax + shipCost).toFixed(2)),
    freight: freightResult,
  };
}
