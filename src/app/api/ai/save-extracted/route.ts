import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { depotIdFilter, guardApi } from '@/lib/api-auth';
import { triggerInvoiceCreatedDepotEmail } from '@/lib/email-service';

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
      customerName = 'Commercial Client',
      companyName = 'Commercial Client LLC',
      email = 'client@example.com',
      phone = '',
      billingAddress = 'Commercial District',
      shippingAddress = 'Logistics Hub',
      currency = 'USD',
      paymentTerms = 'NET 30 days',
      deliveryTerms = 'Air Freight via Courier (CIF)',
      notes = 'Created from Azure Document Intelligence AI Extraction',
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

    if (!customer && email) {
      try {
        customer = await prisma.customer.findFirst({
          where: {
            OR: [
              { email: { equals: email, mode: 'insensitive' } },
              { companyName: { equals: companyName, mode: 'insensitive' } },
            ],
          },
        });
      } catch {}
      if (!customer) {
        customer = dataStore.getCustomers().find(
          (c) =>
            c.email?.toLowerCase() === email.toLowerCase() ||
            c.companyName?.toLowerCase() === companyName.toLowerCase()
        );
      }
    }

    // Auto-create customer if still not found
    if (!customer) {
      const codeSuffix = Date.now().toString().slice(-4);
      const newCustData = {
        customerCode: `CUST-AI-${codeSuffix}`,
        companyName: companyName || customerName,
        contactPerson: customerName || companyName,
        email: email || `contact_${Date.now()}@wholesale-client.com`,
        phone: phone || '',
        billingAddress: billingAddress || 'Wholesale Terminal',
        shippingAddress: shippingAddress || billingAddress || 'Wholesale Terminal',
        country: 'United Arab Emirates',
        taxNumber: 'AI-EXTRACTED-TAX',
        paymentTerms: 'NET_30' as any,
        creditLimit: 50000,
        currentBalance: 0,
        status: 'ACTIVE' as any,
        totalOrders: 1,
        totalSpent: Number(grandTotal) || 0,
      };

      try {
        customer = await prisma.customer.create({ data: newCustData });
        dataStore.createCustomer(customer);
      } catch {
        customer = dataStore.createCustomer(newCustData);
      }
    }

    // 2. Resolve default depot
    const userDepot = depotIdFilter(auth.user);
    const assignedDepotId = userDepot || 'dep-central';
    let depotName = 'Central Depot';
    try {
      const d = dataStore.getDepotById(assignedDepotId);
      if (d) depotName = d.name;
    } catch {}

    // 3. Resolve or Create Products for Line Items
    // 3. Resolve or Create Products for Line Items (Single Batch Query)
    const skusToLookup = lineItems
      .map((it: any, idx: number) => (it.sku || it.productCode || `SKU-AI-${Date.now().toString().slice(-4)}-${idx + 1}`).trim())
      .filter(Boolean);

    let dbProducts: any[] = [];
    try {
      dbProducts = await prisma.product.findMany({
        where: { sku: { in: skusToLookup, mode: 'insensitive' } },
      });
    } catch {}

    const dbProductMap = new Map(dbProducts.map((p) => [p.sku.toLowerCase(), p]));
    const storeProducts = dataStore.getProducts();
    const storeProductMap = new Map(storeProducts.map((p) => [p.sku?.toLowerCase(), p]));

    const resolvedItems: any[] = [];

    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      const desc = item.description || `AI Equipment Line ${i + 1}`;
      const sku = item.sku || item.productCode || `SKU-AI-${Date.now().toString().slice(-4)}-${i + 1}`;
      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice) || 0;
      const taxRate = Number(item.taxRate) || 5;
      const taxAmt = Number(item.taxAmount) || (qty * unitPrice * (taxRate / 100));
      const lineTotal = Number(item.amount) || qty * unitPrice + taxAmt;

      // Find product by SKU from batch-loaded maps
      let matchedProd: any = dbProductMap.get(sku.toLowerCase()) || storeProductMap.get(sku.toLowerCase());

      // If no product found, find any existing product or fallback to a dummy/created product
      if (!matchedProd) {
        const prods = dataStore.getProducts();
        if (prods.length > 0) {
          matchedProd = prods[0];
        } else {
          // Create product in dataStore
          matchedProd = dataStore.createProduct({
            sku,
            name: desc,
            brand: 'Commercial Optical',
            model: 'Wholesale Unit',
            category: 'Cameras',
            wholesalePrice: unitPrice,
            sellingPrice: unitPrice,
            costPrice: unitPrice * 0.8,
            currency: currency || 'USD',
            taxRate,
            isAccessory: false,
            trackSerial: true,
          } as any);
        }
      }

      resolvedItems.push({
        productId: matchedProd.id,
        productSku: sku,
        productName: desc,
        brand: matchedProd.brand || 'Canon',
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

      triggerInvoiceCreatedDepotEmail(invoice);

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
