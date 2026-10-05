import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readShareToken } from '@/lib/documents/share-token';
import { getCompanySettingsCached } from '@/lib/settings-cache';

export const dynamic = 'force-dynamic';

/** Public (token-protected) read-only view of ONE tax invoice for the customer portal. Internal fields are never returned. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = readShareToken('TAX_INVOICE', decodeURIComponent(token));
  if (!id) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const inv = await prisma.taxInvoice.findUnique({
    where: { id },
    include: { items: true, shipment: { select: { courier: true, airwayBillNumber: true, trackingUrl: true, status: true } } },
  }).catch(() => null);
  if (!inv || inv.documentStatus === 'DRAFT') return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const s: any = (await getCompanySettingsCached()) || {};
  return NextResponse.json({
    invoice: {
      invoiceNumber: inv.invoiceNumber, proformaNumber: inv.proformaNumber, documentStatus: inv.documentStatus,
      paymentStatus: inv.paymentStatus, fulfilmentStatus: inv.fulfilmentStatus,
      customerCompany: inv.customerCompany, customerName: inv.customerName, customerEmail: inv.customerEmail, customerPhone: inv.customerPhone,
      billingAddress: inv.billingAddress, shippingAddress: inv.shippingAddress,
      issueDate: inv.issuedAt || inv.issueDate, dueDate: inv.dueDate, paymentTerms: inv.paymentTerms, paymentMethod: inv.paymentMethod, incoterm: inv.incoterm, incotermPlace: inv.incotermPlace, deliveryTerms: inv.deliveryTerms, currency: inv.currency, notes: inv.notes,
      subtotal: inv.subtotal, discountAmount: inv.discountAmount, taxAmount: inv.taxAmount, shippingCost: inv.shippingCost, otherCharges: inv.otherCharges, grandTotal: inv.grandTotal,
      items: inv.items.map((i) => ({ id: i.id, productName: i.productName, productSku: i.productSku, brand: i.brand, quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, taxAmount: i.taxAmount, totalPrice: i.totalPrice })),
      shipment: inv.shipment,
    },
    company: {
      name: s.companyName || s.tradingName, address: s.companyAddress, phone: s.phone, email: s.email,
      vat: s.vatGstNumber || s.taxRegistrationNumber, corporateTax: s.corporateTaxNumber, tradeLicence: s.tradeLicenceNumber, duns: s.dunsNumber,
      bankName: s.bankName, accountName: s.accountName, accountNumber: s.accountNumber, swiftBic: s.swiftBic, iban: s.iban, routingCode: s.routingCode,
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
