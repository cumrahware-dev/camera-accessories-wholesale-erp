-- READ-ONLY review of existing purchase invoices after the VAT / inventory-cost change. Changes nothing.
-- 1) Invoices saved with no VAT on any line (the old form defaulted every line to 0%). If the supplier invoice carried VAT
--    these are the ones to review: grandTotal equals the NET amount, so the payable and (if posted) the journal omit VAT.
SELECT "purchaseNumber", "supplierName", "supplierInvoiceNumber", status, currency, subtotal, "taxAmount", "grandTotal", "invoiceDate"
FROM "PurchaseInvoice" WHERE "taxAmount" = 0 ORDER BY "invoiceDate";

-- 2) Saved header totals that disagree with their own lines (should return no rows).
SELECT p."purchaseNumber", p.status, p.subtotal, SUM(i."lineTotal") AS lines_net, p."taxAmount", SUM(i."taxAmount") AS lines_tax, p."grandTotal"
FROM "PurchaseInvoice" p JOIN "PurchaseInvoiceItem" i ON i."purchaseInvoiceId" = p.id
GROUP BY p.id HAVING ABS(p.subtotal - SUM(i."lineTotal")) > 0.05 OR ABS(p."taxAmount" - SUM(i."taxAmount")) > 0.05;

-- 3) Posted invoices: journal vs invoice. Dr Inventory should be subtotal - discount + freight + other (+ non-recoverable VAT).
SELECT p."purchaseNumber", p."grandTotal", e."totalDebit", e."totalCredit"
FROM "PurchaseInvoice" p JOIN "JournalEntry" e ON e.id = p."journalEntryId"
WHERE p.status = 'POSTED' AND ABS(e."totalCredit" - p."grandTotal") > 0.01;
