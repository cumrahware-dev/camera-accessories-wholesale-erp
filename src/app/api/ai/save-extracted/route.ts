import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { depotIdFilter, guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'proformas.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const {
      saveType = 'PROFORMA', // 'PROFORMA' | 'TAX_INVOICE'
      documentNumber,
      customerId: providedCustomerId,
      customerName = '',
      companyName = '',
      email = '',
      phone = '',
      billingAddress = '',
      shippingAddress = '',
      currency = '',
      // Only what the reviewed document actually says. No terms or Incoterm are assumed.
      paymentTerms = '',
      deliveryTerms = '',
      notes = 'Created from OCR extraction after manual review',
      dueDate,
      subtotal = 0,
      taxAmount = 0,
      discountAmount = 0,
      shippingCharges = 0,
      otherCharges = 0,
      grandTotal = 0,
      lineItems = [],
      cloudDocumentId,
    } = body;

    // 0. Validate the reviewed data. Nothing is guessed or filled in here: a record is
    //    only created from values the user has confirmed.
    const problems: string[] = [];
    if (!String(companyName || customerName).trim()) problems.push('Customer / company name is required.');
    if (!String(currency).trim()) problems.push('Currency is required.');
    if (!Array.isArray(lineItems) || lineItems.length === 0) problems.push('At least one line item is required.');
    (lineItems as any[]).forEach((it, i) => {
      if (!String(it?.description || '').trim()) problems.push(`Line ${i + 1}: description is required.`);
      if (!(Number(it?.quantity) > 0)) problems.push(`Line ${i + 1}: quantity must be greater than 0.`);
      if (!(Number(it?.unitPrice) >= 0) || it?.unitPrice === '' || it?.unitPrice == null) problems.push(`Line ${i + 1}: unit price is required.`);
    });
    if (!(Number(grandTotal) > 0)) problems.push('Grand total must be greater than 0.');
    if (problems.length) {
      return NextResponse.json({ error: problems.join(' '), problems }, { status: 422 });
    }

    // Prevent double submission: one uploaded document creates one record.
    if (cloudDocumentId) {
      const doc = await prisma.cloudDocument.findUnique({ where: { id: cloudDocumentId } }).catch(() => null);
      if (doc?.relatedEntityId) {
        return NextResponse.json(
          { error: `This document was already saved as ${doc.relatedEntityLabel || 'a record'}.` },
          { status: 409 }
        );
      }
    }
    if (documentNumber) {
      const num = String(documentNumber).trim();
      const dup =
        saveType === 'TAX_INVOICE'
          ? await prisma.taxInvoice.findUnique({ where: { invoiceNumber: num }, select: { id: true } }).catch(() => null)
          : await prisma.proforma.findUnique({ where: { proformaNumber: num }, select: { id: true } }).catch(() => null);
      if (dup) {
        return NextResponse.json(
          { error: `Document number "${num}" already exists. Change the number or clear it to auto-generate.` },
          { status: 409 }
        );
      }
    }

    // 1. Resolve or Create Customer
    let customer: any = null;

    if (providedCustomerId) {
      try {
        customer = await prisma.customer.findUnique({ where: { id: providedCustomerId } });
      } catch {}
      if (!customer) {
        customer = dataStore.getCustomerById(providedCustomerId);
      }
    }

    if (!customer) {
      const orConds: any[] = [];
      if (email) orConds.push({ email: { equals: email, mode: 'insensitive' } });
      if (companyName) orConds.push({ companyName: { equals: companyName, mode: 'insensitive' } });
      if (orConds.length) {
        try {
          customer = await prisma.customer.findFirst({ where: { OR: orConds } });
        } catch {}
      }
    }

    if (!customer && !String(email).trim()) {
      return NextResponse.json(
        { error: 'No existing customer matches. Enter the customer email so a new customer can be created.' },
        { status: 422 }
      );
    }

    // Auto-create customer if still not found
    if (!customer) {
      const codeSuffix = Date.now().toString().slice(-4);
      const newCustData = {
        customerCode: `CUST-AI-${codeSuffix}`,
        companyName: companyName || customerName,
        contactPerson: customerName || companyName,
        email: String(email).trim(),
        phone: phone || '',
        billingAddress: billingAddress || '',
        shippingAddress: shippingAddress || billingAddress || '',
        currentBalance: 0,
        status: 'ACTIVE' as any,
        totalOrders: 0,
        totalSpent: 0,
      };

      // No dataStore fallback: a failure here must surface, not create a ghost customer.
      customer = await prisma.customer.create({ data: newCustData });
    }

    // 2. Resolve default depot
    // The depot comes from the user's own depot, or from the only active depot; never from a built-in default.
    let assignedDepotId = depotIdFilter(auth.user);
    if (!assignedDepotId) {
      const active = await prisma.depot.findMany({ where: { status: 'ACTIVE' }, select: { id: true }, take: 2 });
      if (active.length === 1) assignedDepotId = active[0].id;
    }
    const depotRow = assignedDepotId ? await prisma.depot.findFirst({ where: { id: assignedDepotId, status: 'ACTIVE' }, select: { id: true, name: true } }) : null;
    if (!depotRow) {
      return NextResponse.json({ error: 'No active depot is available to fulfil this order. Create or activate a depot first.' }, { status: 400 });
    }
    assignedDepotId = depotRow.id;
    const depotName = depotRow.name;

    // 3. Resolve products for line items. Lines are matched to an existing product by SKU,
    //    then by exact product name. A line that matches nothing is NOT silently mapped to an
    //    arbitrary product (that would corrupt stock and pricing) - the user must fix the SKU
    //    or create the product first.
    const skus = (lineItems as any[]).map((it) => String(it.sku || it.productCode || '').trim()).filter(Boolean);
    const names = (lineItems as any[]).map((it) => String(it.description || '').trim()).filter(Boolean);
    const dbProducts = await prisma.product.findMany({
      where: {
        OR: [
          ...(skus.length ? [{ sku: { in: skus, mode: 'insensitive' as const } }] : []),
          { name: { in: names, mode: 'insensitive' as const } },
        ],
      },
    });
    const bySku = new Map(dbProducts.map((p) => [p.sku.toLowerCase(), p]));
    const byName = new Map(dbProducts.map((p) => [p.name.toLowerCase(), p]));

    const unmatched: string[] = [];
    const resolvedItems: any[] = [];

    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      const desc = String(item.description).trim();
      const enteredSku = String(item.sku || item.productCode || '').trim();
      const qty = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      const taxRate = Number(item.taxRate) || 0;
      const taxAmt = Number(item.taxAmount) || (qty * unitPrice * (taxRate / 100));
      const lineTotal = Number(item.amount) || qty * unitPrice + taxAmt;

      const matchedProd: any =
        (enteredSku && bySku.get(enteredSku.toLowerCase())) || byName.get(desc.toLowerCase());
      if (!matchedProd) {
        unmatched.push(`Line ${i + 1} "${desc}"${enteredSku ? ` (SKU ${enteredSku})` : ''}`);
        continue;
      }
      const sku = matchedProd.sku;

      resolvedItems.push({
        productId: matchedProd.id,
        productSku: sku,
        productName: desc,
        brand: matchedProd.brand || '',
        quantity: qty,
        unitPrice,
        discountPercent: Number(item.discount) || 0,
        taxRate,
        taxAmount: Number(taxAmt.toFixed(2)),
        totalPrice: Number(lineTotal.toFixed(2)),
        selectedDepotId: assignedDepotId,
        selectedDepotName: depotName,
        trackSerial: true,
      });
    }

    if (unmatched.length) {
      return NextResponse.json(
        {
          error: `No matching product in the catalogue for: ${unmatched.join('; ')}. Correct the SKU to an existing product or create the product first.`,
          unmatched,
        },
        { status: 422 }
      );
    }

    // 4. Save as PROFORMA or TAX_INVOICE
    if (saveType === 'TAX_INVOICE') {
      let invoice: any = null;
      try {
        const settings = await prisma.companySettings.findUnique({ where: { id: 'global-settings' } }).catch(() => null);
        const nextNum = settings?.invoiceNextNumber || 1;
        const invNum = documentNumber || `${settings?.invoicePrefix || 'INV-2026-'}${String(nextNum).padStart(5, '0')}`;

        invoice = await prisma.taxInvoice.create({
          data: {
            invoiceNumber: invNum,
            customerId: customer.id,
            customerName: customer.contactPerson || customer.companyName,
            customerEmail: customer.email,
            customerCompany: customer.companyName,
            customerPhone: customer.phone || '',
            billingAddress: billingAddress || customer.billingAddress,
            shippingAddress: shippingAddress || customer.shippingAddress || customer.billingAddress,
            depotId: assignedDepotId,
            depotName,
            managerId: auth.user.id,
            managerName: auth.user.name,
            issueDate: new Date(),
            dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 86400000),
            paymentTerms,
            paymentStatus: 'UNPAID',
            fulfilmentStatus: 'READY_FOR_PACKING',
            subtotal: Number(subtotal) || resolvedItems.reduce((acc, it) => acc + it.quantity * it.unitPrice, 0),
            discountAmount: Number(discountAmount) || 0,
            taxAmount: Number(taxAmount) || 0,
            shippingCost: Number(shippingCharges) || 0,
            otherCharges: Number(otherCharges) || 0,
            grandTotal: Number(grandTotal) || 0,
            currency,
            notes,
            items: {
              create: resolvedItems.map((it) => ({
                productId: it.productId,
                productSku: it.productSku,
                productName: it.productName,
                brand: it.brand,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                taxRate: it.taxRate,
                taxAmount: it.taxAmount,
                totalPrice: it.totalPrice,
                depotId: assignedDepotId,
                depotName,
                trackSerial: it.trackSerial,
                isPicked: false,
              })),
            },
          },
          include: { items: true },
        });

        if (settings) {
          await prisma.companySettings.update({
            where: { id: 'global-settings' },
            data: { invoiceNextNumber: nextNum + 1 },
          }).catch(() => {});
        }
      } catch (dbErr) {
        invoice = dataStore.createInvoice({
          customerId: customer.id,
          customerName: customer.contactPerson || customer.companyName,
          customerCompany: customer.companyName,
          customerEmail: customer.email,
          customerPhone: customer.phone || '',
          billingAddress: billingAddress || customer.billingAddress,
          shippingAddress: shippingAddress || customer.shippingAddress || customer.billingAddress,
          depotId: assignedDepotId,
          depotName,
          paymentTerms,
          subtotal: Number(subtotal) || 0,
          discountAmount: Number(discountAmount) || 0,
          taxAmount: Number(taxAmount) || 0,
          shippingCost: Number(shippingCharges) || 0,
          otherCharges: Number(otherCharges) || 0,
          grandTotal: Number(grandTotal) || 0,
          currency,
          notes,
          items: resolvedItems,
        });
      }

      // Link cloud document if present
      if (cloudDocumentId) {
        try {
          await prisma.cloudDocument.update({
            where: { id: cloudDocumentId },
            data: {
              category: 'TAX_INVOICE',
              relatedEntityType: 'INVOICE',
              relatedEntityId: invoice.id,
              relatedEntityLabel: invoice.invoiceNumber,
            },
          }).catch(() => {});
        } catch {}
      }

      return NextResponse.json({
        success: true,
        type: 'TAX_INVOICE',
        id: invoice.id,
        number: invoice.invoiceNumber,
        redirectUrl: '/invoices',
      });
    } else {
      // Default: PROFORMA
      let proforma: any = null;
      try {
        const settings = await prisma.companySettings.findUnique({ where: { id: 'global-settings' } }).catch(() => null);
        const nextNum = settings?.proformaNextNumber || 1;
        const pfNum = documentNumber || `${settings?.proformaPrefix || 'PF-2026-'}${String(nextNum).padStart(5, '0')}`;

        proforma = await prisma.proforma.create({
          data: {
            proformaNumber: pfNum,
            customerId: customer.id,
            customerName: customer.contactPerson || customer.companyName,
            customerEmail: customer.email,
            customerCompany: customer.companyName,
            customerPhone: customer.phone || '',
            billingAddress: billingAddress || customer.billingAddress,
            shippingAddress: shippingAddress || customer.shippingAddress || customer.billingAddress,
            managerId: auth.user.id,
            managerName: auth.user.name,
            issueDate: new Date(),
            expiryDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 15 * 86400000),
            paymentTerms,
            deliveryTerms,
            notes,
            subtotal: Number(subtotal) || resolvedItems.reduce((acc, it) => acc + it.quantity * it.unitPrice, 0),
            discountPercent: 0,
            discountAmount: Number(discountAmount) || 0,
            taxAmount: Number(taxAmount) || 0,
            shippingCost: Number(shippingCharges) || 0,
            otherCharges: Number(otherCharges) || 0,
            grandTotal: Number(grandTotal) || 0,
            currency,
            status: 'DRAFT',
            items: {
              create: resolvedItems.map((it) => ({
                productId: it.productId,
                productSku: it.productSku,
                productName: it.productName,
                brand: it.brand,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                discountPercent: it.discountPercent,
                taxRate: it.taxRate,
                taxAmount: it.taxAmount,
                totalPrice: it.totalPrice,
                selectedDepotId: assignedDepotId,
                selectedDepotName: depotName,
                trackSerial: it.trackSerial,
              })),
            },
          },
          include: { items: true },
        });

        if (settings) {
          await prisma.companySettings.update({
            where: { id: 'global-settings' },
            data: { proformaNextNumber: nextNum + 1 },
          }).catch(() => {});
        }
      } catch (dbErr) {
        proforma = dataStore.createProforma({
          customerId: customer.id,
          customerName: customer.contactPerson || customer.companyName,
          customerEmail: customer.email,
          customerCompany: customer.companyName,
          customerPhone: customer.phone || '',
          billingAddress: billingAddress || customer.billingAddress,
          shippingAddress: shippingAddress || customer.shippingAddress || customer.billingAddress,
          paymentTerms,
          deliveryTerms,
          notes,
          subtotal: Number(subtotal) || 0,
          discountPercent: 0,
          discountAmount: Number(discountAmount) || 0,
          taxAmount: Number(taxAmount) || 0,
          shippingCost: Number(shippingCharges) || 0,
          grandTotal: Number(grandTotal) || 0,
          currency,
          items: resolvedItems,
          status: 'DRAFT',
        });
      }

      // Link cloud document if present
      if (cloudDocumentId) {
        try {
          await prisma.cloudDocument.update({
            where: { id: cloudDocumentId },
            data: {
              category: 'PROFORMA',
              relatedEntityType: 'PROFORMA',
              relatedEntityId: proforma.id,
              relatedEntityLabel: proforma.proformaNumber,
            },
          }).catch(() => {});
        } catch {}
      }

      return NextResponse.json({
        success: true,
        type: 'PROFORMA',
        id: proforma.id,
        number: proforma.proformaNumber,
        redirectUrl: `/proformas/${proforma.id}`,
      });
    }
  } catch (error: any) {
    console.error('[Save Extracted Document Route Error]:', error);
    return NextResponse.json({ error: error?.message || 'Failed to save extracted document to ERP' }, { status: 500 });
  }
}
