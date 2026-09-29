import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { depotIdFilter, guardApi } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

const EMPTY: any[] = [];

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'search.use');
  if (!auth.ok) return auth.response;

  try {
    const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 100);
    if (!q) return NextResponse.json({ success: true, results: [] });

    const role = auth.user.role;
    const depotId = depotIdFilter(auth.user);
    const contains = { contains: q, mode: 'insensitive' as const };
    const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(role, p);

    // Every source is gated by the same permission that protects its page/API, so search can
    // never reveal a record type the user could not open.
    const [invoices, proformas, serviceInvoices, products, customers, suppliers, shipments, documents, users] =
      await Promise.all([
        can('invoices.read')
          ? prisma.taxInvoice.findMany({
              where: { ...(depotId && { depotId }), OR: [{ invoiceNumber: contains }, { customerCompany: contains }, { customerName: contains }] },
              orderBy: { createdAt: 'desc' },
              take: 5,
            })
          : EMPTY,
        can('proformas.read')
          ? prisma.proforma.findMany({
              where: { OR: [{ proformaNumber: contains }, { customerCompany: contains }, { customerName: contains }] },
              orderBy: { createdAt: 'desc' },
              take: 5,
            })
          : EMPTY,
        can('service_invoices.read')
          ? prisma.serviceInvoice.findMany({
              where: { OR: [{ invoiceNumber: contains }, { customerCompany: contains }, { customerName: contains }] },
              orderBy: { createdAt: 'desc' },
              take: 5,
            })
          : EMPTY,
        can('products.read')
          ? prisma.product.findMany({
              where: { OR: [{ sku: contains }, { name: contains }, { brand: contains }, { barcode: contains }], ...(depotId && { inventories: { some: { depotId } } }) },
              take: 5,
            })
          : EMPTY,
        can('customers.read')
          ? prisma.customer.findMany({
              where: { OR: [{ companyName: contains }, { contactPerson: contains }, { customerCode: contains }, { email: contains }, { phone: contains }] },
              take: 5,
            })
          : EMPTY,
        can('customers.read')
          ? prisma.supplier.findMany({ where: { OR: [{ name: contains }, { contactPerson: contains }, { email: contains }] }, take: 5 })
          : EMPTY,
        can('shipments.read')
          ? prisma.shipment.findMany({
              where: { ...(depotId && { depotId }), OR: [{ shipmentNumber: contains }, { airwayBillNumber: contains }, { customerCompany: contains }, { invoiceNumber: contains }] },
              take: 5,
            })
          : EMPTY,
        can('documents.read')
          ? prisma.cloudDocument.findMany({
              where: { ...(depotId && { depotId }), OR: [{ title: contains }, { fileName: contains }, { relatedEntityLabel: contains }] },
              take: 5,
            })
          : EMPTY,
        can('users.read')
          ? prisma.user.findMany({ where: { OR: [{ name: contains }, { email: contains }] }, take: 5 })
          : EMPTY,
      ]);

    const results = [
      ...invoices.map((x: any) => ({ category: 'Tax Invoices', title: x.invoiceNumber, subtitle: `${x.customerCompany} • ${x.fulfilmentStatus}`, link: `/invoices/${x.id}`, badge: x.fulfilmentStatus })),
      ...proformas.map((x: any) => ({ category: 'Proformas', title: x.proformaNumber, subtitle: `${x.customerCompany} • ${x.status}`, link: `/proformas/${x.id}`, badge: x.status })),
      ...serviceInvoices.map((x: any) => ({ category: 'Service Invoices', title: x.invoiceNumber, subtitle: `${x.customerCompany} • ${x.status}`, link: `/service-invoices/${x.id}`, badge: x.status })),
      ...products.map((x: any) => ({ category: 'Products & Inventory', title: `${x.name} (${x.sku})`, subtitle: `${x.brand} • Stock: ${x.totalStock}`, link: `/products/${x.id}`, badge: x.brand })),
      ...customers.map((x: any) => ({ category: 'Customers', title: x.companyName, subtitle: `${x.contactPerson} • ${x.country}`, link: `/customers/${x.id}`, badge: x.customerCode })),
      ...suppliers.map((x: any) => ({ category: 'Suppliers', title: x.name, subtitle: `${x.contactPerson} • ${x.country}`, link: `/suppliers?search=${encodeURIComponent(x.name)}`, badge: 'Supplier' })),
      ...shipments.map((x: any) => ({ category: 'Shipments & Airway Bills', title: `AWB: ${x.airwayBillNumber}`, subtitle: `${x.customerCompany} • ${x.status}`, link: `/shipments/${x.id}`, badge: x.status })),
      ...documents.map((x: any) => ({ category: 'Cloud Documents', title: x.title, subtitle: x.fileName, link: `/documents?search=${encodeURIComponent(x.fileName)}`, badge: x.category })),
      ...users.map((x: any) => ({ category: 'Users', title: x.name, subtitle: `${x.email} • ${x.role}`, link: `/users?search=${encodeURIComponent(x.email)}`, badge: x.role })),
    ].slice(0, 30);

    return NextResponse.json({ success: true, results });
  } catch (error) {
    // Do not pretend "no results" when the database is unreachable.
    console.error('[Search] failed:', error);
    return NextResponse.json({ success: false, error: 'Search is temporarily unavailable', results: [] }, { status: 503 });
  }
}
