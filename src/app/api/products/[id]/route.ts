import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkNonNegative } from '@/lib/validation';
import dataStore from '@/lib/data-store';
import { depotIdFilter, guardApi, sanitizeProductForRole } from '@/lib/api-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'products.read');
  if (!auth.ok) return auth.response;

  try {
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
    const body = await req.json();

    // Destructure out non-scalar / relational fields before passing to Prisma
    const {
      inventories,
      depotBreakdown,
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

    const inventoryUpdates: { depotId: string; quantity: number }[] =
      inventories ??
      (depotBreakdown
        ? Object.entries(depotBreakdown).map(([depotId, qty]) => ({
            depotId,
            quantity: Math.max(0, parseInt(qty as any) || 0),
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

        if (inventoryUpdates) {
          for (const inv of inventoryUpdates) {
            const qty = Math.max(0, inv.quantity);
            await tx.depotInventory.upsert({
              where: { productId_depotId: { productId: id, depotId: inv.depotId } },
              update: { quantity: qty, availableQuantity: qty },
              create: {
                productId: id,
                depotId: inv.depotId,
                quantity: qty,
                allocatedQuantity: 0,
                availableQuantity: qty,
                minStockLevel: Number(scalarData.minStockLevel) || 5,
              },
            });
          }
        }

        const allInv = await tx.depotInventory.findMany({ where: { productId: id } });
        const newTotalStock = allInv.reduce((sum, inv) => sum + inv.quantity, 0);

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
