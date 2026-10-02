'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Boxes, AlertTriangle, Download } from 'lucide-react';
import { formatUSD } from '@/lib/utils';
import { Product, Depot } from '@/types/erp';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select, Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { downloadReportPdf } from '@/lib/report-pdf';
import { SkeletonTable } from '@/components/ui/Skeleton';

export default function InventoryReportsPage() {
  const { toast } = useToast();
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotId, setDepotId] = useState('ALL');
  const [brand, setBrand] = useState('ALL');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadData = async () => {
    try {
      const [res, dres] = await Promise.all([fetch('/api/products'), fetch('/api/depots')]);
      const data = res.ok ? await res.json() : [];
      const dep = dres.ok ? await dres.json() : [];
      setAllProducts(Array.isArray(data) ? data : []);
      setDepots(Array.isArray(dep) ? dep : []);
    } catch {
      setAllProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const brands = Array.from(new Set(allProducts.map((p) => p.brand).filter(Boolean))).sort();
  // With a depot selected, "stock" means the quantity held in that depot.
  const products = allProducts
    .filter((p) => brand === 'ALL' || p.brand === brand)
    .filter((p) => {
      const q = query.trim().toLowerCase();
      return !q || `${p.name} ${p.sku} ${p.brand}`.toLowerCase().includes(q);
    })
    .map((p) => (depotId === 'ALL' ? p : { ...p, totalStock: p.depotBreakdown?.[depotId] ?? 0 }));

  const lowStock = products.filter((p) => (p.totalStock || 0) <= (p.minStockLevel ?? 0));
  const outOfStock = products.filter((p) => (p.totalStock || 0) === 0);
  // "Overstocked" = holding more than 5x the minimum level, i.e. capital tied up
  // beyond what the reorder threshold implies. Computed from real stock data.
  const overstocked = products.filter(
    (p) => (p.minStockLevel ?? 0) > 0 && (p.totalStock || 0) > (p.minStockLevel ?? 0) * 5
  );

  const totalValue = products.reduce((sum, p) => sum + (p.totalStock || 0) * (p.purchasePrice || 0), 0);
  const retailValue = products.reduce((sum, p) => sum + (p.totalStock || 0) * (p.wholesalePrice || p.sellingPrice || 0), 0);
  const totalUnits = products.reduce((sum, p) => sum + (p.totalStock || 0), 0);
  const byBrand = Object.values(
    products.reduce<Record<string, { brand: string; skus: number; units: number; cost: number; retail: number }>>((acc, p) => {
      const k = p.brand || 'Unbranded';
      (acc[k] ||= { brand: k, skus: 0, units: 0, cost: 0, retail: 0 });
      acc[k].skus += 1;
      acc[k].units += p.totalStock || 0;
      acc[k].cost += (p.totalStock || 0) * (p.purchasePrice || 0);
      acc[k].retail += (p.totalStock || 0) * (p.wholesalePrice || p.sellingPrice || 0);
      return acc;
    }, {})
  ).sort((a, b) => b.cost - a.cost);
  const depotLabel = depotId === 'ALL' ? 'All depots' : depots.find((d) => d.id === depotId)?.name || depotId;
  const statusOf = (p: Product) => ((p.totalStock || 0) === 0 ? 'Out of stock' : (p.totalStock || 0) <= (p.minStockLevel ?? 0) ? 'Low' : 'OK');

  const exportPdf = async () => {
    setExporting(true);
    try {
      const stockRow = (p: Product) => [p.sku, p.name, p.brand, p.totalStock ?? 0, p.minStockLevel ?? 0, formatUSD(p.purchasePrice), formatUSD((p.totalStock || 0) * (p.purchasePrice || 0))];
      await downloadReportPdf({
        title: 'Inventory Report',
        subtitle: 'Stock valuation at purchase cost, reorder alerts and capital tied up in slow-moving stock.',
        filters: [`Depot: ${depotLabel}`, `Brand: ${brand === 'ALL' ? 'All brands' : brand}`, ...(query ? [`Search: "${query}"`] : [])],
        kpis: [
          { label: 'Stock value (cost)', value: formatUSD(totalValue) },
          { label: 'Stock value (wholesale)', value: formatUSD(retailValue) },
          { label: 'Units on hand', value: String(totalUnits) },
          { label: 'Tracked SKUs', value: String(products.length) },
          { label: 'Low stock', value: String(lowStock.length) },
          { label: 'Out of stock', value: String(outOfStock.length) },
        ],
        sections: [
          { title: 'Valuation by brand', head: ['Brand', 'SKUs', 'Units', 'Cost value', 'Wholesale value'], rows: byBrand.map((b) => [b.brand, b.skus, b.units, formatUSD(b.cost), formatUSD(b.retail)]), right: [1, 2, 3, 4], foot: ['Total', products.length, totalUnits, formatUSD(totalValue), formatUSD(retailValue)] },
          { title: 'Reorder alerts', note: 'On hand at or below the minimum level.', head: ['SKU', 'Product', 'Brand', 'On hand', 'Minimum', 'Unit cost', 'Value'], rows: lowStock.map(stockRow), right: [3, 4, 5, 6] },
          { title: 'Overstocked', note: 'More than 5× the minimum level.', head: ['SKU', 'Product', 'Brand', 'On hand', 'Minimum', 'Unit cost', 'Capital held'], rows: overstocked.map(stockRow), right: [3, 4, 5, 6] },
          { title: 'Full stock list', head: ['SKU', 'Product', 'Brand', 'On hand', 'Minimum', 'Unit cost', 'Value', 'Status'], rows: [...products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => [...stockRow(p), statusOf(p)]), right: [3, 4, 5, 6], foot: ['Total', '', '', totalUnits, '', '', formatUSD(totalValue), ''] },
        ],
        landscape: true,
        filename: `inventory-report-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
    } catch (e) {
      console.error('PDF export failed', e);
      toast({ title: 'Could not create the PDF', description: 'Please try again.', variant: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Inventory Reports"
        description="Stock valuation, reorder alerts, and capital tied up in slow-moving stock."
        actions={
          <Button iconLeft={<Download className="h-4 w-4" />} onClick={exportPdf} loading={exporting} disabled={loading || products.length === 0}>
            Download PDF
          </Button>
        }
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Depot" options={[{ label: 'All depots', value: 'ALL' }, ...depots.map((d) => ({ label: d.name, value: d.id }))]} value={depotId} onChange={(e) => setDepotId(e.target.value)} />
          <Select label="Brand" options={[{ label: 'All brands', value: 'ALL' }, ...brands.map((b) => ({ label: b, value: b }))]} value={brand} onChange={(e) => setBrand(e.target.value)} />
          <Input id="inv-search" label="Search" placeholder="Name, SKU or brand" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 border border-line rounded-2xl divide-x divide-y xl:divide-y-0 divide-line bg-surface overflow-hidden">
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Stock Value</div>
          <div className="text-xl sm:text-2xl font-semibold text-ink mt-1.5 break-words">{formatUSD(totalValue)}</div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Wholesale Value</div>
          <div className="text-2xl font-semibold text-ink mt-1.5 break-words">{formatUSD(retailValue)}</div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Units On Hand</div>
          <div className="text-2xl font-semibold text-ink mt-1.5">{totalUnits}</div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Tracked SKUs</div>
          <div className="text-2xl font-semibold text-ink mt-1.5">{products.length}</div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Low Stock</div>
          <div className={`text-2xl font-semibold mt-1.5 ${lowStock.length > 0 ? 'text-warning' : 'text-ink'}`}>
            {lowStock.length}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Out of Stock</div>
          <div className={`text-2xl font-semibold mt-1.5 ${outOfStock.length > 0 ? 'text-danger' : 'text-ink'}`}>
            {outOfStock.length}
          </div>
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : products.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={allProducts.length === 0 ? "No inventory to report on" : "No products match these filters"}
          description="Add products and record stock to see valuation and reorder analysis here."
          action={<Link href="/products" className="text-sm font-medium text-primary hover:underline">Go to Product Catalog</Link>}
        />
      ) : (
        <>
          <section>
            <h2 className="text-xl font-semibold tracking-tight text-ink mb-3">Valuation by Brand</h2>
            <Table>
              <TableHeader>
                <TableHead>Brand</TableHead>
                <TableHead align="right">SKUs</TableHead>
                <TableHead align="right">Units</TableHead>
                <TableHead align="right">Cost Value</TableHead>
                <TableHead align="right">Wholesale Value</TableHead>
              </TableHeader>
              <TableBody>
                {byBrand.map((b) => (
                  <TableRow key={b.brand}>
                    <TableCell className="font-semibold">{b.brand}</TableCell>
                    <TableCell align="right" className="font-mono text-muted">{b.skus}</TableCell>
                    <TableCell align="right" className="font-mono">{b.units}</TableCell>
                    <TableCell align="right" className="font-mono font-semibold">{formatUSD(b.cost)}</TableCell>
                    <TableCell align="right" className="font-mono text-muted">{formatUSD(b.retail)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <h2 className="text-xl font-semibold tracking-tight text-ink">Reorder Alerts</h2>
            </div>
            {lowStock.length === 0 ? (
              <Card className="p-5">
                <p className="text-sm text-muted">
                  Every product is above its minimum stock level. Nothing needs reordering right now.
                </p>
              </Card>
            ) : (
              <>
              <Card className="hidden md:block overflow-hidden p-0 border-0 rounded-none bg-transparent">
                <Table>
                  <TableHeader>
                    <TableHead>Product</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead align="right">On Hand</TableHead>
                    <TableHead align="right">Minimum</TableHead>
                    <TableHead align="right">Status</TableHead>
                  </TableHeader>
                  <TableBody>
                    {lowStock.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Link href={`/products/${p.id}`} className="font-semibold text-ink hover:underline">
                            {p.name}
                          </Link>
                          <div className="text-xs text-muted font-mono mt-0.5">{p.sku}</div>
                        </TableCell>
                        <TableCell className="text-muted">{p.brand}</TableCell>
                        <TableCell align="right" className="font-mono font-semibold">{p.totalStock ?? 0}</TableCell>
                        <TableCell align="right" className="font-mono text-muted">{p.minStockLevel ?? 0}</TableCell>
                        <TableCell align="right">
                          <Badge tone={(p.totalStock || 0) === 0 ? 'danger' : 'warning'}>
                            {(p.totalStock || 0) === 0 ? 'Out of stock' : 'Reorder'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              <div className="md:hidden space-y-3">
                {lowStock.map((p) => (
                  <Card key={p.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/products/${p.id}`} className="font-semibold text-ink hover:underline text-sm">
                          {p.name}
                        </Link>
                        <div className="text-xs text-muted font-mono mt-0.5">{p.sku} · {p.brand}</div>
                      </div>
                      <Badge tone={(p.totalStock || 0) === 0 ? 'danger' : 'warning'} className="shrink-0">
                        {(p.totalStock || 0) === 0 ? 'Out of stock' : 'Reorder'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-line-soft">
                      <span className="text-muted">On Hand: <span className="font-mono font-semibold text-ink">{p.totalStock ?? 0}</span></span>
                      <span className="text-muted">Minimum: <span className="font-mono text-ink-secondary">{p.minStockLevel ?? 0}</span></span>
                    </div>
                  </Card>
                ))}
              </div>
              </>
            )}
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight text-ink mb-1">Overstocked</h2>
            <p className="text-sm text-muted mb-3">
              Holding more than 5&times; the reorder threshold — capital that may be better deployed elsewhere.
            </p>
            {overstocked.length === 0 ? (
              <Card className="p-5">
                <p className="text-sm text-muted">No products are significantly overstocked.</p>
              </Card>
            ) : (
              <>
              <Card className="hidden md:block overflow-hidden p-0 border-0 rounded-none bg-transparent">
                <Table>
                  <TableHeader>
                    <TableHead>Product</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead align="right">On Hand</TableHead>
                    <TableHead align="right">Minimum</TableHead>
                    <TableHead align="right">Capital Held</TableHead>
                  </TableHeader>
                  <TableBody>
                    {overstocked.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Link href={`/products/${p.id}`} className="font-semibold text-ink hover:underline">
                            {p.name}
                          </Link>
                          <div className="text-xs text-muted font-mono mt-0.5">{p.sku}</div>
                        </TableCell>
                        <TableCell className="text-muted">{p.brand}</TableCell>
                        <TableCell align="right" className="font-mono font-semibold">{p.totalStock ?? 0}</TableCell>
                        <TableCell align="right" className="font-mono text-muted">{p.minStockLevel ?? 0}</TableCell>
                        <TableCell align="right" className="font-mono">
                          {formatUSD((p.totalStock || 0) * (p.purchasePrice || 0))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              <div className="md:hidden space-y-3">
                {overstocked.map((p) => (
                  <Card key={p.id} className="p-4 space-y-2">
                    <Link href={`/products/${p.id}`} className="font-semibold text-ink hover:underline text-sm">
                      {p.name}
                    </Link>
                    <div className="text-xs text-muted font-mono">{p.sku} · {p.brand}</div>
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-line-soft">
                      <span className="text-muted">On Hand: <span className="font-mono font-semibold text-ink">{p.totalStock ?? 0}</span></span>
                      <span className="text-muted">Min: <span className="font-mono text-ink-secondary">{p.minStockLevel ?? 0}</span></span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">Capital Held</span>
                      <span className="font-mono font-semibold text-ink">
                        {formatUSD((p.totalStock || 0) * (p.purchasePrice || 0))}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
