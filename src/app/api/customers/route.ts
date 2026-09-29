import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { isValidEmail, isValidPhone, checkNonNegative } from '@/lib/validation';
import { guardApi } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'customers.read');
  if (!auth.ok) return auth.response;

  try {
    const q = req.nextUrl.searchParams.get('q')?.trim();
    const { take, skip } = parsePagination(req);

    const where = q
      ? {
          OR: [
            { companyName: { contains: q, mode: 'insensitive' as const } },
            { contactPerson: { contains: q, mode: 'insensitive' as const } },
            { customerCode: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { phone: { contains: q, mode: 'insensitive' as const } },
            { country: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const customers = await withDbTimeout(() =>
      prisma.customer.findMany({
        where,
        include: {
          taxInvoices: {
            select: {
              grandTotal: true,
              paymentStatus: true,
              fulfilmentStatus: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      })
    );

    const enriched = customers.map((c: any) => {
      const valid = (c.taxInvoices || []).filter((i: any) => i.fulfilmentStatus !== 'CANCELLED');
      if (valid.length > 0) {
        const totalOrders = valid.length;
        const totalSpent = valid
          .filter((i: any) => i.paymentStatus === 'PAID')
          .reduce((sum: number, i: any) => sum + (Number(i.grandTotal) || 0), 0);
        const currentBalance = valid
          .filter((i: any) => i.paymentStatus !== 'PAID')
          .reduce((sum: number, i: any) => sum + (Number(i.grandTotal) || 0), 0);
        const { taxInvoices, ...rest } = c;
        return {
          ...rest,
          currentBalance,
          totalOrders,
          totalSpent,
        };
      }
      const { taxInvoices, ...rest } = c;
      return {
        ...rest,
        currentBalance: Math.max(0, c.currentBalance || 0),
      };
    });
    return NextResponse.json(enriched);
  } catch (error) {
    try {
      const q = req.nextUrl.searchParams.get('q')?.trim()?.toLowerCase();
      let list = dataStore.getCustomers();
      if (q) {
        list = list.filter(
          (c) =>
            c.companyName.toLowerCase().includes(q) ||
            c.contactPerson.toLowerCase().includes(q) ||
            c.customerCode.toLowerCase().includes(q) ||
            c.email.toLowerCase().includes(q) ||
            (c.phone && c.phone.toLowerCase().includes(q)) ||
            (c.country && c.country.toLowerCase().includes(q))
        );
      }
      return NextResponse.json(list);
    } catch {
      return NextResponse.json([]);
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'customers.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const cleanEmail = body.email?.trim().toLowerCase();
    if (!cleanEmail) {
      return NextResponse.json({ error: 'Customer email is required' }, { status: 400 });
    }
    if (!body.companyName?.trim()) {
      return NextResponse.json({ error: 'Company name is required' }, { status: 400 });
    }
    if (!isValidEmail(cleanEmail)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }
    if (!isValidPhone(body.phone)) {
      return NextResponse.json({ error: 'Enter a valid phone number (7-15 digits)' }, { status: 400 });
    }
    const negErr = checkNonNegative({ creditLimit: body.creditLimit });
    if (negErr) return NextResponse.json({ error: negErr }, { status: 400 });

    // Duplicate email check
    try {
      const existingCustomer = await prisma.customer.findFirst({
        where: { email: { equals: cleanEmail, mode: 'insensitive' } },
      });
      if (existingCustomer) {
        return NextResponse.json({ error: `Customer with email "${cleanEmail}" already exists` }, { status: 409 });
      }
    } catch {
      const storeExisting = dataStore.getCustomers().find((c) => c.email.toLowerCase() === cleanEmail);
      if (storeExisting) {
        return NextResponse.json({ error: `Customer with email "${cleanEmail}" already exists` }, { status: 409 });
      }
    }
    
    // Attempt DB creation
    let customer;
    try {
      // Generate customer code
      const lastCustomer = await prisma.customer.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      const lastNumber = lastCustomer && lastCustomer.customerCode?.split('-')?.[2] ? parseInt(lastCustomer.customerCode.split('-')[2]) : 0;
      const customerCode = `CUST-${(body.country || 'UAE').substring(0, 3).toUpperCase()}-${String((isNaN(lastNumber) ? 0 : lastNumber) + 1).padStart(3, '0')}`;

      customer = await prisma.customer.create({
        data: {
          companyName: body.companyName.trim(),
          contactPerson: body.contactPerson?.trim() || body.companyName.trim(),
          email: cleanEmail,
          phone: body.phone?.trim() || null,
          billingAddress: body.billingAddress?.trim() || 'Dubai, UAE',
          shippingAddress: body.shippingAddress?.trim() || body.billingAddress?.trim() || 'Dubai, UAE',
          country: body.country?.trim() || 'United Arab Emirates',
          taxNumber: body.taxNumber?.trim() || 'TAX-PENDING',
          paymentTerms: body.paymentTerms || 'NET_30',
          creditLimit: Number(body.creditLimit) || 50000,
          currentBalance: 0,
          notes: body.notes?.trim() || null,
          status: body.status || 'ACTIVE',
          customerCode,
          totalOrders: 0,
          totalSpent: 0,
        },
      });
      dataStore.createCustomer({
        ...customer,
      });
    } catch (dbError) {
      console.error('Customer DB error:', dbError);
      const customers = dataStore.getCustomers();
      const lastCustomer = customers[0];
      const lastNumber = lastCustomer && lastCustomer.customerCode?.split('-')?.[2] ? parseInt(lastCustomer.customerCode.split('-')[2]) : customers.length;
      const customerCode = `CUST-${(body.country || 'UAE').substring(0, 3).toUpperCase()}-${String((isNaN(lastNumber) ? customers.length : lastNumber) + 1).padStart(3, '0')}`;
      
      customer = dataStore.createCustomer({
        ...body,
        customerCode,
      });

      try {
        dataStore.addAuditLog({
          action: 'USER_PERMISSION_CHANGE' as any,
          entityType: 'CUSTOMER',
          entityId: customer.id,
          entityLabel: customer.companyName,
          description: `Created customer account for ${customer.companyName}`,
        });
      } catch {}
    }

    return NextResponse.json(customer, { status: 201 });
  } catch (error) {
    console.error('Error creating customer:', error);
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 });
  }
}
