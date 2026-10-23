import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'customers.read');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim();
    const { take, skip } = parsePagination(req);

    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { contactPerson: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { phone: { contains: q, mode: 'insensitive' as const } },
            { country: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const suppliers = await withDbTimeout(() =>
      prisma.supplier.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      })
    );
    return NextResponse.json(suppliers);
  } catch (error) {
    try {
      const q = new URL(req.url).searchParams.get('q')?.trim();
      return NextResponse.json(dataStore.getSuppliers({ search: q }));
    } catch {
      return NextResponse.json([]);
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'customers.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const { name, contactPerson = '', email, phone = '', address = '', country = 'United Arab Emirates', taxId = '', paymentTerms = 'NET_30' } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Supplier company name is required' }, { status: 400 });
    }
    if (!email?.trim()) {
      return NextResponse.json({ error: 'Supplier email is required' }, { status: 400 });
    }

    let supplier: any;
    try {
      supplier = await prisma.supplier.create({
        data: {
          name: name.trim(),
          contactPerson: contactPerson.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          address: address.trim(),
          country: country.trim(),
          taxId: taxId.trim(),
          paymentTerms: paymentTerms.trim(),
        },
      });
      dataStore.createSupplier(supplier);
    } catch (dbError) {
      supplier = dataStore.createSupplier({
        name: name.trim(),
        contactPerson: contactPerson.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        address: address.trim(),
        country: country.trim(),
        taxId: taxId.trim(),
        paymentTerms: paymentTerms.trim(),
      });
    }

    return NextResponse.json(supplier, { status: 201 });
  } catch (error: any) {
    console.error('Error creating supplier:', error);
    return NextResponse.json({ error: error?.message || 'Failed to create supplier', details: String(error) }, { status: 500 });
  }
}
