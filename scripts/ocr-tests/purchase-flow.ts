/**
 * OCR -> draft purchase invoice -> posting, against the real database. Uses temporary ZZT- fixtures and removes them.
 *   scripts/ocr-tests/run-temp-db.sh scripts/ocr-tests/purchase-flow.ts
 */
import { prisma } from '@/lib/prisma';
import { convertDocument, previewConversion } from '@/lib/ocr/conversion';
import { postPurchaseInvoice } from '@/lib/purchasing/purchase-invoices';

const RUN = Date.now().toString(36).toUpperCase();
const user = { id: 'zzt-user', name: 'ZZT Tester', role: 'SUPER_ADMIN' };
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const expectThrow = async (name: string, fn: () => Promise<any>, match: RegExp) => {
  try { await fn(); check(name, false, 'did not throw'); } catch (e: any) { check(name, match.test(String(e.message) + JSON.stringify(e.details ?? '')), e.message); }
};

/** Runs against a throw-away copy of the database (see run-temp-db.sh): the ledger is append-only, so posted test entries cannot be deleted. */
async function cleanup() { /* the temporary database is dropped by the runner */ }

async function main() {
  await cleanup();
  const cat = await prisma.category.findFirstOrThrow();
  const depot = await prisma.depot.findFirst({ where: { status: 'ACTIVE' } }) ?? await prisma.depot.create({ data: { name: 'ZZT Depot', location: 'x', address: 'x', city: 'x', country: 'x', managerName: 'x', phone: 'x', email: 'x@x.x', code: 'ZZT' } as any });
  const supplier = await prisma.supplier.create({ data: { name: `ZZT Mitsumi Distribution FZCO ${RUN}`, contactPerson: 'x', email: `zzt-${RUN}@x.x`, address: 'x', country: 'AE' } });
  const mk = (sku: string, name: string) => prisma.product.create({ data: { sku, name, brand: 'ZZT', barcode: `BC-${sku}-${RUN}`, categoryId: cat.id, purchasePrice: 0 } });
  const p1 = await mk(`ZZT-A7M4-${RUN}`, 'Sony A7 IV Body'), p2 = await mk(`ZZT-LENS-${RUN}`, 'Sigma 24-70 Art');
  const docIds: string[] = [];
  const mkDoc = async (n: string, over: any = {}, lines?: any[]) => {
    const d = await prisma.ocrDocument.create({
      data: {
        fileName: `zzt-${n}.pdf`, fileType: 'application/pdf', fileSize: 1, fileHash: `zzt-${n}-${Date.now()}`, storageProvider: 'local', storageKey: `zzt-${n}`,
        documentType: 'PURCHASE_INVOICE' as any, detectedDocumentType: 'PURCHASE_INVOICE' as any, processingStatus: 'NEEDS_REVIEW' as any,
        documentNumber: `ZZT-INV-${n}-${Date.now()}`, documentDate: new Date('2026-03-14'), supplierName: supplier.name, matchedSupplierId: supplier.id, currency: 'USD', vatNumber: '100345678900003',
        createdById: user.id, createdByName: user.name,
        // 120 x 2,398.00 - 1,200.00 = 286,560.00 - 1,200 ... see below; values chosen to need decimal-safe sums
        subtotal: 441138.75 - 1200, discountAmount: 500, taxAmount: 0, freightAmount: 1250, otherCharges: 75.5, totalAmount: 441138.75 - 1200 - 500 + 1250 + 75.5,
        ...over,
        lineItems: { create: lines ?? [
          { position: 1, description: 'Sony Alpha A7 IV Mirrorless Camera Body', sku: 'ILCE-7M4/B', quantity: 120, unitPrice: 2398.0, discount: 1200, total: 286560 - 1200, matchedProductId: p1.id },
          { position: 2, description: 'Sigma 24-70mm F2.8 DG DN Art Lens', sku: 'A019', quantity: 80, unitPrice: 1045.5, total: 83640, matchedProductId: p2.id },
          { position: 3, description: 'Atomos Ninja', sku: 'ATOM', quantity: 45, unitPrice: 1549.75, total: 69738.75, matchedProductId: p2.id },
        ] },
      },
    });
    docIds.push(d.id);
    return d;
  };
  try {
    // ── happy path: line discount + invoice discount + freight + other charges
    const d1 = await mkDoc('1');
    const pv = await previewConversion(d1.id, 'PURCHASE_BILL');
    check('preview has no errors', pv.errors.length === 0, pv.errors.join(' | '));
    check('ERP total equals printed total (decimal-safe)', Math.abs((pv.erpTotals?.grandTotal ?? 0) - d1.totalAmount) < 0.005, `${pv.erpTotals?.grandTotal} vs ${d1.totalAmount}`);
    const stockBefore = await prisma.depotInventory.aggregate({ where: { productId: { in: [p1.id, p2.id] } }, _sum: { quantity: true } });
    const txBefore = await prisma.stockTransaction.count({ where: { productId: { in: [p1.id, p2.id] } } });
    const res = await convertDocument(d1.id, { destination: 'PURCHASE_BILL', acknowledgeDuplicates: true }, user);
    const inv = await prisma.purchaseInvoice.findFirstOrThrow({ where: { ocrDocumentId: d1.id }, include: { items: true } });
    check('draft purchase invoice created', inv.status === 'DRAFT' && res.type === 'PURCHASE_INVOICE');
    check('draft carries discount / freight / other', inv.discountAmount === 500 && inv.freightAmount === 1250 && inv.otherCharges === 75.5, `${inv.discountAmount}/${inv.freightAmount}/${inv.otherCharges}`);
    check('draft grand total matches printed total', Math.abs(inv.grandTotal - d1.totalAmount) < 0.005, String(inv.grandTotal));
    check('line discount kept', inv.items.some((i) => i.discountAmount === 1200));
    const stockAfterDraft = await prisma.depotInventory.aggregate({ where: { productId: { in: [p1.id, p2.id] } }, _sum: { quantity: true } });
    const txAfterDraft = await prisma.stockTransaction.count({ where: { productId: { in: [p1.id, p2.id] } } });
    check('NO inventory change at draft creation', (stockAfterDraft._sum.quantity ?? 0) === (stockBefore._sum.quantity ?? 0) && txAfterDraft === txBefore);
    await expectThrow('second conversion of the same document is refused', () => convertDocument(d1.id, { destination: 'PURCHASE_BILL', acknowledgeDuplicates: true }, user), /already|completed|CONVERTED/i);
    check('exactly one purchase invoice for the document', (await prisma.purchaseInvoice.count({ where: { ocrDocumentId: d1.id } })) === 1);
    await expectThrow('OCR document with an attached purchase cannot be deleted', async () => (await import('@/lib/ocr/service')).deleteDocument(d1.id, user), /attachment/);

    // ── posting through the existing purchase workflow
    const posted = await postPurchaseInvoice(inv.id, user);
    const q1 = (await prisma.depotInventory.aggregate({ where: { productId: p1.id }, _sum: { quantity: true } }))._sum.quantity ?? 0;
    const q2 = (await prisma.depotInventory.aggregate({ where: { productId: p2.id }, _sum: { quantity: true } }))._sum.quantity ?? 0;
    check('stock received only on posting', posted.status === 'POSTED' && q1 === 120 && q2 === 125, `${q1}/${q2}`);
    const j = await prisma.journalLine.findMany({ where: { journalEntryId: posted.journalEntryId! } });
    const dr = j.reduce((s, l) => s + l.debit, 0), cr = j.reduce((s, l) => s + l.credit, 0);
    check('journal balanced and equals grand total', Math.abs(dr - cr) < 0.005 && Math.abs(cr - posted.grandTotal) < 0.005, `Dr ${dr} Cr ${cr}`);
    const invDebit = j.filter((l) => l.accountingHeadId === 'acc-1300').reduce((s, l) => s + l.debit, 0);
    check('inventory debit = lines - discount + freight + other (landed cost)', Math.abs(invDebit - (441138.75 - 1200 - 500 + 1250 + 75.5)) < 0.005, String(invDebit));
    const st = await prisma.stockTransaction.findMany({ where: { referenceNumber: posted.purchaseNumber } });
    check('one stock-in row per line, no duplicates', st.length === 3 && st.every((t) => t.type === 'STOCK_IN'));
    await expectThrow('posting twice is refused', () => postPurchaseInvoice(inv.id, user), /already posted/i);
    check('stock unchanged by the refused second posting', ((await prisma.depotInventory.aggregate({ where: { productId: p1.id }, _sum: { quantity: true } }))._sum.quantity ?? 0) === 120);

    // ── validation must block, with a clear message
    const d2 = await mkDoc('2', {}, [{ position: 1, description: 'Fractional qty', sku: 'X', quantity: 2.5, unitPrice: 10, total: 25, matchedProductId: p1.id }]);
    const v2 = await previewConversion(d2.id, 'PURCHASE_BILL');
    check('fractional quantity is blocked (not rounded)', v2.errors.some((e) => /whole number/.test(e)), v2.errors[0]);
    const d3 = await mkDoc('3', { totalAmount: 999999.99 });
    const v3 = await previewConversion(d3.id, 'PURCHASE_BILL');
    check('wrong grand total is blocked with the difference shown', v3.errors.some((e) => /do not add up/.test(e) && /difference/.test(e)), v3.errors[0]);
    check('discrepancies are reported structurally', (v3 as any).discrepancies?.length > 0);
    const d4 = await mkDoc('4', {}, [{ position: 1, description: 'Bad line', sku: 'X', quantity: 10, unitPrice: 10, total: 120, matchedProductId: p1.id }]);
    const v4 = await previewConversion(d4.id, 'PURCHASE_BILL');
    check('line total that is not qty x price is flagged', (v4 as any).discrepancies?.some((x: any) => x.scope === 'line'), JSON.stringify((v4 as any).discrepancies?.[0]?.message));
    const d5 = await mkDoc('5', {}, [{ position: 1, description: 'Unmatched', sku: 'NOPE', quantity: 1, unitPrice: 100, total: 100, matchedProductId: null }]);
    const v5 = await previewConversion(d5.id, 'PURCHASE_BILL');
    check('unmatched product blocks conversion', v5.errors.some((e) => /product not found/.test(e)));
    const d6 = await mkDoc('6', { matchedSupplierId: null });
    check('missing supplier blocks conversion', (await previewConversion(d6.id, 'PURCHASE_BILL')).errors.some((e) => /Supplier is required/.test(e)));
    // duplicate supplier invoice number
    const d7 = await mkDoc('7', { documentNumber: inv.supplierInvoiceNumber });
    await expectThrow('duplicate supplier invoice number is refused', () => convertDocument(d7.id, { destination: 'PURCHASE_BILL', acknowledgeDuplicates: true }, user), /already recorded/);
    check('failed conversion leaves the document retryable', (await prisma.ocrDocument.findUniqueOrThrow({ where: { id: d7.id } })).conversionStatus === 'FAILED');
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  console.log(`\npurchase flow: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
