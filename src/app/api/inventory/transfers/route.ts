import { parseQty } from '@/lib/quantity';
import { unitDecimals } from '@/lib/units';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { StockError, setTransferStatus, transferStock } from '@/lib/inventory/stock-ops';
import dataStore from '@/lib/data-store';
import { assertDepotAccess, depotIdFilter, guardApi } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.read');
  if (!auth.ok) return auth.response;
  try {
    const scopedDepotId = depotIdFilter(auth.user);
    const { take, skip } = parsePagination(req);
    const transfers = await prisma.stockTransfer.findMany({
      where: scopedDepotId ? { OR: [{ sourceDepotId: scopedDepotId }, { destinationDepotId: scopedDepotId }] } : undefined,
      include: {
        items: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    return NextResponse.json(transfers);
  } catch (error) {
    try {
      const scopedDepotId = depotIdFilter(auth.user);
      let transfers = dataStore.getTransfers();
      if (scopedDepotId) {
        transfers = transfers.filter((t) => t.sourceDepotId === scopedDepotId || t.destinationDepotId === scopedDepotId);
      }
      return NextResponse.json(transfers);
    } catch {
      return NextResponse.json([]);
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.transfer');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const { sourceDepotId, destinationDepotId, items, notes } = body || {};
  const denied = assertDepotAccess(auth.user, sourceDepotId);
  if (denied) return denied;
  if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: 'Add at least one product to transfer.' }, { status: 400 });
  // quantities: > 0, with as many decimals as the product's unit allows (54.620 Mt)
  const dpOf = await unitDecimals();
  const prods = await prisma.product.findMany({ where: { id: { in: items.map((i: any) => String(i?.productId || '')) } }, select: { id: true, unit: true, name: true } }).catch(() => []);
  const pm = new Map(prods.map((p) => [p.id, p]));
  const lines: { productId: string; quantity: number; serialNumbers?: string[] }[] = [];
  for (let i = 0; i < items.length; i++) {
    const p = pm.get(String(items[i]?.productId));
    if (!p) return NextResponse.json({ error: `Line ${i + 1}: product not found.` }, { status: 400 });
    const q = parseQty(items[i]?.quantity, { maxDecimals: dpOf(p.unit) });
    if (q.error !== undefined) return NextResponse.json({ error: `${p.name}: ${q.error}` }, { status: 400 });
    lines.push({ productId: p.id, quantity: q.value, serialNumbers: Array.isArray(items[i]?.serialNumbers) ? items[i].serialNumbers : [] });
  }
  try {
    const transfer = await transferStock({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, { sourceDepotId, destinationDepotId, items: lines, notes: typeof notes === 'string' ? notes.slice(0, 500) : undefined });
    return NextResponse.json(transfer, { status: 201 });
  } catch (e: any) {
    if (e instanceof StockError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('Error creating transfer:', e?.message);
    return NextResponse.json({ error: 'The transfer could not be saved. Nothing was moved; please try again.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.transfer');
  if (!auth.ok) return auth.response;
  const { id, status } = (await req.json().catch(() => ({}))) || {};
  if (!id || !status) return NextResponse.json({ error: 'Transfer ID and target status are required' }, { status: 400 });
  // forward-only status changes, audited (lib/inventory/stock-ops); depot users only for their own depot's transfers
  const t = await prisma.stockTransfer.findUnique({ where: { id: String(id) }, select: { sourceDepotId: true, destinationDepotId: true } }).catch(() => null);
  if (t) {
    const denied = assertDepotAccess(auth.user, t.sourceDepotId) && assertDepotAccess(auth.user, t.destinationDepotId);
    if (denied) return denied;
  }
  try {
    return NextResponse.json(await setTransferStatus({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, String(id), String(status)));
  } catch (e: any) {
    if (e instanceof StockError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('Error updating transfer status:', e?.message);
    return NextResponse.json({ error: 'Failed to update transfer status' }, { status: 500 });
  }
}
