# Decimal quantities (e.g. 54.620 Mt)

**Database** (migration `20261023090000_decimal_quantities`, additive and idempotent: no table dropped, no row deleted or re-created, whole numbers convert exactly, 12 -> 12.000):
`NUMERIC(18,3)` for `DepotInventory.quantity/allocatedQuantity/availableQuantity`, `Product.totalStock`, `Depot.totalStockUnits`, `StockTransaction.quantity`, `StockTransferItem.quantity`, `StockAdjustment.deltaQty/previousQty/newQty`, `ProformaItem.quantity`, `InvoiceItem.quantity`, `PurchaseInvoiceItem.quantity`.
New: `UnitOfMeasure` (code, name, decimals; seeded Pcs 0, Mt 3, Tonnes 3, Kg 3, Meters 2, Sq.m 2, Cu.m 3, Litres 2; add more with `POST /api/units`), `Product.unit` (default `Pcs`), and a `unit` copy on proforma / invoice / purchase lines. Money columns, `minStockLevel` and counts are unchanged.

**Rules** (`src/lib/quantity.ts`, `src/lib/units.ts`): up to 3 decimals, never more than the product's unit allows (Pcs = whole numbers), > 0; serial tracking only for whole-piece units; a product's unit cannot change once it is on a document.
**Arithmetic**: `lib/prisma.ts` returns plain numbers for NUMERIC; stock sums/differences use `addQty/subQty` (exact to 0.001); money uses decimal arithmetic (`lib/money.ts`): 54.620 x 2,950.00 = 161,129.00.
**Raw SQL**: stock deduction at dispatch casts to `numeric` (it used `::int`, which would have truncated 54.62 to 55).
**Display**: lines/PDFs print quantity with the unit's decimals and unit ("54.620 Mt"), plus "Total quantity" when all lines share one measured unit; the PDF line "Amount" is quantity x rate less line discount (tax is its own column and in the totals).
