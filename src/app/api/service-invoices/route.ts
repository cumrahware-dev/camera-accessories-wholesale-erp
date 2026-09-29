import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'service_invoices.read');
  if (!auth.ok) return auth.response;

  try {
    const { take, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('q') || searchParams.get('search') || undefined;

    try {
      const where: any = {};
      if (status && status !== 'ALL') {
        where.status = status;
      }

      if (search && search.trim()) {
        const q = search.trim();
        where.OR = [
          { invoiceNumber: { contains: q, mode: 'insensitive' } },
          { customerName: { contains: q, mode: 'insensitive' } },
          { customerCompany: { contains: q, mode: 'insensitive' } },
          { customerEmail: { contains: q, mode: 'insensitive' } },
        ];
      }

      const [invoices, total] = await Promise.all([
        (prisma as any).serviceInvoice.findMany({
          where,
          include: { items: true, customer: true },
          orderBy: { createdAt: 'desc' },
          take,
          skip,
        }),
        (prisma as any).serviceInvoice.count({ where }),
      ]);

      return NextResponse.json({
        invoices,
        total,
        take,
        skip,
      });
    } catch {
      const invoices = dataStore.getServiceInvoices({ status, search });
      return NextResponse.json({
        invoices,
        total: invoices.length,
        take,
        skip,
      });
    }
  } catch (error: any) {
    console.error('Error fetching service invoices:', error);
    return NextResponse.json({ invoices: [], total: 0, take: 50, skip: 0 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'service_invoices.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const {
      customerId,
      issueDate,
      dueDate,
      paymentTerms = 'IMMEDIATE',
      currency = 'USD',
      items = [],
      otherCharges = 0,
      notes,
      internalRemarks,
      status = 'ISSUED',
    } = body;

    if (!customerId) {
      return NextResponse.json({ error: 'Customer is required' }, { status: 400 });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'At least one service line item is required' }, { status: 400 });
    }

    let customer: any = null;
    try {
      customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });
    } catch {}

    if (!customer) {
      customer = dataStore.getCustomerById(customerId);
    }

    if (!customer) {
      return NextResponse.json({ error: 'Selected customer not found' }, { status: 404 });
    }

    // Calculate line items and summary totals
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    const formattedItems = items.map((item: any) => {
      const qty = Number(item.quantity) || 1;
      const price = Number(item.unitPrice) || 0;
      const discountPct = Number(item.discountPercent) || 0;
      const taxRatePct = Number(item.taxRate) || 0;

      const baseAmount = qty * price;
      const discountVal = (baseAmount * discountPct) / 100;
      const netAfterDiscount = baseAmount - discountVal;
      const taxVal = (netAfterDiscount * taxRatePct) / 100;
      const lineTotal = netAfterDiscount + taxVal;

      subtotal += baseAmount;
      totalDiscount += discountVal;
      totalTax += taxVal;

      return {
        description: item.description || 'General Business Service',
        category: item.category || 'OTHER',
        quantity: qty,
        unitPrice: price,
        discountPercent: discountPct,
        taxRate: taxRatePct,
        taxAmount: taxVal,
        totalPrice: lineTotal,
      };
    });

    const parsedOtherCharges = Number(otherCharges) || 0;
    const grandTotal = subtotal - totalDiscount + totalTax + parsedOtherCharges;

    try {
      const count = await (prisma as any).serviceInvoice.count();
      const invoiceNumber = `SINV-${String(count + 1).padStart(6, '0')}`;

      const serviceInvoice = await (prisma as any).serviceInvoice.create({
        data: {
          invoiceNumber,
          customerId: customer.id,
          customerName: customer.contactPerson || customer.companyName,
          customerEmail: customer.email,
          customerCompany: customer.companyName,
          customerPhone: customer.phone || '',
          billingAddress: customer.billingAddress || '',
          issueDate: issueDate ? new Date(issueDate) : new Date(),
          dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 14 * 86400000),
          paymentTerms,
          status,
          currency,
          subtotal,
          discountAmount: totalDiscount,
          taxAmount: totalTax,
          otherCharges: parsedOtherCharges,
          grandTotal,
          notes: notes || null,
          internalRemarks: internalRemarks || null,
          createdBy: auth.user.id,
          createdByName: auth.user.name,
          items: {
            create: formattedItems,
          },
        },
        include: {
          items: true,
          customer: true,
        },
      });

      dataStore.createServiceInvoice(serviceInvoice);

      return NextResponse.json({
        success: true,
        message: `Service Invoice #${serviceInvoice.invoiceNumber} created successfully`,
        invoice: serviceInvoice,
      });
    } catch {
      const sinv = dataStore.createServiceInvoice({
        customerId: customer.id,
        customerName: customer.contactPerson || customer.companyName,
        customerEmail: customer.email,
        customerCompany: customer.companyName,
        customerPhone: customer.phone || '',
        billingAddress: customer.billingAddress || '',
        issueDate,
        dueDate,
        paymentTerms,
        status,
        currency,
        subtotal,
        discountAmount: totalDiscount,
        taxAmount: totalTax,
        otherCharges: parsedOtherCharges,
        grandTotal,
        notes: notes || null,
        internalRemarks: internalRemarks || null,
        items: formattedItems,
      });

      return NextResponse.json({
        success: true,
        message: `Service Invoice #${sinv.invoiceNumber} created successfully`,
        invoice: sinv,
      });
    }
  } catch (error: any) {
    console.error('Error creating service invoice:', error);
    return NextResponse.json({ error: error.message || 'Failed to create service invoice' }, { status: 500 });
  }
}
