import { resolveUnit } from '@/lib/units';
import { addQty, qtyNum, stockQty } from '@/lib/quantity';
import { StockError, setStockLevelInTx } from '@/lib/inventory/stock-ops';
import { hasPermission } from '@/lib/rbac';
import { NextRequest, NextResponse } from 'next/server';
import { getDefaultTax, resolveProductTax, syncCatalogueTax } from '@/lib/tax';
import { prisma } from '@/lib/prisma';
import { checkNonNegative } from '@/lib/validation';
import dataStore from '@/lib/data-store';
import { depotIdFilter, guardApi, sanitizeProductForRole } from '@/lib/api-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'products.read');
  if (!auth.ok) return auth.response;

  try {
    await syncCatalogueTax().catch(() => {}); // a scheduled default-tax change takes effect on its date
    const scopedDepot = depotIdFilter(auth.user);
    let product: any = null;
    try {
      product = await prisma.product.findUnique({
        where: { id },
        include: {
          category: true,
          inventories: {
            where: scopedDepot ? { depotId: scopedDepot } : undefined,
            include: { depot: scopedDepot ? { select: { id: true, name: true, code: true } } : true },
          },
          serialNumbers: scopedDepot ? { where: { depotId: scopedDepot } } : true,
        },
      });
    } catch (dbErr) {
      // DB offline, proceed to fallback
    }

    if (!product) {
      product = dataStore.getProductById(id);
    }

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json(sanitizeProductForRole(product, auth.user.role));
  } catch (error) {
    console.error('Error fetching product:', error);
    return NextResponse.json({ error: 'Failed to fetch product' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'products.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));

    // Destructure out non-scalar / relational fields before passing to Prisma
    const {
      inventories,
      depotBreakdown,
      stockBaseline,
      id: _id,
      sku: _sku,
      createdAt: _ca,
      updatedAt: _ua,
      category,
      serialNumbers: _sn,
      serialCount: _sc,
      totalStock: _ts,
      ...scalarData
    } = body;

    const priceErr = checkNonNegative({
      purchasePrice: scalarData.purchasePrice,
      wholesalePrice: scalarData.wholesalePrice,
      sellingPrice: scalarData.sellingPrice,
      taxRate: scalarData.taxRate,
    });
    if (priceErr) return NextResponse.json({ error: priceErr }, { status: 400 });

    // Unit of measure: must be a configured unit; it cannot change once the product is on any document.
    if (scalarData.unit !== undefined) {
      const unitRow = await resolveUnit(scalarData.unit);
      if (!unitRow) return NextResponse.json({ error: `Unknown unit of measure "${scalarData.unit}". Choose one from the list.` }, { status: 400 });
      const cur = await prisma.product.findUnique({ where: { id }, select: { unit: true, trackSerial: true } });
      if (cur && cur.unit.toLowerCase() !== unitRow.code.toLowerCase()) {
        const used = (await prisma.proformaItem.count({ where: { productId: id } })) + (await prisma.invoiceItem.count({ where: { productId: id } })) + (await prisma.purchaseInvoiceItem.count({ where: { productId: id } }));
        if (used > 0) return NextResponse.json({ error: `The unit of ${cur.unit} cannot be changed: this product is already on ${used} document line${used === 1 ? '' : 's'}.` }, { status: 409 });
      }
      if (unitRow.decimals > 0 && (scalarData.trackSerial === true || (scalarData.trackSerial === undefined && cur?.trackSerial))) {
        if (scalarData.trackSerial === true) return NextResponse.json({ error: `Serial-number tracking is only for whole pieces; ${unitRow.code} is sold in fractions.` }, { status: 400 });
        scalarData.trackSerial = false;
      }
      scalarData.unit = unitRow.code;
    }

    // Tax: follow the configured default unless a custom rate was chosen on purpose.
    if (scalarData.taxRate !== undefined || scalarData.useDefaultTax !== undefined) {
      const resolved = resolveProductTax({ taxRate: scalarData.taxRate, useDefaultTax: scalarData.useDefaultTax }, await getDefaultTax());
      if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });
      scalarData.taxRate = resolved.taxRate;
      scalarData.useDefaultTax = resolved.useDefaultTax;
    }

    const inventoryUpdates: { depotId: string; quantity: number }[] =
      inventories ??
      (depotBreakdown
        ? Object.entries(depotBreakdown).map(([depotId, qty]) => ({
            depotId,
            quantity: stockQty(qty),
          }))
        : null);

    let result: any = null;
    try {
      result = await prisma.$transaction(async (tx) => {
        scalarData.imageUrl = '/placeholder-product.svg';

        await tx.product.update({
          where: { id },
          data: scalarData,
        });

        // Stock is never overwritten from the product form: a changed depot quantity becomes a traceable adjustment
        // (ledger + StockAdjustment, never below zero), and only for users allowed to adjust stock.
        if (inventoryUpdates) {
          for (const inv of inventoryUpdates) {
            const cur = await tx.depotInventory.findUnique({ where: { productId_depotId: { productId: id, depotId: inv.depotId } } });
            if (qtyNum(cur?.quantity ?? 0) === qtyNum(inv.quantity)) continue;
            // stockBaseline = the quantities the form was opened with: an untouched depot is never written back (stock may
            // have moved since), and a depot edited on a stale form is refused instead of undoing those movements
            if (stockBaseline && typeof stockBaseline === 'object') {
              const base = stockQty(stockBaseline[inv.depotId] ?? 0);
              if (qtyNum(inv.quantity) === base) continue;
              if (qtyNum(cur?.quantity ?? 0) !== base) throw new StockError(409, 'Stock in this depot changed since the form was opened. Reload the product and enter the quantity again.');
            }
            if (!hasPermission(auth.user.role, 'inventory.adjust')) throw new StockError(403, 'Changing stock quantities needs the stock-adjustment permission. Use Inventory -> Stock Adjustments.');
            await setStockLevelInTx(tx, { id: auth.user.id, name: auth.user.name, role: auth.user.role }, { productId: id, depotId: inv.depotId, quantity: Math.max(0, qtyNum(inv.quantity)), reason: 'CYCLE_COUNT', notes: 'Quantity changed in the product form' });
          }
        }

        const allInv = await tx.depotInventory.findMany({ where: { productId: id } });
        const newTotalStock = addQty(...allInv.map((inv) => inv.quantity));

        return tx.product.update({
          where: { id },
          data: { totalStock: newTotalStock },
          include: {
            category: true,
            inventories: { include: { depot: true } },
            serialNumbers: true,
          },
        });
      });
    } catch (dbErr) {
      if (dbErr instanceof StockError) return NextResponse.json({ error: dbErr.message }, { status: dbErr.status });
      // Fallback to dataStore
      const current = dataStore.getProductById(id);
      const newTotalStock = depotBreakdown
        ? Object.values(depotBreakdown).reduce((sum: number, q: any) => sum + (parseInt(q) || 0), 0)
        : current?.totalStock || 0;

      result = dataStore.updateProduct(id, {
        ...scalarData,
        depotBreakdown: depotBreakdown || current?.depotBreakdown || {},
        totalStock: newTotalStock,
      });
    }

    if (!result) {
      result = dataStore.getProductById(id);
    }

    if (!result) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json(sanitizeProductForRole(result, auth.user.role));
  } catch (error) {
    console.error('Error updating product:', error);
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'products.write');
  if (!auth.ok) return auth.response;

  try {
    try {
      await prisma.product.delete({
        where: { id },
      });
    } catch (dbErr) {
      // Prisma offline, proceed to fallback
    }

    dataStore.deleteProduct(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting product:', error);
    return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
  }
}

export const PATCH = PUT;
