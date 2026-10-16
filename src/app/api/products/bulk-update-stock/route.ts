import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi } from '@/lib/api-auth';

/**
 * PUT /api/products/bulk-update-stock
 *
 * Body: { products: [{ sku, stock, quantity, depotBreakdown, ... }] }
 *
 * For each row: looks up the product by SKU, upserts DepotInventory
 * records across all depots, and recalculates totalStock.
 */
export async function PUT(req: NextRequest) {
  const auth = await guardApi(req, 'products.write');
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
          depotBreakdown[depot.id] = Math.max(0, parseInt(qty) || 0);
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
          depotBreakdown[primaryDepot.id] = Math.max(0, parseInt(genericStock) || 0);
        }
      }

      if (Object.keys(depotBreakdown).length === 0) {
        skippedRows.push({ sku: rawSku, reason: 'No stock or quantity values found in row' });
        continue;
      }

      const totalStock = Object.values(depotBreakdown).reduce((sum, q) => sum + q, 0);

      try {
        // Try Prisma upsert
        for (const [depotId, qty] of Object.entries(depotBreakdown)) {
          const depot = depotMap.get(depotId);
          if (!depot) continue;

          try {
            await prisma.depotInventory.upsert({
              where: { productId_depotId: { productId: product.id, depotId } },
              update: { quantity: qty, availableQuantity: qty },
              create: {
                productId: product.id,
                depotId,
                quantity: qty,
                allocatedQuantity: 0,
                availableQuantity: qty,
                minStockLevel: product.minStockLevel || 5,
              },
            });
          } catch {}
        }

        try {
          await prisma.product.update({
            where: { id: product.id },
            data: { totalStock },
          });
        } catch {}

        // Always update dataStore
        dataStore.updateProduct(product.id, {
          depotBreakdown,
          totalStock,
        });

        updatedRows.push({ sku: rawSku, totalStock });
      } catch (err: any) {
        // Fallback update to dataStore directly
        dataStore.updateProduct(product.id, {
          depotBreakdown,
          totalStock,
        });
        updatedRows.push({ sku: rawSku, totalStock });
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
