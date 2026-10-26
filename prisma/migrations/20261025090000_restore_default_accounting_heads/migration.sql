-- Restores any default purchasing account that is missing (e.g. after a data restore or an import that replaced the chart of
-- accounts). Keyed on the unique account CODE: an account that exists under any id is left exactly as it is (not modified,
-- not re-activated). Additive and idempotent.
INSERT INTO "AccountingHead" ("id","code","name","type","description","isSystem","isActive","usage")
SELECT v."id", v."code", v."name", v."type"::"AccountType", v."description", true, true, v."usage"
FROM (VALUES
  ('acc-1300','1300','Inventory','ASSET','Stock on hand at purchase cost','INVENTORY'),
  ('acc-1410','1410','Input VAT Recoverable','ASSET','Tax paid on supplier invoices','INPUT_TAX'),
  ('acc-1250','1250','Supplier Claims Receivable','ASSET','Amounts suppliers owe us (e.g. support on paid invoices)','PRICE_SUPPORT_SETTLEMENT'),
  ('acc-2100','2100','Accounts Payable - Suppliers','LIABILITY','Amounts owed to suppliers','ACCOUNTS_PAYABLE,PRICE_SUPPORT_SETTLEMENT'),
  ('acc-4510','4510','Supplier Price Support Received','INCOME','Post-purchase price support / rebates from suppliers','PRICE_SUPPORT_CREDIT'),
  ('acc-5120','5120','Purchase Discounts & Rebates Received','EXPENSE','Contra purchase-cost account for supplier rebates','PRICE_SUPPORT_CREDIT')
) AS v("id","code","name","type","description","usage")
WHERE NOT EXISTS (SELECT 1 FROM "AccountingHead" h WHERE h."code" = v."code" OR h."id" = v."id");
