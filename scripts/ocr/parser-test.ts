// Run: npx tsx scripts/ocr/parser-test.ts <ocr-json>   (json from paddle_ocr.py)
import { readFileSync } from 'fs';
import { parseInvoiceFromOcr } from '../../src/lib/ocr-parser';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^[^{]*/, ''));
if (process.argv[3] === 'degrade') {
  // simulate a low-quality scan: OCR source, lower confidence, a misread digit
  for (const p of r.pages) { p.source = 'ocr'; for (const l of p.lines) { l.conf = 0.9; if (l.text.includes('Godox')) { l.conf = 0.7; l.text = l.text.replace('249.50', '249.5O').replace('2,495.00','2,495.00'); } if (l.text.startsWith('Grand')) l.text = l.text.replace('11,591.59','11,591.69'); } }
}
console.log(JSON.stringify(parseInvoiceFromOcr(r, 'x.pdf'), null, 1));
