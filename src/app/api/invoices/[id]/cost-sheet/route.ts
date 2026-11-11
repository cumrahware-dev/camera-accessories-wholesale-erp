import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { CostSheetError, buildCostSheet } from '@/lib/reports/cost-sales-sheet';
import { costSheetXlsx } from '@/lib/reports/cost-sales-xlsx';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Cost & Sales Sheet of one sales invoice (internal purchase cost and profit: needs the cost-visibility permission, is
 * never reachable through public invoice links). ?format=xlsx downloads the Excel file, otherwise JSON for the on-screen view.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'products.view_cost');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const inv = await prisma.taxInvoice.findUnique({ where: { id }, select: { depotId: true } });
    if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    const denied = assertDepotAccess(auth.user, inv.depotId);
    if (denied) return denied;
    const sheet = await buildCostSheet(id);
    if (req.nextUrl.searchParams.get('format') === 'xlsx') {
      const buf = await costSheetXlsx(sheet);
      await writeAudit({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, { action: 'COST_SHEET_DOWNLOADED', entityType: 'INVOICE', entityId: id, entityLabel: sheet.invoiceNumber, description: `Cost & Sales Sheet for ${sheet.invoiceNumber} downloaded` });
      return new NextResponse(new Uint8Array(buf), { headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Length': String(buf.length),
        'Content-Disposition': `attachment; filename="Cost_Sales_Sheet_${sheet.invoiceNumber.replace(/[^A-Za-z0-9_-]+/g, '_')}.xlsx"`,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    return NextResponse.json(sheet, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e: any) {
    if (e instanceof CostSheetError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[cost sheet]', e?.message);
    return NextResponse.json({ error: 'The Cost & Sales Sheet could not be generated.' }, { status: 500 });
  }
}
