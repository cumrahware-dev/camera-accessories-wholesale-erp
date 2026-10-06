/**
 * Tax invoice lifecycle:
 *
 *   createDirectInvoice / convertProformaToInvoice -> DRAFT  (placeholder number, invisible to the depot, editable, deletable)
 *   updateDraftInvoice                              -> DRAFT  (customer, depot, terms, items, discount, tax, freight, charges)
 *   issueInvoice                                    -> ISSUED (stock checked, real invoice number, customer balance, depot queue)
 *   (email worker)                                  -> SENT   (only after the provider accepted the email)
 *   reissueInvoice                                  -> the issued invoice is CANCELLED and a new DRAFT copy replaces it
 *
 * An issued invoice is never edited in place. Totals come from computeDocumentTotals, the same calculator proformas use;
 * invoice numbers come from allocateInvoiceNumber, the same sequence for every invoice.
 */
import { Prisma } from '@prisma/client';
import { stampSnapshot } from '@/lib/company';
import { cleanIncoterm, cleanText, defaultsFromCustomer, dueDaysForTerms, MAX_PLACE, printableDelivery } from '@/lib/documents/terms';
import { prisma } from '@/lib/prisma';
import { computeDocumentTotals, TotalsError } from '@/lib/documents/totals';
import { calculateFreight } from '@/lib/freight';
import { triggerInvoiceCreatedDepotEmail } from '@/lib/email-service';
import { broadcastSystemEvent } from '@/lib/events-emitter';
import { writeAudit, writeAuditMany, type Actor, type AuditEntry } from '@/lib/audit';
import { restoreStockForCancelledInvoice } from '@/lib/inventory-service';
import { ServiceError } from '@/lib/services/proforma-service';

const DAY = 24 * 60 * 60 * 1000;
const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Next number from the single tax-invoice sequence. Must run inside the transaction that uses it. */
export async function allocateInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const settings = await tx.companySettings.update({
    where: { id: 'global-settings' },
    data: { invoiceNextNumber: { increment: 1 } },
  });
  return `${settings.invoicePrefix || 'INV-2026-'}${String(settings.invoiceNextNumber - 1).padStart(5, '0')}`;
}

export const isDraftNumber = (n: string | null | undefined) => !!n && n.startsWith('DRAFT-');

/** Placeholder number for a draft. The legal number is assigned at issue time, so a deleted draft never leaves a gap. */
export const newDraftNumber = () => `DRAFT-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

// Orders that are issued but not yet shipped: their stock is still on the shelf but already promised.
const OPEN_DOCUMENT = ['ISSUED', 'SENT'] as const;
const OPEN_FULFILMENT = ['READY_FOR_PACKING', 'PROCESSING', 'PACKED'] as const;

export interface StockLine { productId: string; productSku?: string; productName?: string; quantity: number }
export interface StockStatus { productId: string; productSku: string; productName: string; needed: number; onHand: number; reserved: number; available: number; short: boolean }

/**
 * Stock position of each product at one depot: what is on hand, how much other issued-but-unshipped orders already
 * need, and whether this document fits in what is left. Stock only leaves the depot at dispatch, so the open orders
 * are counted here to make sure issuing can never promise stock that is not there.
 */
export async function stockPosition(db: Prisma.TransactionClient | typeof prisma, depotId: string, lines: StockLine[], excludeInvoiceId?: string): Promise<StockStatus[]> {
  const need = new Map<string, StockLine & { quantity: number }>();
  for (const l of lines) {
    if (!l.productId || !(Number(l.quantity) > 0)) continue;
    const cur = need.get(l.productId);
    need.set(l.productId, { ...l, quantity: (cur?.quantity || 0) + Number(l.quantity) });
  }
  if (!need.size) return [];
  const ids = Array.from(need.keys());
  const [inv, reserved] = await Promise.all([
    db.depotInventory.findMany({ where: { depotId, productId: { in: ids } }, select: { productId: true, availableQuantity: true } }),
    db.invoiceItem.groupBy({
      by: ['productId'],
      where: {
        productId: { in: ids },
        invoice: {
          depotId,
          documentStatus: { in: [...OPEN_DOCUMENT] },
          fulfilmentStatus: { in: [...OPEN_FULFILMENT] },
          ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
        },
      },
      _sum: { quantity: true },
    }),
  ]);
  const onHand = new Map(inv.map((r) => [r.productId, Number(r.availableQuantity) || 0]));
  const held = new Map(reserved.map((r) => [r.productId, Number(r._sum.quantity) || 0]));
  return ids.map((pid) => {
    const l = need.get(pid)!;
    const h = onHand.get(pid) ?? 0;
    const res = held.get(pid) ?? 0;
    const available = Math.max(0, h - res);
    return { productId: pid, productSku: l.productSku || '', productName: l.productName || '', needed: l.quantity, onHand: h, reserved: res, available, short: available < l.quantity };
  });
}

const shortageMessage = (short: StockStatus[], depotName: string) =>
  `Not enough stock at ${depotName}: ` +
  short.map((s) => `${s.productSku || s.productName} needs ${s.needed}, available ${s.available}${s.reserved ? ` (${s.onHand} on hand, ${s.reserved} reserved for open orders)` : ''}`).join('; ') +
  '. Reduce the quantity, choose another depot, or receive stock first.';

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

  const depotId: string = body.depotId || lines[0].selectedDepotId || '';
  const depot = depotId ? await prisma.depot.findUnique({ where: { id: depotId }, select: { id: true, name: true, status: true } }).catch(() => null) : null;
  if (!depot) throw new ServiceError(400, 'Select the depot that will fulfil this invoice.');
  if (depot.status !== 'ACTIVE') throw new ServiceError(400, `${depot.name} is inactive. Choose an active depot.`);
  const dueDays = Math.max(0, Math.min(365, Number(body.dueDays ?? 30) || 0));

  const invoice = await prisma.taxInvoice.create({
    data: {
      invoiceNumber: newDraftNumber(),
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
      // Direct invoices: what the user chose wins; otherwise the customer's own defaults. Never invented.
      paymentTerms: body.paymentTerms !== undefined && String(body.paymentTerms).trim() !== '' ? cleanText(body.paymentTerms, 120) : defaultsFromCustomer(customer as any).paymentTerms,
      paymentMethod: body.paymentMethod !== undefined ? cleanText(body.paymentMethod, 40) : defaultsFromCustomer(customer as any).paymentMethod,
      incoterm: cleanIncoterm(body.incoterm),
      incotermPlace: cleanIncoterm(body.incoterm) ? cleanText(body.incotermPlace, MAX_PLACE) : '',
      deliveryTerms: printableDelivery(cleanText(body.deliveryTerms, 200)),
      notes: body.notes || '',
      currency: body.currency || 'USD',
      subtotal: totals.subtotal,
      discountPercent: totals.discountPercent,
      discountAmount: totals.discountAmount,
      taxAmount: totals.taxAmount,
      shippingCost: totals.shippingCost,
      otherCharges: totals.otherCharges,
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
          discountPercent: l.discountPercent,
          taxRate: l.taxRate,
          taxAmount: l.taxAmount,
          totalPrice: l.totalPrice,
          depotId: depot.id,
          depotName: depot.name,
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

// ─── Draft editing ───────────────────────────────────────────────────────────

type InvoiceWithItems = Prisma.TaxInvoiceGetPayload<{ include: { items: true } }>;

const findInvoice = (id: string) =>
  prisma.taxInvoice.findFirst({ where: { OR: [{ id }, { invoiceNumber: id }] }, include: { items: true } });

const label = (inv: { documentStatus: string; invoiceNumber: string; proformaNumber?: string | null }) =>
  inv.documentStatus === 'DRAFT' ? `Draft invoice${inv.proformaNumber ? ` (from ${inv.proformaNumber})` : ''}` : inv.invoiceNumber;

const num = (v: unknown, fallback: number) => (v === undefined || v === null || v === '' ? fallback : Number(v));

/** The freight inputs that reproduce what is stored on the invoice. Old rows that do not add up are treated as a manual figure. */
function storedFreight(inv: InvoiceWithItems) {
  const params = {
    volumetricDivisor: Number(inv.freightVolumetricDivisor) || 0,
    freightRatePerKg: Number(inv.freightRatePerKg) || 0,
    additionalFreightCharges: Number(inv.additionalFreightCharges) || 0,
  };
  if (inv.freightIsManualOverride) return { ...params, isManualOverride: true, manualTotalFreight: Number(inv.shippingCost) || 0 };
  const recomputed = calculateFreight({ items: inv.items as any, ...params, isManualOverride: false });
  const matches = Math.abs(recomputed.totalFreight - (Number(inv.shippingCost) || 0)) < 0.005;
  return { ...params, isManualOverride: !matches, manualTotalFreight: Number(inv.shippingCost) || 0 };
}

interface DraftPlan {
  existing: InvoiceWithItems;
  data: Prisma.TaxInvoiceUncheckedUpdateManyInput;
  lines: Array<{ existingId?: string; row: Omit<Prisma.InvoiceItemCreateManyInput, 'invoiceId'> & { quantity: number } }>;
  itemsChanged: boolean;
  removedIds: string[];
  audit: AuditEntry[];
  warnings: string[];
  depot: { id: string; name: string };
  customer: any;
  totals: { subtotal: number; discountPercent: number; discountAmount: number; taxAmount: number; shippingCost: number; otherCharges: number; grandTotal: number; freight: any };
}

/**
 * Validates an edit to a DRAFT invoice and works out the new figures with the shared calculator. Nothing is written.
 * Used both for the live preview and for the save, so what the user sees is exactly what gets stored.
 */
async function planDraftUpdate(existing: InvoiceWithItems, body: any): Promise<DraftPlan> {
  if (existing.documentStatus !== 'DRAFT') {
    throw new ServiceError(409, `Invoice ${existing.invoiceNumber} has been issued and is final. Use "Cancel & Reissue" to correct it.`);
  }
  const warnings: string[] = [];
  const entity = { entityType: 'TaxInvoice', entityId: existing.id, entityLabel: label(existing) };
  const audit: AuditEntry[] = [];
  const change = (action: string, description: string, previousValue: unknown, newValue: unknown) =>
    audit.push({ action, ...entity, description, previousValue, newValue, depotId: existing.depotId, depotName: existing.depotName });

  // ── customer ──
  const customerId = body.customerId ? String(body.customerId) : existing.customerId;
  const customerChanged = customerId !== existing.customerId;
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new ServiceError(400, 'The selected customer no longer exists.');
  if (customerChanged && customer.status === 'INACTIVE') throw new ServiceError(400, `${customer.companyName} is inactive and cannot be invoiced.`);
  if (customer.status === 'ON_HOLD') warnings.push(`${customer.companyName} is on hold. Check with accounts before issuing.`);

  // ── depot ──
  const depotId = body.depotId ? String(body.depotId) : existing.depotId;
  const depotRow = await prisma.depot.findUnique({ where: { id: depotId }, select: { id: true, name: true, status: true } });
  if (!depotRow) throw new ServiceError(400, 'The selected dispatch depot no longer exists. Choose another depot.');
  if (depotRow.status !== 'ACTIVE') {
    if (depotId !== existing.depotId) throw new ServiceError(400, `${depotRow.name} is inactive and cannot be used. Choose an active depot.`);
    warnings.push(`${depotRow.name} is inactive. Choose an active depot before issuing.`);
  }

  // ── terms ── what is sent wins; on a customer change the new customer's defaults are used only when asked for.
  const custDefaults = defaultsFromCustomer(customer as any);
  const terms = {
    paymentTerms: body.paymentTerms !== undefined ? cleanText(body.paymentTerms, 120) : customerChanged && body.applyCustomerDefaults ? custDefaults.paymentTerms : existing.paymentTerms,
    paymentMethod: body.paymentMethod !== undefined ? cleanText(body.paymentMethod, 40) : customerChanged && body.applyCustomerDefaults ? custDefaults.paymentMethod : existing.paymentMethod,
    incoterm: body.incoterm !== undefined ? cleanIncoterm(body.incoterm) : existing.incoterm,
    incotermPlace: '',
    deliveryTerms: body.deliveryTerms !== undefined ? printableDelivery(cleanText(body.deliveryTerms, 200)) : existing.deliveryTerms,
  };
  terms.incotermPlace = terms.incoterm ? (body.incotermPlace !== undefined ? cleanText(body.incotermPlace, MAX_PLACE) : existing.incotermPlace) : '';
  if (customerChanged && !body.applyCustomerDefaults && body.paymentTerms === undefined && custDefaults.paymentTerms && custDefaults.paymentTerms !== terms.paymentTerms) {
    warnings.push(`${customer.companyName}'s usual payment terms are "${custDefaults.paymentTerms}"; this invoice keeps "${terms.paymentTerms || 'Not specified'}".`);
  }

  // ── commercial figures ──
  const discountPercent = num(body.discountPercent, Number(existing.discountPercent) || 0);
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new ServiceError(400, 'The discount must be between 0 and 100%.');
  const otherCharges = num(body.otherCharges, Number(existing.otherCharges) || 0);
  if (!Number.isFinite(otherCharges) || otherCharges < 0) throw new ServiceError(400, 'Additional charges cannot be negative.');
  const freightIn = { ...storedFreight(existing), ...(body.freight && typeof body.freight === 'object' ? body.freight : {}) };
  for (const k of ['manualTotalFreight', 'freightRatePerKg', 'additionalFreightCharges'] as const) {
    const v = Number((freightIn as any)[k] ?? 0);
    if (!Number.isFinite(v) || v < 0) throw new ServiceError(400, 'Freight figures cannot be negative.');
  }
  const notes = body.notes !== undefined ? cleanText(body.notes, 2000) : existing.notes || '';

  // ── items ──
  const byId = new Map(existing.items.map((i) => [i.id, i]));
  const incoming: any[] = Array.isArray(body.items)
    ? body.items
    : existing.items.map((i) => ({ id: i.id, productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, discountPercent: i.discountPercent, taxRate: i.taxRate }));
  if (!incoming.length) throw new ServiceError(400, 'An invoice needs at least one product.');
  const products = await prisma.product.findMany({ where: { id: { in: Array.from(new Set(incoming.map((l) => String(l.productId || '')))) } } });
  const productMap = new Map(products.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const calcItems = incoming.map((l, idx) => {
    const n = idx + 1;
    const ex = l.id ? byId.get(String(l.id)) : undefined;
    if (l.id && !ex) throw new ServiceError(409, `Line ${n} no longer exists on this invoice. Reload and try again.`);
    if (ex) {
      if (seen.has(ex.id)) throw new ServiceError(400, `Line ${n} is listed twice.`);
      seen.add(ex.id);
    }
    const product = productMap.get(String(l.productId));
    if (!product) throw new ServiceError(400, `Line ${n}: product not found.`);
    if (ex && ex.productId !== product.id) throw new ServiceError(400, `Line ${n}: the product of an existing line cannot be swapped. Remove it and add the new product.`);
    if (!ex && product.status !== 'ACTIVE') throw new ServiceError(400, `${product.name} is not active and cannot be added.`);
    const quantity = num(l.quantity, NaN);
    const unitPrice = num(l.unitPrice, NaN); // an empty price is an error, never 0
    const disc = num(l.discountPercent, 0);
    // An existing line keeps the tax it already has unless the user changes it; a new line starts from the product's tax.
    const rawTax = l.taxRate === undefined || l.taxRate === null || l.taxRate === '' ? (ex ? ex.taxRate : null) : Number(l.taxRate);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new ServiceError(400, `${product.name}: quantity must be a whole number of at least 1.`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new ServiceError(400, `${product.name}: enter a valid unit price.`);
    if (!Number.isFinite(disc) || disc < 0 || disc > 100) throw new ServiceError(400, `${product.name}: the discount must be between 0 and 100%.`);
    if (rawTax !== null && (!Number.isFinite(rawTax) || rawTax < 0 || rawTax > 100)) throw new ServiceError(400, `${product.name}: the tax rate must be between 0 and 100%.`);
    return {
      ex,
      product,
      input: {
        productId: product.id, quantity, unitPrice, priceManual: true, discountPercent: disc,
        taxRate: rawTax ?? undefined, taxRateManual: rawTax !== null, selectedDepotId: depotRow.id,
        unitWeightKg: ex?.unitWeightKg || 0, lengthCm: ex?.lengthCm || 0, widthCm: ex?.widthCm || 0, heightCm: ex?.heightCm || 0,
      },
    };
  });

  let totals;
  try {
    totals = await computeDocumentTotals({ customerId, items: calcItems.map((c) => c.input), discountPercent, freight: freightIn, otherCharges });
  } catch (e: any) {
    if (e instanceof TotalsError) throw new ServiceError(e.status, e.message);
    throw e;
  }

  const lines = totals.lines.map((rl, i) => {
    const { ex, product } = calcItems[i];
    return {
      existingId: ex?.id,
      row: {
        productId: rl.productId,
        // an existing line keeps the description it was quoted with
        productSku: ex?.productSku || rl.productSku,
        productName: ex?.productName || rl.productName,
        brand: ex?.brand || rl.brand,
        quantity: rl.quantity,
        unitPrice: rl.unitPrice,
        discountPercent: rl.discountPercent,
        taxRate: rl.taxRate,
        taxAmount: rl.taxAmount,
        totalPrice: rl.totalPrice,
        depotId: depotRow.id,
        depotName: depotRow.name,
        trackSerial: ex?.trackSerial ?? product.trackSerial,
        unitWeightKg: rl.unitWeightKg,
        lengthCm: rl.lengthCm,
        widthCm: rl.widthCm,
        heightCm: rl.heightCm,
        allocatedFreight: 0,
      },
    };
  });
  const keep = new Set(lines.map((l) => l.existingId).filter(Boolean) as string[]);
  const removed = existing.items.filter((i) => !keep.has(i.id));

  // ── what changed (for the audit trail) ──
  for (const l of lines) {
    const ex = l.existingId ? byId.get(l.existingId)! : undefined;
    const name = `${l.row.productName} (${l.row.productSku})`;
    if (!ex) { change('INVOICE_PRODUCT_ADDED', `Added ${name} × ${l.row.quantity} @ ${r2(l.row.unitPrice)}`, null, { productId: l.row.productId, quantity: l.row.quantity, unitPrice: l.row.unitPrice }); continue; }
    if (ex.quantity !== l.row.quantity) change('INVOICE_QUANTITY_CHANGED', `Quantity of ${name} changed from ${ex.quantity} to ${l.row.quantity}`, ex.quantity, l.row.quantity);
    if (r2(ex.unitPrice) !== r2(l.row.unitPrice)) change('INVOICE_PRICE_CHANGED', `Unit price of ${name} changed from ${r2(ex.unitPrice)} to ${r2(l.row.unitPrice)}`, ex.unitPrice, l.row.unitPrice);
    if ((Number(ex.discountPercent) || 0) !== l.row.discountPercent) change('INVOICE_DISCOUNT_CHANGED', `Line discount of ${name} changed from ${ex.discountPercent || 0}% to ${l.row.discountPercent}%`, ex.discountPercent || 0, l.row.discountPercent);
    if ((Number(ex.taxRate) || 0) !== l.row.taxRate) change('INVOICE_TAX_CHANGED', `Tax rate of ${name} changed from ${ex.taxRate}% to ${l.row.taxRate}%`, ex.taxRate, l.row.taxRate);
  }
  for (const r of removed) change('INVOICE_PRODUCT_REMOVED', `Removed ${r.productName} (${r.productSku}) × ${r.quantity}`, { productId: r.productId, quantity: r.quantity, unitPrice: r.unitPrice }, null);
  const itemsChanged = removed.length > 0 || audit.length > 0;

  if (customerChanged) change('INVOICE_CUSTOMER_CHANGED', `Customer changed from ${existing.customerCompany} to ${customer.companyName}`, { id: existing.customerId, name: existing.customerCompany }, { id: customer.id, name: customer.companyName });
  if (depotRow.id !== existing.depotId) change('INVOICE_DEPOT_CHANGED', `Dispatch depot changed from ${existing.depotName} to ${depotRow.name}`, { id: existing.depotId, name: existing.depotName }, { id: depotRow.id, name: depotRow.name });
  if (terms.paymentTerms !== existing.paymentTerms) change('INVOICE_PAYMENT_TERMS_CHANGED', `Payment terms changed from "${existing.paymentTerms || 'Not specified'}" to "${terms.paymentTerms || 'Not specified'}"`, existing.paymentTerms, terms.paymentTerms);
  if (terms.paymentMethod !== existing.paymentMethod) change('INVOICE_PAYMENT_METHOD_CHANGED', `Payment method changed from "${existing.paymentMethod || 'Not specified'}" to "${terms.paymentMethod || 'Not specified'}"`, existing.paymentMethod, terms.paymentMethod);
  if (terms.incoterm !== existing.incoterm || terms.incotermPlace !== existing.incotermPlace) {
    change('INVOICE_INCOTERM_CHANGED', `Incoterm changed from "${[existing.incoterm, existing.incotermPlace].filter(Boolean).join(' — ') || 'Not specified'}" to "${[terms.incoterm, terms.incotermPlace].filter(Boolean).join(' — ') || 'Not specified'}"`, { incoterm: existing.incoterm, place: existing.incotermPlace }, { incoterm: terms.incoterm, place: terms.incotermPlace });
  }
  if (terms.deliveryTerms !== existing.deliveryTerms) change('INVOICE_DELIVERY_TERMS_CHANGED', 'Delivery note changed', existing.deliveryTerms, terms.deliveryTerms);
  if (totals.discountPercent !== (Number(existing.discountPercent) || 0)) change('INVOICE_DISCOUNT_CHANGED', `Invoice discount changed from ${existing.discountPercent || 0}% to ${totals.discountPercent}%`, existing.discountPercent || 0, totals.discountPercent);
  // A different freight figure, or a different rate while the freight is calculated from it. Switching between "fixed" and
  // "rate x weight" alone, with the same result, is not a change.
  if (r2(totals.shippingCost) !== r2(existing.shippingCost) || (!totals.freight.freightIsManualOverride && r2(totals.freight.freightRatePerKg) !== r2(existing.freightRatePerKg))) {
    change('INVOICE_FREIGHT_CHANGED', `Freight changed from ${r2(existing.shippingCost)} to ${r2(totals.shippingCost)}`, { total: existing.shippingCost, manual: existing.freightIsManualOverride, ratePerKg: existing.freightRatePerKg }, { total: totals.shippingCost, manual: totals.freight.freightIsManualOverride, ratePerKg: totals.freight.freightRatePerKg });
  }
  if (r2(totals.otherCharges) !== r2(existing.otherCharges)) change('INVOICE_CHARGES_CHANGED', `Additional charges changed from ${r2(existing.otherCharges)} to ${r2(totals.otherCharges)}`, existing.otherCharges, totals.otherCharges);
  if (notes !== (existing.notes || '')) change('INVOICE_NOTES_CHANGED', 'Notes / terms & conditions changed', existing.notes || '', notes);

  // Due date follows the payment terms when the wording says how many days; otherwise it keeps its current offset.
  const curDays = Math.max(0, Math.round((existing.dueDate.getTime() - existing.issueDate.getTime()) / DAY));
  const days = terms.paymentTerms !== existing.paymentTerms ? dueDaysForTerms(terms.paymentTerms) ?? curDays : curDays;

  if (Number(customer.creditLimit) > 0 && Number(customer.currentBalance) + totals.grandTotal > Number(customer.creditLimit)) {
    warnings.push(`This invoice takes ${customer.companyName} over its credit limit (${r2(customer.currentBalance)} outstanding + ${r2(totals.grandTotal)} > ${r2(customer.creditLimit)}).`);
  }

  const data: Prisma.TaxInvoiceUncheckedUpdateManyInput = {
    customerId: customer.id,
    customerName: customerChanged ? customer.contactPerson || customer.companyName : existing.customerName,
    customerEmail: customerChanged ? customer.email || '' : existing.customerEmail,
    customerCompany: customerChanged ? customer.companyName : existing.customerCompany,
    customerPhone: customerChanged ? customer.phone || '' : existing.customerPhone,
    billingAddress: customerChanged ? customer.billingAddress || '' : existing.billingAddress,
    shippingAddress: customerChanged ? customer.shippingAddress || customer.billingAddress || '' : existing.shippingAddress,
    depotId: depotRow.id,
    depotName: depotRow.name,
    ...terms,
    dueDate: new Date(existing.issueDate.getTime() + days * DAY),
    notes,
    subtotal: r2(totals.subtotal),
    discountPercent: totals.discountPercent,
    discountAmount: totals.discountAmount,
    taxAmount: totals.taxAmount,
    shippingCost: totals.shippingCost,
    otherCharges: totals.otherCharges,
    grandTotal: totals.grandTotal,
    actualWeightKg: totals.freight.actualWeightKg,
    volumetricWeightKg: totals.freight.volumetricWeightKg,
    chargeableWeightKg: totals.freight.chargeableWeightKg,
    freightRatePerKg: totals.freight.freightRatePerKg,
    freightCharge: totals.freight.freightCharge,
    additionalFreightCharges: totals.freight.additionalFreightCharges,
    freightVolumetricDivisor: totals.freight.freightVolumetricDivisor,
    freightIsManualOverride: totals.freight.freightIsManualOverride,
    ...(itemsChanged ? { freightAllocationMethod: null } : {}),
  };

  return {
    existing, data, lines, itemsChanged, removedIds: removed.map((r) => r.id), audit, warnings,
    depot: { id: depotRow.id, name: depotRow.name },
    customer,
    totals: {
      subtotal: r2(totals.subtotal), discountPercent: totals.discountPercent, discountAmount: totals.discountAmount, taxAmount: totals.taxAmount,
      shippingCost: totals.shippingCost, otherCharges: totals.otherCharges, grandTotal: totals.grandTotal, freight: totals.freight,
    },
  };
}

async function loadDraft(id: string, expectedUpdatedAt?: unknown) {
  const existing = await findInvoice(id);
  if (!existing) throw new ServiceError(404, 'Invoice not found');
  if (expectedUpdatedAt && new Date(String(expectedUpdatedAt)).getTime() !== existing.updatedAt.getTime()) {
    throw new ServiceError(409, 'Someone else changed this invoice while you were editing. Reload to see their changes.');
  }
  return existing;
}

/** Recalculated figures, stock position and warnings for an edit, without saving it. */
export async function previewDraftInvoice(id: string, body: any) {
  const plan = await planDraftUpdate(await loadDraft(id), body);
  const stock = await stockPosition(prisma, plan.depot.id, plan.lines.map((l) => l.row), plan.existing.id);
  return {
    totals: plan.totals,
    lines: plan.lines.map((l) => ({ id: l.existingId ?? null, ...l.row })),
    stock,
    warnings: plan.warnings,
    changes: plan.audit.map((a) => a.description),
    dueDate: plan.data.dueDate,
  };
}

/** Saves an edit to a DRAFT invoice. The original proforma is never touched. */
export async function updateDraftInvoice(id: string, body: any, actor: Actor, ip?: string) {
  const plan = await planDraftUpdate(await loadDraft(id, body.expectedUpdatedAt), body);
  const { existing } = plan;
  if (!plan.audit.length) return { invoice: await fullInvoice(existing.id), changes: [] as string[], warnings: plan.warnings };

  try {
    await prisma.$transaction(async (tx) => {
      // Claim: still a draft and unchanged since we read it, so two people saving at once cannot overwrite each other.
      const claim = await tx.taxInvoice.updateMany({ where: { id: existing.id, documentStatus: 'DRAFT', updatedAt: existing.updatedAt }, data: plan.data });
      if (claim.count !== 1) throw new Error('CONFLICT');
      if (plan.removedIds.length) await tx.invoiceItem.deleteMany({ where: { id: { in: plan.removedIds }, invoiceId: existing.id } });
      for (const l of plan.lines) {
        if (l.existingId) {
          const { allocatedFreight, ...rest } = l.row;
          await tx.invoiceItem.update({ where: { id: l.existingId }, data: plan.itemsChanged ? l.row : rest });
        }
      }
      const added = plan.lines.filter((l) => !l.existingId).map((l) => ({ ...l.row, invoiceId: existing.id }));
      if (added.length) await tx.invoiceItem.createMany({ data: added });
    });
  } catch (e: any) {
    if (e?.message === 'CONFLICT') throw new ServiceError(409, 'This invoice was issued or changed by someone else while you were editing. Reload the page.');
    console.error('[Invoice draft update] failed:', e?.message);
    throw new ServiceError(503, 'Saving failed. Nothing was changed; please try again.');
  }

  const totalLine = r2(existing.grandTotal) !== plan.totals.grandTotal ? ` Total ${r2(existing.grandTotal)} → ${plan.totals.grandTotal}.` : '';
  await writeAuditMany(actor, [
    {
      action: 'TAX_INVOICE_EDITED', entityType: 'TaxInvoice', entityId: existing.id, entityLabel: label(existing), ip,
      description: `Draft tax invoice edited: ${plan.audit.length} change${plan.audit.length === 1 ? '' : 's'}.${totalLine}`,
      previousValue: { grandTotal: existing.grandTotal }, newValue: { grandTotal: plan.totals.grandTotal },
      depotId: plan.depot.id, depotName: plan.depot.name,
    },
    ...plan.audit.map((a) => ({ ...a, ip })),
  ]);
  try {
    broadcastSystemEvent({ type: 'INVOICE_UPDATED', id: existing.id, status: 'DRAFT' } as any);
  } catch {}
  return { invoice: await fullInvoice(existing.id), changes: plan.audit.map((a) => a.description), warnings: plan.warnings };
}

const fullInvoice = (id: string) =>
  prisma.taxInvoice.findUnique({
    where: { id },
    include: { customer: true, depot: true, items: { include: { product: true } }, serialNumbers: true, packingDetails: true, shipment: true },
  });

// ─── Issue ───────────────────────────────────────────────────────────────────

/** DRAFT -> ISSUED. Exactly one caller can win the claim, so a double click can never burn two numbers. */
export async function issueInvoice(id: string, actor: Actor, expectedUpdatedAt?: unknown) {
  const existing = await findInvoice(id);
  if (!existing) throw new ServiceError(404, 'Invoice not found');
  if (existing.documentStatus !== 'DRAFT') {
    throw new ServiceError(409, `Invoice ${existing.invoiceNumber} has already been issued.`);
  }
  // Issue exactly the version the user reviewed.
  if (expectedUpdatedAt && new Date(String(expectedUpdatedAt)).getTime() !== existing.updatedAt.getTime()) {
    throw new ServiceError(409, 'This draft was changed after you opened it. Review the latest version before issuing.');
  }
  if (!existing.items.length) throw new ServiceError(400, 'Add at least one product before issuing.');

  const [depot, customer] = await Promise.all([
    prisma.depot.findUnique({ where: { id: existing.depotId }, select: { name: true, status: true } }),
    prisma.customer.findUnique({ where: { id: existing.customerId }, select: { companyName: true, status: true } }),
  ]);
  if (!depot || depot.status !== 'ACTIVE') throw new ServiceError(400, `${existing.depotName} is inactive. Edit the invoice and choose an active dispatch depot before issuing.`);
  if (!customer || customer.status === 'INACTIVE') throw new ServiceError(400, `${existing.customerCompany} is inactive. Edit the invoice and choose an active customer before issuing.`);

  const termDays = Math.max(0, Math.round((existing.dueDate.getTime() - existing.issueDate.getTime()) / DAY));
  let invoice;
  try {
    invoice = await prisma.$transaction(async (tx) => {
      const claim = await tx.taxInvoice.updateMany({ where: { id: existing.id, documentStatus: 'DRAFT', updatedAt: existing.updatedAt }, data: { documentStatus: 'ISSUED' } });
      if (claim.count !== 1) throw new Error('ALREADY_ISSUED');
      // Never issue more than the depot can supply once the other open orders are served.
      const short = (await stockPosition(tx, existing.depotId, existing.items, existing.id)).filter((s) => s.short);
      if (short.length) throw Object.assign(new Error('SHORT'), { short });
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
      // The source proforma now shows the real invoice number ("Converted -> INV-...").
      await tx.proforma.updateMany({ where: { convertedToInvoiceId: existing.id }, data: { convertedToInvoiceNumber: invoiceNumber } });
      // Frozen at issue: later edits to Settings never change this invoice.
      await stampSnapshot(tx, 'taxInvoice', existing.id);
      return updated;
    });
  } catch (e: any) {
    if (e?.message === 'SHORT') throw new ServiceError(409, shortageMessage(e.short, existing.depotName), { stock: e.short });
    if (e?.message === 'ALREADY_ISSUED') throw new ServiceError(409, 'This invoice was issued or changed by someone else. Reload the page.');
    console.error('[Invoice issue] failed:', e?.message);
    throw new ServiceError(503, 'Issuing failed. Nothing was changed; please try again.');
  }

  await writeAudit(actor, {
    action: 'TAX_INVOICE_ISSUED', entityType: 'TaxInvoice', entityId: invoice.id, entityLabel: invoice.invoiceNumber,
    description: `Tax invoice ${invoice.invoiceNumber} issued to ${invoice.customerCompany}${invoice.proformaNumber ? ` (from proforma ${invoice.proformaNumber})` : ''}`,
    newValue: { invoiceNumber: invoice.invoiceNumber, grandTotal: invoice.grandTotal }, depotId: invoice.depotId, depotName: invoice.depotName,
  });
  triggerInvoiceCreatedDepotEmail(invoice).catch((e) => console.error('[Invoice issue] depot email failed:', e));
  try {
    broadcastSystemEvent({ type: 'INVOICE_UPDATED', id: invoice.id, invoiceNumber: invoice.invoiceNumber, status: 'ISSUED', data: invoice } as any);
  } catch {}
  return invoice;
}

// ─── Corrections after issue ─────────────────────────────────────────────────

/** Customer balance = unpaid, non-cancelled, issued invoices (same rule as the invoice status sync). */
async function syncCustomerBalance(tx: Prisma.TransactionClient, customerId: string) {
  const open = await tx.taxInvoice.findMany({
    where: { customerId, fulfilmentStatus: { not: 'CANCELLED' }, documentStatus: { notIn: ['DRAFT', 'CANCELLED'] }, paymentStatus: { not: 'PAID' } },
    select: { grandTotal: true },
  });
  await tx.customer.update({ where: { id: customerId }, data: { currentBalance: Math.max(0, open.reduce((s, i) => s + (Number(i.grandTotal) || 0), 0)) } });
}

/**
 * Corrects an issued invoice without rewriting it: the issued invoice is CANCELLED (kept, with its number, for the
 * record) and a new DRAFT copy is created for editing; it gets a new number when it is issued.
 * Not possible once the goods have shipped or a payment is recorded: those need a credit note / return instead.
 */
export async function reissueInvoice(id: string, reason: unknown, actor: Actor, ip?: string) {
  const why = cleanText(reason, 500);
  if (why.length < 3) throw new ServiceError(400, 'Give a reason for the correction (it is kept in the audit log).');
  const existing = await findInvoice(id);
  if (!existing) throw new ServiceError(404, 'Invoice not found');
  if (existing.documentStatus === 'DRAFT') throw new ServiceError(400, 'This invoice is still a draft. Edit it directly.');
  if (existing.documentStatus === 'CANCELLED' || existing.fulfilmentStatus === 'CANCELLED') throw new ServiceError(409, 'This invoice is already cancelled.');
  if (existing.fulfilmentStatus === 'SHIPPED' || existing.fulfilmentStatus === 'DELIVERED') {
    throw new ServiceError(409, 'The goods have already shipped, so this invoice cannot be reissued. Process a return / credit note instead.');
  }
  if (existing.paymentStatus !== 'UNPAID') throw new ServiceError(409, 'A payment is recorded against this invoice. Reverse the payment first, or issue a credit note.');

  const termDays = Math.max(0, Math.round((existing.dueDate.getTime() - existing.issueDate.getTime()) / DAY));
  let draft;
  try {
    draft = await prisma.$transaction(async (tx) => {
      const claim = await tx.taxInvoice.updateMany({
        where: { id: existing.id, documentStatus: { in: ['ISSUED', 'SENT'] }, fulfilmentStatus: { in: [...OPEN_FULFILMENT] }, paymentStatus: 'UNPAID' },
        data: {
          documentStatus: 'CANCELLED',
          fulfilmentStatus: 'CANCELLED',
          // the proforma link moves to the replacement (one live invoice per proforma); the number stays for reference
          proformaId: null,
          internalRemarks: [existing.internalRemarks, `Cancelled for reissue: ${why}`].filter(Boolean).join('\n'),
        },
      });
      if (claim.count !== 1) throw new Error('STATE_CHANGED');
      const now = new Date();
      const created = await tx.taxInvoice.create({
        data: {
          invoiceNumber: newDraftNumber(),
          documentStatus: 'DRAFT',
          fulfilmentStatus: 'DRAFT',
          paymentStatus: 'UNPAID',
          amendsInvoiceId: existing.id,
          amendsInvoiceNumber: existing.invoiceNumber,
          proformaId: existing.proformaId,
          proformaNumber: existing.proformaNumber,
          customerId: existing.customerId,
          customerName: existing.customerName,
          customerEmail: existing.customerEmail,
          customerCompany: existing.customerCompany,
          customerPhone: existing.customerPhone,
          billingAddress: existing.billingAddress,
          shippingAddress: existing.shippingAddress,
          depotId: existing.depotId,
          depotName: existing.depotName,
          managerId: actor.id,
          managerName: actor.name,
          issueDate: now,
          dueDate: new Date(now.getTime() + termDays * DAY),
          paymentTerms: existing.paymentTerms,
          paymentMethod: existing.paymentMethod,
          incoterm: existing.incoterm,
          incotermPlace: existing.incotermPlace,
          deliveryTerms: existing.deliveryTerms,
          notes: existing.notes,
          currency: existing.currency,
          subtotal: existing.subtotal,
          discountPercent: existing.discountPercent,
          discountAmount: existing.discountAmount,
          taxAmount: existing.taxAmount,
          shippingCost: existing.shippingCost,
          otherCharges: existing.otherCharges,
          grandTotal: existing.grandTotal,
          actualWeightKg: existing.actualWeightKg,
          volumetricWeightKg: existing.volumetricWeightKg,
          chargeableWeightKg: existing.chargeableWeightKg,
          freightRatePerKg: existing.freightRatePerKg,
          freightCharge: existing.freightCharge,
          additionalFreightCharges: existing.additionalFreightCharges,
          freightVolumetricDivisor: existing.freightVolumetricDivisor,
          freightIsManualOverride: existing.freightIsManualOverride,
          freightAllocationMethod: existing.freightAllocationMethod,
          items: {
            create: existing.items.map((it) => ({
              productId: it.productId, productSku: it.productSku, productName: it.productName, brand: it.brand,
              quantity: it.quantity, unitPrice: it.unitPrice, discountPercent: it.discountPercent, taxRate: it.taxRate,
              taxAmount: it.taxAmount, totalPrice: it.totalPrice, depotId: it.depotId, depotName: it.depotName,
              trackSerial: it.trackSerial, unitWeightKg: it.unitWeightKg, lengthCm: it.lengthCm, widthCm: it.widthCm,
              heightCm: it.heightCm, allocatedFreight: it.allocatedFreight,
            })),
          },
        },
      });
      await tx.proforma.updateMany({ where: { convertedToInvoiceId: existing.id }, data: { convertedToInvoiceId: created.id, convertedToInvoiceNumber: null } });
      await syncCustomerBalance(tx, existing.customerId);
      return created;
    });
  } catch (e: any) {
    if (e?.message === 'STATE_CHANGED') throw new ServiceError(409, 'The invoice moved on while you were working (picked, shipped or paid). Reload the page.');
    console.error('[Invoice reissue] failed:', e?.message);
    throw new ServiceError(503, 'The correction failed. Nothing was changed; please try again.');
  }

  // Serials reserved by picking go back on the shelf. No stock quantity changes: stock only leaves at dispatch.
  await restoreStockForCancelledInvoice(existing.id, existing.invoiceNumber, [], existing.depotId, { restoreQuantities: false });

  await writeAuditMany(actor, [
    {
      action: 'TAX_INVOICE_CANCELLED', entityType: 'TaxInvoice', entityId: existing.id, entityLabel: existing.invoiceNumber, ip,
      description: `Tax invoice ${existing.invoiceNumber} cancelled for correction: ${why}`, previousValue: existing.documentStatus, newValue: 'CANCELLED',
      depotId: existing.depotId, depotName: existing.depotName,
    },
    {
      action: 'TAX_INVOICE_REISSUE_DRAFT_CREATED', entityType: 'TaxInvoice', entityId: draft.id, entityLabel: `Draft replacing ${existing.invoiceNumber}`, ip,
      description: `Draft created to replace cancelled invoice ${existing.invoiceNumber}. Reason: ${why}`, newValue: { amendsInvoiceNumber: existing.invoiceNumber },
      depotId: existing.depotId, depotName: existing.depotName,
    },
  ]);
  try {
    broadcastSystemEvent({ type: 'INVOICE_UPDATED', id: existing.id, invoiceNumber: existing.invoiceNumber, status: 'CANCELLED' } as any);
  } catch {}
  return draft;
}

/**
 * Deletes a DRAFT (issued invoices are never deleted). A draft that came from a proforma releases it: the proforma
 * goes back to Confirmed and can be converted again; it was never changed by the draft's edits.
 */
export async function deleteDraftInvoice(id: string, actor: Actor, ip?: string) {
  const existing = await prisma.taxInvoice.findFirst({ where: { OR: [{ id }, { invoiceNumber: id }] }, select: { id: true, depotId: true, depotName: true, documentStatus: true, proformaNumber: true, amendsInvoiceNumber: true, customerCompany: true, invoiceNumber: true } });
  if (!existing) throw new ServiceError(404, 'Invoice not found');
  if (existing.documentStatus !== 'DRAFT') throw new ServiceError(400, 'Only a draft can be deleted. An issued invoice stays on record; cancel it instead.');

  const released = await prisma.$transaction(async (tx) => {
    const del = await tx.taxInvoice.deleteMany({ where: { id: existing.id, documentStatus: 'DRAFT' } });
    if (del.count !== 1) throw new ServiceError(409, 'This invoice was issued while you were working. Reload the page.');
    const pf = await tx.proforma.findFirst({ where: { convertedToInvoiceId: existing.id }, select: { id: true, proformaNumber: true } });
    if (pf) {
      await tx.proforma.update({ where: { id: pf.id }, data: { status: 'CONFIRMED', convertedToInvoiceId: null, convertedToInvoiceNumber: null, convertedAt: null } });
    }
    return pf;
  });

  await writeAuditMany(actor, [
    {
      action: 'TAX_INVOICE_DRAFT_DELETED', entityType: 'TaxInvoice', entityId: existing.id, entityLabel: label(existing as any), ip,
      description: `Draft tax invoice for ${existing.customerCompany} deleted${existing.amendsInvoiceNumber ? ` (was replacing ${existing.amendsInvoiceNumber})` : ''}`,
      depotId: existing.depotId, depotName: existing.depotName,
    },
    ...(released
      ? [{
          action: 'PROFORMA_CONVERSION_REVERTED', entityType: 'Proforma', entityId: released.id, entityLabel: released.proformaNumber, ip,
          description: `Proforma ${released.proformaNumber} is Confirmed again because its draft tax invoice was deleted`, previousValue: 'CONVERTED', newValue: 'CONFIRMED',
        }]
      : []),
  ]);
  return { success: true, proformaReleased: released?.id ?? null };
}
