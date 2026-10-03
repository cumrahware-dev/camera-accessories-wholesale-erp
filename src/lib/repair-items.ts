/**
 * Older proformas were saved with placeholder item details ("Product" / "SKU" / "Brand") because the server
 * looked products up in a development-only store. When reading such records, show the real catalogue details.
 */
export function repairItemDetails<T extends { items?: any[] }>(doc: T): T {
  if (!doc || !Array.isArray(doc.items)) return doc;
  return {
    ...doc,
    items: doc.items.map((it: any) => {
      const p = it?.product;
      if (!p) return it;
      return {
        ...it,
        productName: !it.productName || it.productName === 'Product' ? p.name : it.productName,
        productSku: !it.productSku || it.productSku === 'SKU' ? p.sku : it.productSku,
        brand: !it.brand || it.brand === 'Brand' ? p.brand : it.brand,
      };
    }),
  };
}
