import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { ledgerCheck } from '@/lib/inventory/ledger';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * One-off, explicit: writes a labelled "ledger opening balance" row for every product/depot whose stock on hand is not
 * explained by recorded movements (stock entered before every movement was logged). No balance changes; afterwards the
 * ledger adds up to the stock on hand and any NEW difference stands out. Requires { confirm: true }; audited.
 */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.adjust');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) return NextResponse.json({ error: 'Review the ledger check first, then send { confirm: true }.' }, { status: 400 });
  const { differences } = await ledgerCheck();
  if (!differences.length) return NextResponse.json({ created: 0 });
  const products = await prisma.product.findMany({ where: { id: { in: differences.map((d) => d.productId) } }, select: { id: true, purchasePrice: true } });
  const cost = new Map(products.map((p) => [p.id, p.purchasePrice || 0]));
  await prisma.stockTransaction.createMany({
    data: differences.map((d) => ({
      type: 'STOCK_ADJUSTMENT' as const, productId: d.productId, productSku: d.sku, productName: d.name,
      ...(d.unrecorded > 0 ? { targetDepotId: d.depotId, targetDepotName: d.depotName } : { sourceDepotId: d.depotId, sourceDepotName: d.depotName }),
      quantity: Math.abs(d.unrecorded), unitCost: cost.get(d.productId) ?? 0, referenceNumber: 'LEDGER-OPENING',
      notes: `Ledger opening balance: ${d.unrecorded} of the ${d.balance} on hand were not in the ledger (stock before every movement was recorded). No stock changed.`,
      createdBy: auth.user.name,
    })),
  });
  await writeAudit({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, { action: 'STOCK_LEDGER_OPENING_BALANCES', entityType: 'INVENTORY', entityId: 'ledger', entityLabel: 'Stock ledger', description: `Recorded ledger opening balances for ${differences.length} product/depot balance(s); no stock quantity changed`, newValue: differences.map((d) => ({ sku: d.sku, depot: d.depotName, unrecorded: d.unrecorded })) });
  return NextResponse.json({ created: differences.length });
}
