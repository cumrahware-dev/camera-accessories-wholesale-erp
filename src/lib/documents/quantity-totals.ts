/**
 * Total quantity of a document's lines. Quantities are only added when they are in the same unit: 54.620 Mt + 45.650 Mt
 * = 100.270 Mt, but Mt and Pcs are reported side by side ("100.270 Mt + 6 Pcs"), never summed into one number.
 * Safe for server and client code.
 */
import { addQty, fmtQtyWithUnit, type UnitInfo } from '@/lib/quantity';

export interface QtyTotal { unit: string; total: number; text: string }

export function quantityTotals(items: { quantity?: unknown; unit?: string | null }[], units: UnitInfo[]): QtyTotal[] {
  const byUnit = new Map<string, unknown[]>();
  for (const it of items || []) {
    const u = String(it.unit || 'Pcs');
    const key = Array.from(byUnit.keys()).find((k) => k.toLowerCase() === u.toLowerCase()) ?? u;
    byUnit.set(key, [...(byUnit.get(key) || []), it.quantity]);
  }
  return Array.from(byUnit.entries()).map(([unit, qs]) => {
    const total = addQty(...(qs as any[]));
    return { unit, total, text: fmtQtyWithUnit(total, unit, units) };
  });
}

/** "Total Quantity: 125.500 Mt" or "Total Quantity: 100.270 Mt + 6 Pcs". '' when there are no lines. */
export function totalQuantityText(items: { quantity?: unknown; unit?: string | null }[], units: UnitInfo[]): string {
  const t = quantityTotals(items, units);
  return t.length ? t.map((x) => x.text).join(' + ') : '';
}
