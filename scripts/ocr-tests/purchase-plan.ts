/** Pure tests: money helpers and the invoice -> purchase mapping. npx tsx scripts/ocr-tests/purchase-plan.ts */
import { dec, lineNet, round2, sum2, within } from '@/lib/money';
import { planPurchase } from '@/lib/ocr/purchase-plan';
import { confusionVariants, skuKey } from '@/lib/ocr/sku';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, extra = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

// float traps
t('0.1 + 0.2 = 0.3', sum2([0.1, 0.2]) === 0.3);
t('1.005 rounds half-up to 1.01', round2('1.005') === 1.01);
t('120 x 2398.00 - 1200 = 286560.00', lineNet(120, 2398, 1200) === 286560);
t('large totals keep cents', sum2([286560, 83640, 69738.75]) === 439938.75);
t('1,366,824.38 survives a round trip', round2(dec('1366824.38').plus('0.00')) === 1366824.38);
t('within tolerance is exact', within(10.05, 10, 0.05) && !within(10.06, 10, 0.05));

// Mitsumi-style invoice: tax printed after the invoice discount, no per-line tax %
const doc = { discountAmount: 1200, taxAmount: 21996.94, freightAmount: 1250, otherCharges: 0, totalAmount: 463185.69,
  lineItems: [{ quantity: 120, unitPrice: 2398, discount: 0, taxRate: 0 }, { quantity: 80, unitPrice: 1045.5, discount: 0, taxRate: 0 }, { quantity: 45, unitPrice: 1549.75, discount: 0, taxRate: 0 }] };
const none = planPurchase(doc);
t('no line tax %: the missing rate is detected, not guessed', none.suggestedTaxRate === 5 && !none.reconciles, `rate ${none.suggestedTaxRate}`);
const withTax = planPurchase({ ...doc, lineItems: doc.lineItems.map((l) => ({ ...l, taxRate: 5 })) });
t('tax after invoice discount => discount spread before tax, reconciles', withTax.mode === 'DISCOUNT_BEFORE_TAX' && withTax.reconciles && withTax.grandTotal === 463185.69 && withTax.notes.length === 2, `${withTax.mode} ${withTax.grandTotal}`);
t('spread discount adds back to the printed discount exactly', sum2(withTax.lines.map((l) => l.discountAmount)) === 1200);
t('header discount is zero once spread (no double counting)', withTax.headerDiscount === 0);
// tax computed on the undiscounted lines
const asPrinted = planPurchase({ ...doc, taxAmount: 22056.94, totalAmount: 441138.75 - 1200 + 22056.94 + 1250, lineItems: doc.lineItems.map((l) => ({ ...l, taxRate: 5 })) });
t('tax on undiscounted lines => discount stays at invoice level', asPrinted.mode === 'AS_PRINTED' && asPrinted.reconciles && asPrinted.headerDiscount === 1200, asPrinted.mode);
// wrong total is reported, not forced
const wrong = planPurchase({ ...doc, totalAmount: 999, lineItems: doc.lineItems.map((l) => ({ ...l, taxRate: 5 })) });
t('a total that cannot be reproduced is flagged, never forced', !wrong.reconciles);

// the same discount printed on the line AND in the totals must not be taken twice (real result from the amount_tax layout)
const dup = planPurchase({ discountAmount: 12475, taxAmount: 589693.75, freightAmount: 0, otherCharges: 0, totalAmount: 2948468.75,
  lineItems: [{ quantity: 25, unitPrice: 69900, discount: 0, taxRate: 25 }, { quantity: 25, unitPrice: 24950, discount: 12475, taxRate: 25 }] });
t('line discount equal to the printed document discount is counted once', dup.reconciles && dup.grandTotal === 2948468.75 && dup.headerDiscount === 0, `${dup.mode} ${dup.grandTotal}`);

// SKU helpers
t('skuKey ignores case/space/hyphen/slash/dot', skuKey(' ilce-7m4 /b.') === 'ILCE7M4B');
t('skuKey keeps leading zeros', skuKey('00-123') === '00123' && skuKey('00123') !== skuKey('123'));
t('skuKey keeps meaningful punctuation', skuKey('A+B#1') === 'A+B#1');
t('O/0 and I/1/L and S/5 variants are generated', confusionVariants('AB0S1').some((v) => v.key === 'ABOS1') && confusionVariants('AB0S1').some((v) => v.key === 'AB05I'));
t('variants are capped', confusionVariants('O0O0O0O0O0O0O0O0O0O0').length <= 60);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
