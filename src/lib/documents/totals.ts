/**
 * The ONE place sales-document totals are calculated. Used by proforma creation and by direct tax invoice
 * creation, so a quotation and an invoice built from the same inputs can never disagree.
 * Product, tax-rate and depot details are read from the database; client-sent prices are only used when the
 * user typed a price (the builder lets them override the list price).
 */
import { dec, round2 } from '@/lib/money';
import { prisma } from '@/lib/prisma';
import { effectiveProductRate, getDefaultTax } from '@/lib/tax';
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
  /** Quantity x unit price, before any discount. */
  subtotal: number;
  discountPercent: number;
  /** Every discount on the document: the line discounts plus the document-level % of the discounted lines. */
  discountAmount: number;
  taxAmount: number;
  shippingCost: number;
  /** Additional charges outside freight. */
  otherCharges: number;
  grandTotal: number;
  freight: FreightResult;
}

export async function computeDocumentTotals(body: any): Promise<DocumentTotals> {
  const { items = [], customerId, discountPercent, shippingCost, freight, otherCharges } = body;

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

  const defaultTax = await getDefaultTax();
  const dbProducts = new Map<string, any>();
  const dbDepots = new Map<string, any>();
  try {
    const ids = Array.from(new Set(items.map((i: any) => String(i.productId)).filter(Boolean)));
    const depotIds = Array.from(new Set(items.map((i: any) => String(i.selectedDepotId)).filter(Boolean)));
    (await prisma.product.findMany({ where: { id: { in: ids as string[] } } })).forEach((p: any) => dbProducts.set(p.id, p));
    (await prisma.depot.findMany({ where: { id: { in: depotIds as string[] } }, select: { id: true, name: true } })).forEach((d: any) => dbDepots.set(d.id, d));
  } catch {}

  // Server-side validation: the browser is never trusted. A bad line is refused with a clear message instead of being
  // silently "fixed" (quantity 0 -> 1, unknown product -> placeholder name, negative price, discount over 100 %).
  if (!Array.isArray(items)) throw new TotalsError(400, 'Items must be a list.');
  items.forEach((item: any, i: number) => {
    const n = i + 1;
    if (!item || !item.productId) throw new TotalsError(400, `Line ${n}: select a product.`);
    if (!dbProducts.get(item.productId) && !dataStore.getProductById(item.productId)) throw new TotalsError(400, `Line ${n}: the selected product no longer exists. Remove it and add it again.`);
    const q = item.quantity === undefined || item.quantity === null || item.quantity === '' ? 1 : Number(item.quantity);
    if (!Number.isFinite(q) || q <= 0) throw new TotalsError(400, `Line ${n}: quantity must be greater than 0.`);
    const price = Number(item.unitPrice ?? 0);
    if (!Number.isFinite(price) || price < 0) throw new TotalsError(400, `Line ${n}: unit price cannot be negative.`);
    const d = Number(item.discountPercent ?? 0);
    if (!Number.isFinite(d) || d < 0 || d > 100) throw new TotalsError(400, `Line ${n}: discount must be between 0% and 100%.`);
  });
  const docDisc = Number(discountPercent ?? 0);
  if (!Number.isFinite(docDisc) || docDisc < 0 || docDisc > 100) throw new TotalsError(400, 'Document discount must be between 0% and 100%.');

  // Decimal arithmetic throughout (0.1 + 0.2 and 1.005 x 100 style float errors never reach a total).
  let subtotal = dec(0);
  let lineDiscounts = dec(0);
  let totalTax = dec(0);
  const lines: ResolvedLine[] = items.map((item: any) => {
    const product: any = dbProducts.get(item.productId) || dataStore.getProductById(item.productId);
    const depotName = dbDepots.get(item.selectedDepotId)?.name;
    // The product's tax (the configured default unless it has a custom rate). Nothing is assumed when it is missing.
    // `taxRateManual` keeps the rate already on the document (or one the user typed) instead of the product's current one.
    const manualRate = item.taxRateManual ? Number(item.taxRate) : NaN;
    const taxRate = Number.isFinite(manualRate) ? Math.min(100, Math.max(0, manualRate)) : product ? effectiveProductRate(product, defaultTax) : Number(item.taxRate ?? defaultTax.rate);
    // `priceManual` = the price on the line is final, even 0 (a free item); otherwise an empty price falls back to the list price.
    const unitPrice = item.priceManual ? Math.max(0, Number(item.unitPrice) || 0) : Number(item.unitPrice || product?.wholesalePrice || product?.sellingPrice || 0);
    const quantity = item.quantity === undefined || item.quantity === null || item.quantity === '' ? 1 : Number(item.quantity);
    const itemDisc = Number(item.discountPercent) || 0;
    const gross = dec(quantity).times(unitPrice);
    const itemSub = gross.times(dec(100).minus(itemDisc)).div(100);
    const itemTax = itemSub.times(taxRate).div(100);

    subtotal = subtotal.plus(gross);
    lineDiscounts = lineDiscounts.plus(gross.minus(itemSub));
    totalTax = totalTax.plus(itemTax);

    return {
      productId: item.productId,
      productSku: product?.sku || item.productSku || 'SKU',
      productName: product?.name || item.productName || 'Product',
      brand: product?.brand || item.brand || 'Brand',
      quantity,
      unitPrice,
      discountPercent: itemDisc,
      taxRate,
      taxAmount: round2(itemTax),
      totalPrice: round2(itemSub.plus(itemTax)),
      selectedDepotId: item.selectedDepotId || null,
      selectedDepotName: item.selectedDepotId ? depotName || item.selectedDepotName || null : null,
      trackSerial: product?.trackSerial ?? true,
      unitWeightKg: Number(item.unitWeightKg) || 0,
      lengthCm: Number(item.lengthCm) || 0,
      widthCm: Number(item.widthCm) || 0,
      heightCm: Number(item.heightCm) || 0,
    };
  });

  // Line discounts reduce the total too (they used to lower only the tax). With no line discount this is the same
  // figure as before: subtotal x document %.
  const discPercent = docDisc;
  const discountAmount = round2(lineDiscounts.plus(subtotal.minus(lineDiscounts).times(discPercent).div(100)));
  const extra = Math.max(0, Number(otherCharges) || 0);

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
  const taxAmount = round2(totalTax);

  return {
    customer,
    lines,
    subtotal: subtotal.toNumber(),
    discountPercent: discPercent,
    discountAmount,
    taxAmount,
    shippingCost: shipCost,
    otherCharges: extra,
    grandTotal: round2(subtotal.minus(discountAmount).plus(totalTax).plus(shipCost).plus(extra)),
    freight: freightResult,
  };
}
