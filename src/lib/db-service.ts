import { prisma } from '@/lib/prisma';
import {
  Customer,
  Product,
  User,
  Depot,
  Proforma,
  TaxInvoice,
  Shipment,
  CloudDocument,
  AuditLog,
  Notification,
  CompanySettings,
  StockTransfer,
  StockAdjustment,
} from '@/types/erp';

export class DbService {
  // ==========================
  // CUSTOMERS
  // ==========================
  static async getCustomers(): Promise<any[]> {
    return await prisma.customer.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        proformas: true,
        taxInvoices: true,
      },
    });
  }

  static async getCustomerById(id: string): Promise<any | null> {
    return await prisma.customer.findUnique({
      where: { id },
      include: {
        proformas: true,
        taxInvoices: true,
        shipments: true,
      },
    });
  }

  static async createCustomer(data: any): Promise<any> {
    const count = await prisma.customer.count();
    const customerCode = data.customerCode || `CUST-GLB-${String(count + 1).padStart(3, '0')}`;

    return await prisma.customer.create({
      data: {
        customerCode,
        companyName: data.companyName,
        contactPerson: data.contactPerson,
        email: data.email,
        phone: data.phone || '',
        billingAddress: data.billingAddress || `${data.companyName}, ${data.country || 'Global'}`,
        shippingAddress: data.shippingAddress || data.billingAddress || `${data.companyName}, ${data.country || 'Global'}`,
        country: data.country || 'United Arab Emirates',
        taxNumber: data.taxNumber || 'TAX-PENDING',
        paymentTerms: data.paymentTerms || 'NET_30',
        creditLimit: Number(data.creditLimit) || 50000,
        currentBalance: Number(data.currentBalance) || 0,
        notes: data.notes || '',
        status: data.status || 'ACTIVE',
      },
    });
  }

  static async updateCustomer(id: string, data: any): Promise<any> {
    return await prisma.customer.update({
      where: { id },
      data,
    });
  }

  static async deleteCustomer(id: string): Promise<any> {
    return await prisma.customer.delete({
      where: { id },
    });
  }

  // ==========================
  // PRODUCTS & INVENTORY
  // ==========================
  static async getProducts(): Promise<any[]> {
    const products = await prisma.product.findMany({
      include: {
        inventories: true,
        serialNumbers: true,
        category: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return products.map((p) => {
      const depotBreakdown: Record<string, number> = {};
      p.inventories.forEach((inv) => {
        depotBreakdown[inv.depotId] = inv.quantity;
      });
      return {
        ...p,
        depotBreakdown,
      };
    });
  }

  static async getProductById(id: string): Promise<any | null> {
    const p = await prisma.product.findUnique({
      where: { id },
      include: {
        inventories: true,
        serialNumbers: true,
        category: true,
      },
    });
    if (!p) return null;

    const depotBreakdown: Record<string, number> = {};
    p.inventories.forEach((inv) => {
      depotBreakdown[inv.depotId] = inv.quantity;
    });

    return {
      ...p,
      depotBreakdown,
    };
  }

  static async createProduct(data: any): Promise<any> {
    let category = await prisma.category.findFirst({
      where: { name: data.categoryName || 'Camera Bodies' },
    });

    if (!category) {
      category = await prisma.category.findFirst() || await prisma.category.create({
        data: {
          name: data.categoryName || 'General Optics',
          slug: (data.categoryName || 'general-optics').toLowerCase().replace(/\s+/g, '-'),
        },
      });
    }

    const totalStock = Object.values(data.depotBreakdown || {}).reduce(
      (acc: number, val: any) => acc + (Number(val) || 0),
      0
    );

    const product = await prisma.product.create({
      data: {
        sku: data.sku,
        name: data.name,
        brand: data.brand,
        model: data.model || `${data.name}`,
        categoryId: category.id,
        categoryName: category.name,
        subcategory: data.subcategory || 'Professional Equipment',
        description: data.description || `${data.brand} ${data.name} wholesale camera equipment`,
        imageUrl: data.imageUrl || 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800',
        barcode: data.barcode || `BC-${data.sku.replace(/[^a-zA-Z0-9]/g, '')}`,
        trackSerial: Boolean(data.trackSerial),
        purchasePrice: Number(data.purchasePrice) || 0,
        wholesalePrice: Number(data.wholesalePrice) || Number(data.sellingPrice) * 0.9,
        sellingPrice: Number(data.sellingPrice) || 0,
        taxRate: Number(data.taxRate) || 5,
        minStockLevel: Number(data.minStockLevel) || 10,
        totalStock,
      },
    });

    if (data.depotBreakdown) {
      for (const [depotId, qty] of Object.entries(data.depotBreakdown)) {
        await prisma.depotInventory.upsert({
          where: {
            productId_depotId: {
              productId: product.id,
              depotId: depotId,
            },
          },
          update: {
            quantity: Number(qty) || 0,
            availableQuantity: Number(qty) || 0,
          },
          create: {
            productId: product.id,
            depotId: depotId,
            quantity: Number(qty) || 0,
            allocatedQuantity: 0,
            availableQuantity: Number(qty) || 0,
            minStockLevel: Number(data.minStockLevel) || 5,
          },
        });
      }
    }

    return product;
  }

  // ==========================
  // PROFORMAS
  // ==========================
  static async getProformas(): Promise<any[]> {
    return await prisma.proforma.findMany({
      include: {
        items: true,
        customer: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getProformaById(id: string): Promise<any | null> {
    return await prisma.proforma.findUnique({
      where: { id },
      include: {
        items: true,
        customer: true,
      },
    });
  }

  static async createProforma(data: any): Promise<any> {
    const count = await prisma.proforma.count();
    const proformaNumber = `PF-2026-${String(count + 1).padStart(5, '0')}`;

    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
    });

    let subtotal = 0;
    let taxAmount = 0;

    const itemsToCreate = (data.items || []).map((item: any) => {
      const itemSub = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100);
      const itemTax = itemSub * ((item.taxRate || 5) / 100);
      const total = itemSub + itemTax;
      subtotal += item.quantity * item.unitPrice;
      taxAmount += itemTax;

      return {
        productId: item.productId,
        productSku: item.productSku || 'SKU-GEN',
        productName: item.productName || 'Equipment Item',
        brand: item.brand || 'Canon',
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice) || 0,
        discountPercent: Number(item.discountPercent) || 0,
        taxRate: Number(item.taxRate) || 5,
        taxAmount: itemTax,
        totalPrice: total,
        selectedDepotId: item.selectedDepotId || null,
        selectedDepotName: item.selectedDepotName || null,
        trackSerial: item.trackSerial ?? true,
      };
    });

    const discountAmount = subtotal * ((data.discountPercent || 0) / 100);
    const grandTotal = subtotal - discountAmount + taxAmount + (Number(data.shippingCost) || 0);

    const expiryDays = Number(data.expiryDays) || 15;
    const expiryDate = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    return await prisma.proforma.create({
      data: {
        proformaNumber,
        customerId: data.customerId,
        customerName: customer?.contactPerson || data.customerName || 'Wholesale Client',
        customerEmail: customer?.email || data.customerEmail || '',
        customerCompany: customer?.companyName || data.customerCompany || 'Client Company',
        customerPhone: customer?.phone || data.customerPhone || '',
        billingAddress: customer?.billingAddress || data.billingAddress || '',
        shippingAddress: customer?.shippingAddress || data.shippingAddress || '',
        managerId: data.managerId || 'usr-mgr',
        managerName: data.managerName || 'Marcus Vance',
        issueDate: new Date(),
        expiryDate,
        paymentTerms: data.paymentTerms || 'NET 30 days from dispatch',
        deliveryTerms: data.deliveryTerms || 'Air Freight via Courier (CIF)',
        notes: data.notes || '',
        subtotal,
        discountPercent: Number(data.discountPercent) || 0,
        discountAmount,
        taxAmount,
        shippingCost: Number(data.shippingCost) || 0,
        grandTotal,
        currency: 'USD',
        status: 'DRAFT',
        items: {
          create: itemsToCreate,
        },
      },
      include: {
        items: true,
      },
    });
  }

  // ==========================
  // TAX INVOICES & FULFILMENT
  // ==========================
  static async getInvoices(): Promise<any[]> {
    return await prisma.taxInvoice.findMany({
      include: {
        items: true,
        packingDetails: true,
        shipment: true,
        customer: true,
        depot: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getInvoiceById(id: string): Promise<any | null> {
    return await prisma.taxInvoice.findUnique({
      where: { id },
      include: {
        items: true,
        packingDetails: true,
        shipment: true,
        customer: true,
        depot: true,
      },
    });
  }

  // ==========================
  // DEPOTS
  // ==========================
  static async getDepots(): Promise<any[]> {
    return await prisma.depot.findMany({
      include: {
        inventories: true,
      },
      orderBy: { isCentralHub: 'desc' },
    });
  }

  // ==========================
  // USERS
  // ==========================
  static async getUsers(): Promise<any[]> {
    return await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==========================
  // SETTINGS
  // ==========================
  static async getCompanySettings(): Promise<any> {
    let settings = await prisma.companySettings.findUnique({
      where: { id: 'global-settings' },
    });

    if (!settings) {
      settings = await prisma.companySettings.create({
        data: {
          id: 'global-settings',
          companyName: 'ARIB GLOBAL',
          tradingName: 'ARIB GLOBAL',
          bankName: 'Commercial Bank of Dubai, Sheikh Zayed Road Branch, Dubai, U.A.E.',
          accountName: 'Arib Global General Trading LLC',
          iban: 'AE91 0230 0000 0100 2416 343',
          swiftBic: 'CBOUAEADXXX',
        },
      });
    }

    return {
      companyName: settings.companyName,
      tradingName: settings.tradingName,
      logoUrl: settings.logoUrl,
      sealUrl: (settings as any).sealUrl || '/arib-seal.png',
      taxRegistrationNumber: settings.taxRegistrationNumber,
      vatGstNumber: settings.vatGstNumber,
      companyAddress: settings.companyAddress,
      phone: settings.phone,
      email: settings.email,
      website: settings.website,
      currency: settings.currency,
      currencySymbol: settings.currencySymbol,
      bankDetails: {
        bankName: settings.bankName,
        accountName: settings.accountName,
        accountNumber: settings.accountNumber,
        swiftBic: settings.swiftBic,
        iban: settings.iban,
        routingCode: settings.routingCode,
      },
      invoicePrefix: settings.invoicePrefix,
      proformaPrefix: settings.proformaPrefix,
      invoiceNextNumber: settings.invoiceNextNumber,
      proformaNextNumber: settings.proformaNextNumber,
      defaultPaymentTerms: settings.defaultPaymentTerms,
      defaultDeliveryTerms: settings.defaultDeliveryTerms,
    };
  }

  // ==========================
  // DOCUMENTS
  // ==========================
  static async getDocuments(filter?: { category?: string; entityId?: string }): Promise<any[]> {
    const where: any = {};
    if (filter?.category && filter.category !== 'ALL') {
      where.category = filter.category;
    }
    if (filter?.entityId) {
      where.relatedEntityId = filter.entityId;
    }

    return await prisma.cloudDocument.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
    });
  }

  static async createDocument(data: any): Promise<any> {
    return await prisma.cloudDocument.create({
      data: {
        title: data.title,
        fileName: data.fileName,
        fileType: data.fileType || 'application/pdf',
        fileFormat: data.fileFormat || 'pdf',
        fileSize: Number(data.fileSize) || 250000,
        cloudinaryUrl: data.cloudinaryUrl,
        cloudinaryPublicId: data.cloudinaryPublicId || `doc_${Date.now()}`,
        category: data.category || 'OTHER',
        relatedEntityType: data.relatedEntityType,
        relatedEntityId: data.relatedEntityId,
        relatedEntityLabel: data.relatedEntityLabel,
        uploadedBy: data.uploadedBy || 'usr-admin',
        uploadedByName: data.uploadedByName || 'System User',
        tags: data.tags || [],
      },
    });
  }
}

export default DbService;
