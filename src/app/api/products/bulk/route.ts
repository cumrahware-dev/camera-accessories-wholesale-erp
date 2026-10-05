import { NextRequest, NextResponse } from 'next/server';
import { getDefaultTax } from '@/lib/tax';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi } from '@/lib/api-auth';

const DEFAULT_PRODUCT_IMAGE = '/placeholder-product.svg';

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'products.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { products } = body;

    if (!Array.isArray(products) || products.length === 0) {
      return NextResponse.json(
        { error: 'Invalid payload: products must be a non-empty array' },
        { status: 400 }
      );
    }

    // Load Depots from Prisma or fallback to dataStore
    let allDepots: any[] = [];
    try {
      allDepots = await prisma.depot.findMany();
    } catch {}
    if (!allDepots || allDepots.length === 0) {
      allDepots = dataStore.getDepots();
    }
    const primaryDepot = allDepots.find((d) => d.isCentralHub) || allDepots[0];
    const depotMap = new Map(allDepots.map((d) => [d.id, d]));

    // Fetch existing SKUs and Barcodes from Prisma or dataStore
    let existingProducts: { id: string; sku: string; barcode: string | null }[] = [];
    try {
      existingProducts = await prisma.product.findMany({
        select: { id: true, sku: true, barcode: true },
      });
    } catch {}
    if (!existingProducts || existingProducts.length === 0) {
      existingProducts = dataStore.getProducts().map((p) => ({
        id: p.id,
        sku: p.sku,
        barcode: p.barcode,
      }));
    }

    const existingProductMap = new Map(existingProducts.map((p) => [p.sku.toUpperCase(), p]));
    const existingBarcodes = new Set(existingProducts.map((p) => p.barcode).filter(Boolean));

    const processedSkusInBatch = new Set<string>();
    const validProductsToProcess: any[] = [];
    const defTax = await getDefaultTax();
    // Optional tax column: blank -> follow the default; a number -> custom only when it differs from the default.
    const taxCell = (row: any): { taxRate: number; useDefaultTax: boolean } | null => {
      const raw = row.taxRate ?? row.TaxRate ?? row.tax;
      if (raw === undefined || raw === null || String(raw).trim() === '') return null;
      const n = Number(String(raw).replace('%', '').trim());
      if (!Number.isFinite(n) || n < 0 || n > 100) return null;
      return n === defTax.rate ? { taxRate: n, useDefaultTax: true } : { taxRate: n, useDefaultTax: false };
    };
    const failedRows: { row: number; sku?: string; name?: string; error: string }[] = [];

    // 1. Validation loop
    for (let index = 0; index < products.length; index++) {
      const p = products[index];
      const rowNum = index + 1;

      const rawSku = (p.sku || p.SKU || p.ProductSku || p.product_sku || '')?.toString().trim();
      const name = (p.name || p.Name || p.productName || p.title || '')?.toString().trim();
      const brand = (p.brand || p.Brand || p.manufacturer || '')?.toString().trim();
      const categoryName = (p.category || p.Category || p.categoryName || p.CategoryName || '')?.toString().trim() || 'General Optics';

      if (!rawSku) {
        failedRows.push({ row: rowNum, name: name || 'Untitled', error: 'Product SKU is missing' });
        continue;
      }
      if (!name) {
        failedRows.push({ row: rowNum, sku: rawSku, name: 'Untitled', error: 'Product name is missing' });
        continue;
      }
      if (!brand) {
        failedRows.push({ row: rowNum, sku: rawSku, name, error: 'Brand is missing' });
        continue;
      }

      const cleanSku = rawSku.toUpperCase();

      if (processedSkusInBatch.has(cleanSku)) {
        failedRows.push({ row: rowNum, sku: cleanSku, name, error: `Duplicate SKU "${cleanSku}" found within the same import batch` });
        continue;
      }

      const purchasePrice = parseFloat(p.purchasePrice || p.PurchasePrice || p.cost || p.costPrice || p.purchase_price) || 0;
      const wholesalePrice = parseFloat(p.wholesalePrice || p.WholesalePrice || p.wholesale_price || p.price || p.Price) || purchasePrice;
      const sellingPrice = parseFloat(p.sellingPrice || p.SellingPrice || p.selling_price || p.msrp || p.MSRP) || wholesalePrice;

      if (purchasePrice < 0 || wholesalePrice < 0 || sellingPrice < 0) {
        failedRows.push({ row: rowNum, sku: cleanSku, name, error: 'Pricing fields cannot be negative numbers' });
        continue;
      }

      processedSkusInBatch.add(cleanSku);

      let barcode = (p.barcode || p.Barcode || p.ean || p.upc)?.toString().trim();
      if (!barcode || existingBarcodes.has(barcode)) {
        barcode = `8809${Math.floor(10000000 + Math.random() * 90000000)}`;
      }
      existingBarcodes.add(barcode);

      // Smart stock parsing across generic and depot-specific keys
      const depotBreakdown: Record<string, number> = {};
      let hasSpecificDepotStock = false;

      allDepots.forEach((depot) => {
        const depotCodeLower = depot.code.toLowerCase().replace('dep-', '');
        const depotNameClean = depot.name.toLowerCase().replace(/[^a-z0-9]/g, '');

        const qtyVal =
          p.depotBreakdown?.[depot.id] ??
          p[`${depotCodeLower}Stock`] ??
          p[`${depotCodeLower}_stock`] ??
          p[`${depotNameClean}Stock`] ??
          p[depot.id] ??
          p[depot.code] ??
          p[depot.name] ??
          null;

        if (qtyVal !== null && qtyVal !== undefined && qtyVal !== '') {
          const parsed = Math.max(0, parseInt(qtyVal) || 0);
          depotBreakdown[depot.id] = parsed;
          hasSpecificDepotStock = true;
        } else {
          depotBreakdown[depot.id] = 0;
        }
      });

      // If no depot-specific column was supplied, check generic stock/quantity columns
      if (!hasSpecificDepotStock && primaryDepot) {
        const genericStock =
          p.stock ??
          p.Stock ??
          p.STOCK ??
          p.quantity ??
          p.Quantity ??
          p.qty ??
          p.QTY ??
          p.totalStock ??
          p.total_stock ??
          p.TotalStock ??
          p.initialStock ??
          p.initial_stock ??
          p.units ??
          null;

        if (genericStock !== null && genericStock !== undefined && genericStock !== '') {
          depotBreakdown[primaryDepot.id] = Math.max(0, parseInt(genericStock) || 0);
        }
      }

      const totalStock = Object.values(depotBreakdown).reduce((sum, q) => sum + q, 0);

      const trackSerialRaw = (p.trackSerial ?? p.TrackSerial ?? p.track_serial ?? p.serialTracked)?.toString().toLowerCase().trim();
      const trackSerial =
        trackSerialRaw === 'true' ||
        trackSerialRaw === 'yes' ||
        trackSerialRaw === '1' ||
        trackSerialRaw === '' ||
        trackSerialRaw === undefined;

      const isExisting = existingProductMap.has(cleanSku);
      const existingProduct = existingProductMap.get(cleanSku);

      validProductsToProcess.push({
        rowNum,
        cleanSku,
        name,
        brand,
        model: (p.model || p.Model || '').toString().trim(),
        categoryName,
        description: (p.description || p.Description || '').toString().trim(),
        imageUrl: DEFAULT_PRODUCT_IMAGE,
        barcode,
        purchasePrice,
        wholesalePrice,
        sellingPrice,
        // A tax column is optional. Blank = follow the configured default; an explicit 0 is a real value, not "missing".
        ...(taxCell(p) ?? { taxRate: defTax.rate, useDefaultTax: true }),
        minStockLevel: parseInt(p.minStockLevel || p.MinStockLevel || p.reorder_level) || 10,
        trackSerial,
        depotBreakdown,
        totalStock,
        isExisting,
        existingId: existingProduct?.id,
      });
    }

    // 2. Database & DataStore Insertion Loop
    let createdCount = 0;
    let updatedCount = 0;
    const categoriesCache = new Map<string, string>();

    try {
      const existingCategories = await prisma.category.findMany();
      existingCategories.forEach((c) => {
        categoriesCache.set(c.name.toLowerCase(), c.id);
      });
    } catch {
      dataStore.getCategories().forEach((c) => {
        categoriesCache.set(c.name.toLowerCase(), c.id);
      });
    }

    for (const item of validProductsToProcess) {
      try {
        const catKey = item.categoryName.toLowerCase();
        let categoryId = categoriesCache.get(catKey);

        if (!categoryId) {
          try {
            const catSlug = item.categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const newCat = await prisma.category.create({
              data: {
                name: item.categoryName,
                slug: `${catSlug}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                description: `${item.categoryName} optics & hardware`,
              },
            });
            categoryId = newCat.id;
          } catch {
            const newCat = dataStore.createCategory({ name: item.categoryName });
            categoryId = newCat.id;
          }
          categoriesCache.set(catKey, categoryId!);
        }

        let productId = item.existingId;
        let productRecord: any = null;

        // Try updating/creating via Prisma first, fall back to dataStore
        if (item.isExisting && productId) {
          try {
            productRecord = await prisma.product.update({
              where: { id: productId },
              data: {
                name: item.name,
                brand: item.brand,
                model: item.model,
                categoryId,
                categoryName: item.categoryName,
                description: item.description,
                imageUrl: item.imageUrl,
                barcode: item.barcode,
                trackSerial: item.trackSerial,
                purchasePrice: item.purchasePrice,
                wholesalePrice: item.wholesalePrice,
                sellingPrice: item.sellingPrice,
                taxRate: item.taxRate,
          useDefaultTax: item.useDefaultTax,
                minStockLevel: item.minStockLevel,
                totalStock: item.totalStock,
              },
            });
          } catch {
            productRecord = dataStore.updateProduct(productId, {
              name: item.name,
              brand: item.brand,
              model: item.model,
              categoryId,
              categoryName: item.categoryName,
              description: item.description,
              imageUrl: item.imageUrl,
              barcode: item.barcode,
              trackSerial: item.trackSerial,
              purchasePrice: item.purchasePrice,
              wholesalePrice: item.wholesalePrice,
              sellingPrice: item.sellingPrice,
              taxRate: item.taxRate,
          useDefaultTax: item.useDefaultTax,
              minStockLevel: item.minStockLevel,
              totalStock: item.totalStock,
              depotBreakdown: item.depotBreakdown,
            });
          }
          updatedCount++;
        } else {
          productId = `prod-${item.cleanSku.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
          try {
            productRecord = await prisma.product.create({
              data: {
                id: productId,
                sku: item.cleanSku,
                name: item.name,
                brand: item.brand,
                model: item.model,
                categoryId,
                categoryName: item.categoryName,
                description: item.description,
                imageUrl: item.imageUrl,
                barcode: item.barcode,
                trackSerial: item.trackSerial,
                purchasePrice: item.purchasePrice,
                wholesalePrice: item.wholesalePrice,
                sellingPrice: item.sellingPrice,
                taxRate: item.taxRate,
          useDefaultTax: item.useDefaultTax,
                minStockLevel: item.minStockLevel,
                status: 'ACTIVE',
                totalStock: item.totalStock,
              },
            });
          } catch {
            productRecord = dataStore.createProduct({
              id: productId,
              sku: item.cleanSku,
              name: item.name,
              brand: item.brand,
              model: item.model,
              categoryId,
              categoryName: item.categoryName,
              description: item.description,
              imageUrl: item.imageUrl,
              barcode: item.barcode,
              trackSerial: item.trackSerial,
              purchasePrice: item.purchasePrice,
              wholesalePrice: item.wholesalePrice,
              sellingPrice: item.sellingPrice,
              taxRate: item.taxRate,
          useDefaultTax: item.useDefaultTax,
              minStockLevel: item.minStockLevel,
              status: 'ACTIVE',
              totalStock: item.totalStock,
              depotBreakdown: item.depotBreakdown,
            });
          }
          createdCount++;
        }

        // Always ensure dataStore is fully synchronized
        dataStore.createProduct({
          id: productRecord?.id || productId,
          sku: item.cleanSku,
          name: item.name,
          brand: item.brand,
          model: item.model || '',
          categoryId,
          categoryName: item.categoryName,
          description: item.description,
          imageUrl: item.imageUrl,
          barcode: item.barcode,
          trackSerial: item.trackSerial,
          purchasePrice: item.purchasePrice,
          sellingPrice: item.sellingPrice,
          wholesalePrice: item.wholesalePrice,
          taxRate: item.taxRate,
          useDefaultTax: item.useDefaultTax,
          minStockLevel: item.minStockLevel,
          status: 'ACTIVE',
          totalStock: item.totalStock,
          depotBreakdown: item.depotBreakdown,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        // Upsert depot inventories & generate serial numbers
        const serialsToCreate: any[] = [];
        for (const [depotId, qty] of Object.entries(item.depotBreakdown)) {
          const quantity = qty as number;
          const depot = depotMap.get(depotId);
          if (depot) {
            try {
              await prisma.depotInventory.upsert({
                where: {
                  productId_depotId: {
                    productId: productRecord?.id || productId,
                    depotId: depot.id,
                  },
                },
                create: {
                  productId: productRecord?.id || productId,
                  depotId: depot.id,
                  quantity,
                  allocatedQuantity: 0,
                  availableQuantity: quantity,
                  minStockLevel: item.minStockLevel || 5,
                },
                update: {
                  quantity,
                  availableQuantity: quantity,
                },
              });
            } catch {}

            // Generate initial serial numbers if trackSerial is enabled and stock > 0
            if (item.trackSerial && quantity > 0) {
              let existingSerialCount = 0;
              try {
                existingSerialCount = await prisma.serialNumber.count({
                  where: { productId: productRecord?.id || productId, depotId: depot.id },
                });
              } catch {
                existingSerialCount = dataStore.getSerialNumbers(productRecord?.id || productId).length;
              }

              if (existingSerialCount < quantity) {
                const countToCreate = Math.min(quantity - existingSerialCount, 50);
                const depotCode = depot.code.replace('DEP-', '');
                for (let i = 1; i <= countToCreate; i++) {
                  const randomCode = Math.floor(1000 + Math.random() * 9000);
                  const snObject = {
                    productId: productRecord?.id || productId,
                    productSku: item.cleanSku,
                    productName: item.name,
                    serialNumber: `SN-${item.cleanSku}-${depotCode}-${String(existingSerialCount + i).padStart(3, '0')}-${randomCode}`,
                    depotId: depot.id,
                    depotName: depot.name,
                    status: 'IN_STOCK' as const,
                    historyJson: JSON.stringify([
                      {
                        action: 'BULK_IMPORT_STOCK',
                        depot: depot.name,
                        timestamp: new Date().toISOString(),
                        notes: 'Imported via CSV/Excel batch operation',
                      },
                    ]),
                  };
                  serialsToCreate.push(snObject);
                  dataStore.createSerialNumber(snObject);
                }
              }
            }
          }
        }

        if (serialsToCreate.length > 0) {
          try {
            await prisma.serialNumber.createMany({
              data: serialsToCreate,
              skipDuplicates: true,
            });
          } catch {}
        }
      } catch (insertError: any) {
        failedRows.push({
          row: item.rowNum,
          sku: item.cleanSku,
          name: item.name,
          error: insertError.message || 'Error processing product row',
        });
      }
    }

    return NextResponse.json({
      success: true,
      totalSubmitted: products.length,
      importedCount: createdCount + updatedCount,
      createdCount,
      updatedCount,
      failedCount: failedRows.length,
      errors: failedRows,
      message: `Successfully processed ${createdCount + updatedCount} products (${createdCount} created, ${updatedCount} updated).`,
    });
  } catch (error: any) {
    console.error('Bulk product import error:', error);
    return NextResponse.json({ error: error.message || 'Bulk import failed' }, { status: 500 });
  }
}
