import { stockQty } from '@/lib/quantity';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi } from '@/lib/api-auth';
import { setStockLevelInTx } from '@/lib/inventory/stock-ops';

/**
 * PUT /api/products/bulk-update-stock
 *
 * Body: { products: [{ sku, stock, quantity, depotBreakdown, ... }] }
 *
 * For each row: looks up the product by SKU, upserts DepotInventory
 * records across all depots, and recalculates totalStock.
 */
export async function PUT(req: NextRequest) {
  // stock quantities change here: the stock-adjustment permission, like every other stock change
  const auth = await guardApi(req, 'inventory.adjust');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const { products } = body;

    if (!Array.isArray(products) || products.length === 0) {
      return NextResponse.json(
        { error: 'Invalid payload: products must be a non-empty array' },
        { status: 400 }
      );
    }

    let allDepots: any[] = [];
    try {
      allDepots = await prisma.depot.findMany();
    } catch {}
    if (!allDepots || allDepots.length === 0) {
      allDepots = dataStore.getDepots();
    }
    const primaryDepot = allDepots.find((d) => d.isCentralHub) || allDepots[0];
    const depotMap = new Map(allDepots.map((d) => [d.id, d]));

    const updatedRows: { sku: string; totalStock: number }[] = [];
    const skippedRows: { sku: string; reason: string }[] = [];

    for (const row of products) {
      const rawSku = (row.sku || row.SKU || row.ProductSku || row.product_sku)?.toString().trim().toUpperCase();
      if (!rawSku) {
        skippedRows.push({ sku: '(empty)', reason: 'SKU is missing' });
        continue;
      }

      let product: any = null;
      try {
        product = await prisma.product.findUnique({ where: { sku: rawSku } });
      } catch {}

      if (!product) {
        product = dataStore.getProductById(rawSku);
      }

      if (!product) {
        skippedRows.push({ sku: rawSku, reason: `SKU "${rawSku}" not found in database` });
        continue;
      }

      // Build depot breakdown from the row's stock columns
      const depotBreakdown: Record<string, number> = {};
      let hasSpecificDepot = false;

      allDepots.forEach((depot) => {
        const codeKey = depot.code.toLowerCase().replace('dep-', '');
        const nameClean = depot.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const qty =
          row.depotBreakdown?.[depot.id] ??
          row[`${codeKey}Stock`] ??
          row[`${codeKey}_stock`] ??
          row[`${nameClean}Stock`] ??
          row[depot.id] ??
          row[depot.code] ??
          row[depot.name] ??
          null;

        if (qty !== null && qty !== undefined && qty !== '') {
          depotBreakdown[depot.id] = stockQty(qty);
          hasSpecificDepot = true;
        }
      });

      // If no depot-specific column was found, check generic stock/quantity
      if (!hasSpecificDepot && primaryDepot) {
        const genericStock =
          row.stock ??
          row.Stock ??
          row.quantity ??
          row.Quantity ??
          row.qty ??
          row.QTY ??
          row.totalStock ??
          row.total_stock ??
          null;

        if (genericStock !== null && genericStock !== undefined && genericStock !== '') {
          depotBreakdown[primaryDepot.id] = stockQty(genericStock); // decimals kept (54.620 Mt)
        }
      }

      if (Object.keys(depotBreakdown).length === 0) {
        skippedRows.push({ sku: rawSku, reason: 'No stock or quantity values found in row' });
        continue;
      }

      // Each depot is set to the counted quantity through a traceable adjustment (ledger + StockAdjustment) in one
      // transaction per product; a database error is reported, never written to a local fallback file.
      try {
        await prisma.$transaction(async (tx) => {
          for (const [depotId, qty] of Object.entries(depotBreakdown)) {
            if (!depotMap.get(depotId)) continue;
            await setStockLevelInTx(tx, { id: auth.user.id, name: auth.user.name, role: auth.user.role }, { productId: product.id, depotId, quantity: qty, reason: 'CYCLE_COUNT', notes: 'Bulk stock update', reference: 'BULK-STOCK' });
          }
        });
        const sum = await prisma.depotInventory.aggregate({ where: { productId: product.id }, _sum: { quantity: true } });
        updatedRows.push({ sku: rawSku, totalStock: Number(sum._sum.quantity ?? 0) });
      } catch (err: any) {
        skippedRows.push({ sku: rawSku, reason: err?.message || 'Stock could not be updated' });
      }
    }

    return NextResponse.json({
      success: true,
      updatedCount: updatedRows.length,
      skippedCount: skippedRows.length,
      updated: updatedRows,
      skipped: skippedRows,
      message: `Updated inventory stock for ${updatedRows.length} products.`,
    });
  } catch (error: any) {
    console.error('Bulk stock update error:', error);
    return NextResponse.json({ error: error.message || 'Bulk stock update failed' }, { status: 500 });
  }
}
