import { nextServiceInvoiceNumber } from '@/lib/services/service-invoice-number';
import { dec, round2 } from '@/lib/money';
import { NextRequest, NextResponse } from 'next/server';
import { buildSnapshot } from '@/lib/company';
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
    const body = await req.json().catch(() => ({}));
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

    let lineError: string | null = null;
    (items as any[]).forEach((it, i) => {
      if (lineError) return;
      const q = Number(it?.quantity), u = Number(it?.unitPrice), d = Number(it?.discountPercent ?? 0), t = Number(it?.taxRate ?? 0);
      if (!String(it?.description || '').trim()) lineError = `Line ${i + 1}: description is required`;
      else if (!(q > 0)) lineError = `Line ${i + 1}: quantity must be greater than 0`;
      else if (!(u >= 0)) lineError = `Line ${i + 1}: unit price must be 0 or more`;
      else if (!(d >= 0 && d <= 100)) lineError = `Line ${i + 1}: discount must be between 0 and 100`;
      else if (!(t >= 0 && t <= 100)) lineError = `Line ${i + 1}: tax rate must be between 0 and 100`;
    });
    if (lineError) return NextResponse.json({ error: lineError }, { status: 400 });
    if (!(Number(otherCharges || 0) >= 0)) {
      return NextResponse.json({ error: 'Other charges must be 0 or more' }, { status: 400 });
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
    let subtotal = dec(0);
    let totalDiscount = dec(0);
    let totalTax = dec(0);

    const formattedItems = items.map((item: any) => {
      const qty = Number(item.quantity) || 1;
      const price = Number(item.unitPrice) || 0;
      const discountPct = Number(item.discountPercent) || 0;
      const taxRatePct = Number(item.taxRate) || 0;

      // decimal arithmetic: each line is rounded to the cent once, and the header is the exact sum of the lines
      const baseAmount = dec(qty).times(price);
      const discountVal = dec(round2(baseAmount.times(discountPct).div(100)));
      const netAfterDiscount = baseAmount.minus(discountVal);
      const taxVal = dec(round2(netAfterDiscount.times(taxRatePct).div(100)));
      const lineTotal = netAfterDiscount.plus(taxVal);

      subtotal = subtotal.plus(round2(baseAmount));
      totalDiscount = totalDiscount.plus(discountVal);
      totalTax = totalTax.plus(taxVal);

      return {
        description: item.description || 'General Business Service',
        category: item.category || 'OTHER',
        quantity: qty,
        unitPrice: price,
        discountPercent: discountPct,
        taxRate: taxRatePct,
        taxAmount: taxVal.toNumber(),
        totalPrice: round2(lineTotal),
      };
    });

    const parsedOtherCharges = Number(otherCharges) || 0;
    const grandTotal = round2(subtotal.minus(totalDiscount).plus(totalTax).plus(parsedOtherCharges));

    try {
      const invoiceNumber = await nextServiceInvoiceNumber();

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
          // Anything created already issued is frozen right away; drafts stay live until issued.
          ...(status !== 'DRAFT' ? { companySnapshot: await buildSnapshot() } : {}),
          currency,
          subtotal: subtotal.toNumber(),
          discountAmount: totalDiscount.toNumber(),
          taxAmount: totalTax.toNumber(),
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
    } catch (e: any) {
      // Never report success for something that was not saved to the database (the old fallback wrote it to a local file).
      console.error('[service-invoice] could not be saved:', e?.message);
      return NextResponse.json({ error: 'The service invoice could not be saved. Nothing was created; please try again.' }, { status: 503 });
    }
  } catch (error: any) {
    console.error('Error creating service invoice:', error);
    return NextResponse.json({ error: error.message || 'Failed to create service invoice' }, { status: 500 });
  }
}
