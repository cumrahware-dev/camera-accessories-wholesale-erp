/**
 * Measured SKU-matching test against the real database. Creates a few clearly-named temporary products (prefix ZZT-),
 * runs the matcher on realistic printed variants, then removes ONLY those products. Run:
 *   npx tsx --conditions react-server scripts/ocr-tests/sku-match.ts
 */
import { prisma } from '@/lib/prisma';
import { matchProducts } from '@/lib/ocr/matching';
import { skuKey, confusionVariants } from '@/lib/ocr/sku';

type Case = { name: string; sku: string; desc?: string; expectSku?: string; expectAuto: boolean; expectCands?: number };

async function main() {
  const cat = await prisma.category.findFirst();
  if (!cat) throw new Error('needs a category');
  const mk = (sku: string, name: string, extra: any = {}) => prisma.product.create({ data: { sku, name, brand: 'ZZT', barcode: `ZZT-BC-${sku}`, categoryId: cat.id, ...extra } });
  const made = [
    await mk('ZZT-LP-E6NH', 'Canon LP-E6NH Battery'),
    await mk('ZZT-0057-A', 'Tripod Leg Set'),
    await mk('ZZT-SO100', 'Sony SO100 Flash'),
    await mk('ZZT-DUP-1', 'Dup One A', { model: 'ZZT-MODEL-9' }),
    await mk('ZZT-DUP-2', 'Dup One B', { model: 'ZZT-MODEL-9' }),
    await mk('ZZT-AB12', 'Normal AB12'),
    await mk('ZZT-OLD-1', 'Old inactive', { status: 'INACTIVE' }),
    await mk('ZZT-PART-X', 'Part product', { model: 'MPN-77421-ZZT' }),
  ];
  const sup = await prisma.supplier.findFirst();
  try {
    const cases: Case[] = [
      { name: 'exact', sku: 'ZZT-LP-E6NH', expectSku: 'ZZT-LP-E6NH', expectAuto: true },
      { name: 'lowercase', sku: 'zzt-lp-e6nh', expectSku: 'ZZT-LP-E6NH', expectAuto: true },
      { name: 'spaces instead of hyphens', sku: 'ZZT LP E6NH', expectSku: 'ZZT-LP-E6NH', expectAuto: true },
      { name: 'hyphens dropped', sku: 'ZZTLPE6NH', expectSku: 'ZZT-LP-E6NH', expectAuto: true },
      { name: 'en-dash from OCR', sku: 'ZZT–LP–E6NH', expectSku: 'ZZT-LP-E6NH', expectAuto: true },
      { name: 'leading zeros kept (exact)', sku: 'ZZT-0057-A', expectSku: 'ZZT-0057-A', expectAuto: true },
      { name: 'leading zero dropped is NOT auto', sku: 'ZZT-57-A', expectAuto: false },
      { name: 'O read as 0 (suggest only)', sku: 'ZZT-SOI00', expectSku: 'ZZT-SO100', expectAuto: false },
      { name: 'barcode', sku: 'ZZT-BC-ZZT-SO100', expectSku: 'ZZT-SO100', expectAuto: true },
      { name: 'part number (unique)', sku: 'MPN 77421 ZZT', expectSku: 'ZZT-PART-X', expectAuto: true },
      { name: 'part number shared by 2 => ambiguous', sku: 'ZZT-MODEL-9', expectAuto: false, expectCands: 2 },
      { name: 'inactive product is not auto-accepted', sku: 'ZZT-OLD-1', expectSku: 'ZZT-OLD-1', expectAuto: false },
      { name: 'unmatched SKU, unrelated text', sku: 'QQQ-NOPE-999', desc: 'Something never sold', expectAuto: false, expectCands: 0 },
      { name: 'no SKU, exact name', sku: '', desc: 'Normal AB12', expectSku: 'ZZT-AB12', expectAuto: true },
    ];
    const res = await matchProducts(cases.map((c) => ({ sku: c.sku, description: c.desc ?? '' })), { docId: 'test' });
    let pass = 0, wrongAuto = 0;
    cases.forEach((c, i) => {
      const r = res[i], top = r.candidates[0];
      const topSku = top ? made.find((m) => m.id === top.id)?.sku ?? '(other)' : undefined;
      const okAuto = r.strong === c.expectAuto;
      const okSku = !c.expectSku || topSku === c.expectSku;
      const okN = c.expectCands === undefined || r.candidates.filter((x) => made.some((m) => m.id === x.id)).length === c.expectCands;
      const ok = okAuto && okSku && okN;
      if (r.strong && c.expectSku && topSku !== c.expectSku) wrongAuto++;
      if (ok) pass++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(42)} auto=${r.strong} top=${topSku ?? '-'} method=${r.method} (${top?.reason ?? ''})`);
    });
    // supplier-specific code mapping
    if (sup) {
      await prisma.supplierProductCode.create({ data: { supplierId: sup.id, productId: made[5].id, supplierCode: 'SUP/AB-12X', codeKey: skuKey('SUP/AB-12X'), confirmedBy: 'test' } });
      const [m] = await matchProducts([{ sku: 'sup ab 12x', description: '' }], { supplierId: sup.id, docId: 'test' });
      const [n] = await matchProducts([{ sku: 'sup ab 12x', description: '' }], { supplierId: null, docId: 'test' });
      const okMap = m.strong && m.candidates[0].id === made[5].id && !n.strong;
      console.log(`${okMap ? 'PASS' : 'FAIL'}  supplier code mapping used only for that supplier`);
      if (okMap) pass++; cases.push({ name: 'map', sku: '', expectAuto: true });
    }
    const v = confusionVariants('ZZTSOI00', 2).length;
    console.log(`variants generated for an 8-char SKU: ${v} (cap 60)`);
    console.log(`\nSKU matching: ${pass}/${cases.length} cases passed; incorrect automatic matches: ${wrongAuto}`);
    if (pass !== cases.length || wrongAuto) process.exitCode = 1;
  } finally {
    await prisma.supplierProductCode.deleteMany({ where: { productId: { in: made.map((m) => m.id) } } });
    await prisma.product.deleteMany({ where: { id: { in: made.map((m) => m.id) } } });
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
