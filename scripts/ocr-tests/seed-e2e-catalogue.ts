/** Creates (or removes with --remove) the ZZT- catalogue rows used by the HTTP end-to-end run. Dev/test databases only. */
import { prisma } from '@/lib/prisma';
async function main() {
  if (process.argv.includes('--remove')) {
    await prisma.supplierProductCode.deleteMany({ where: { product: { sku: { startsWith: 'ZZT-' } } } });
    const s = await prisma.supplier.findMany({ where: { name: { startsWith: 'ZZT ' } }, select: { id: true } });
    console.log('purchase invoices still referencing fixtures:', await prisma.purchaseInvoice.count({ where: { supplierId: { in: s.map((x) => x.id) } } }));
    return;
  }
  const cat = await prisma.category.findFirstOrThrow();
  const mk = (sku: string, name: string, extra: any = {}) => prisma.product.upsert({ where: { sku }, update: {}, create: { sku, name, brand: 'ZZT', barcode: `BC-${sku}`, categoryId: cat.id, ...extra } });
  // catalogue SKUs differ from the printed ones the way real catalogues do
  await mk('ZZT-ILCE-7M4/B', 'Sony Alpha A7 IV Body');            // printed ILCE-7M4/B  -> needs the ZZT- prefix: supplier code mapping case
  await mk('ILCE-7M4/B', 'Sony A7 IV Mirrorless (catalogue)', { barcode: 'BC-ILCE-7M4B' });
  await mk('A019 24 70 DGDN', 'Sigma 24-70 F2.8 Art');             // printed A019-24-70-DGDN -> normalized match
  await mk('ATOMNJAV2-PLU5', 'Atomos Ninja V+ Recorder');          // printed ATOMNJAV2-PLUS  -> S/5 look-alike candidate, never automatic
  await prisma.supplier.upsert({ where: { id: 'zzt-supplier' }, update: {}, create: { id: 'zzt-supplier', name: 'Mitsumi Distribution FZCO', contactPerson: 'x', email: 'zzt-mitsumi@example.com', address: 'Dubai', country: 'AE' } });
  console.log('seeded');
}
main().finally(() => prisma.$disconnect());
