import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi, depotIdFilter } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'serials.read');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get('productId') || undefined;
    let depotId = searchParams.get('depotId') || undefined;
    const status = searchParams.get('status') || undefined;
    const { take, skip } = parsePagination(req);

    const depotFilter = depotIdFilter(auth.user);
    if (depotFilter) {
      depotId = depotFilter;
    }

    try {
      const serials = await prisma.serialNumber.findMany({
        where: {
          ...(productId && { productId }),
          ...(depotId && { depotId }),
          ...(status && { status: status as any }),
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      });
      return NextResponse.json(serials);
    } catch {
      let serials = dataStore.getSerialNumbers(productId);
      if (depotId) {
        serials = serials.filter((s) => s.depotId === depotId);
      }
      if (status) {
        serials = serials.filter((s) => s.status === status);
      }
      return NextResponse.json(serials);
    }
  } catch (error) {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'serials.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { productId, depotId, serialNumber, status = 'IN_STOCK' } = body;

    if (!productId || !depotId || !serialNumber) {
      return NextResponse.json({ error: 'productId, depotId, and serialNumber are required' }, { status: 400 });
    }

    let productSku = body.productSku;
    let productName = body.productName;
    let depotName = body.depotName;

    try {
      if (!productSku || !productName) {
        const prod = await prisma.product.findUnique({ where: { id: productId } });
        if (prod) {
          productSku = prod.sku;
          productName = prod.name;
        }
      }
      if (!depotName) {
        const dep = await prisma.depot.findUnique({ where: { id: depotId } });
        if (dep) {
          depotName = dep.name;
        }
      }
    } catch {}

    const serialData = {
      productId,
      productSku: productSku || 'SKU-UNKNOWN',
      productName: productName || 'Product Optics',
      depotId,
      depotName: depotName || 'Depot',
      serialNumber: serialNumber.trim(),
      status: status as any,
    };
    
    try {
      const serial = await prisma.serialNumber.create({
        data: serialData,
      });
      dataStore.createSerialNumber(serialData);
      return NextResponse.json(serial, { status: 201 });
    } catch (createErr: any) {
      const serial = dataStore.createSerialNumber(serialData);
      return NextResponse.json(serial, { status: 201 });
    }
  } catch (error: any) {
    console.error('Error creating serial number:', error);
    return NextResponse.json({ error: error.message || 'Failed to create serial number' }, { status: 500 });
  }
}
