import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi, depotIdFilter } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'depots.read');
  if (!auth.ok) return auth.response;

  try {
    const scopedDepotId = depotIdFilter(auth.user);
    const whereClause = scopedDepotId ? { id: scopedDepotId } : undefined;

    const depots = await withDbTimeout(() =>
      prisma.depot.findMany({
        where: whereClause,
        include: {
          inventories: {
            include: {
              product: true,
            },
          },
          taxInvoices: {
            where: {
              fulfilmentStatus: {
                in: ['READY_FOR_PACKING', 'PROCESSING', 'PACKED'],
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    );

    const enrichedDepots = depots.map((d) => {
      const totalUnits = d.inventories.reduce((sum, inv) => sum + (inv.quantity || 0), 0);
      const totalValue = d.inventories.reduce((sum, inv) => {
        const price = inv.product?.wholesalePrice || inv.product?.sellingPrice || inv.product?.purchasePrice || 0;
        return sum + (inv.quantity || 0) * price;
      }, 0);
      const activeOrders = d.taxInvoices.length;

      return {
        id: d.id,
        code: d.code,
        name: d.name,
        city: d.city,
        country: d.country,
        address: d.address,
        contactPerson: d.contactPerson,
        email: d.email,
        phone: d.phone,
        isCentralHub: d.isCentralHub,
        totalStockUnits: totalUnits,
        totalStockValue: totalValue,
        activeOrdersCount: activeOrders,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      };
    });

    return NextResponse.json(enrichedDepots);
  } catch (error) {
    console.error('Error fetching depots from DB, using fallback:', error);
    try {
      return NextResponse.json(dataStore.getDepots());
    } catch {
      return NextResponse.json([]);
    }
  }
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'depots.write');
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const name = str(body.name);
  const city = str(body.city);
  const country = str(body.country);
  const address = str(body.address, 300);
  const contactPerson = str(body.contactPerson);
  const phone = str(body.phone, 40);
  const email = str(body.email, 200).toLowerCase();
  const code = str(body.code, 12).toUpperCase().replace(/[^A-Z0-9-]/g, '');

  const missing = (
    [['name', name], ['code', code], ['address', address], ['city', city], ['country', country], ['contact person', contactPerson], ['phone', phone], ['email', email]] as const
  ).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return NextResponse.json({ error: `Required: ${missing.join(', ')}.` }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });

  try {
    if (await prisma.depot.findUnique({ where: { code }, select: { id: true } })) {
      return NextResponse.json({ error: `Depot code ${code} is already in use.` }, { status: 409 });
    }
    const depot = await prisma.depot.create({
      data: { code, name, address, city, country, contactPerson, phone, email, isCentralHub: false },
    });
    return NextResponse.json(
      { ...depot, totalStockUnits: 0, totalStockValue: 0, activeOrdersCount: 0 },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating depot:', error);
    return NextResponse.json({ error: 'Failed to create depot.' }, { status: 500 });
  }
}
