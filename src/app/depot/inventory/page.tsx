'use client';

import React, { useState, useEffect } from 'react';
import {
  Boxes,
  Search,
  AlertTriangle,
  RefreshCw,
  Building2,
  Package,
  Layers,
  CheckCircle2,
  AlertCircle,
  Filter,
} from 'lucide-react';
import { User, Product } from '@/types/erp';
import { fetchCurrentUserCached, getCurrentUserCachedSync, fetchWithCache } from '@/lib/client-cache';
import { formatUSD, cloudinaryThumb } from '@/lib/utils';

export default function DepotInventoryPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => getCurrentUserCachedSync()?.user || null);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'>('ALL');
  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    try {
      const [userData, prods] = await Promise.all([
        fetchCurrentUserCached(),
        fetchWithCache<any>('/api/products', undefined, 15000),
      ]);
      if (userData?.authenticated && userData.user) {
        setCurrentUser(userData.user);
      }
      const prodList = Array.isArray(prods) ? prods : prods?.products || [];
      setProducts(prodList);
    } catch {
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const depotId = currentUser?.assignedDepotId || '';

  const filteredProducts = products.filter((p) => {
    const depotStock = p.depotBreakdown?.[depotId] || 0;
    const isLow = depotStock > 0 && depotStock <= (p.minStockLevel || 10);
    const isOut = depotStock === 0;

    if (filterType === 'IN_STOCK' && isOut) return false;
    if (filterType === 'LOW_STOCK' && !isLow) return false;
    if (filterType === 'OUT_OF_STOCK' && !isOut) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = p.name?.toLowerCase().includes(q);
      const matchSku = p.sku?.toLowerCase().includes(q);
      const matchBrand = p.brand?.toLowerCase().includes(q);
      const matchCat = p.categoryName?.toLowerCase().includes(q);
      const matchBarcode = p.barcode?.toLowerCase().includes(q);
      return matchName || matchSku || matchBrand || matchCat || matchBarcode;
    }

    return true;
  });

  const lowStockCount = products.filter((p) => {
    const stock = p.depotBreakdown?.[depotId] || 0;
    return stock > 0 && stock <= (p.minStockLevel || 10);
  }).length;

  const outOfStockCount = products.filter((p) => {
    const stock = p.depotBreakdown?.[depotId] || 0;
    return stock === 0;
  }).length;

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Layers className="h-6 w-6 text-primary" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-ink">
              Depot Stock & Physical Inventory
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-primary-soft text-primary border border-primary/20 font-bold">
              {products.length} SKUs
            </span>
          </div>
          <p className="text-xs sm:text-sm text-ink-secondary mt-1">
            Warehouse location: <strong className="text-primary font-mono">{currentUser?.assignedDepotName || 'Depot'}</strong> • Real-time on-hand stock quantities
          </p>
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-1.5 min-h-11 sm:min-h-0 rounded-full border border-line bg-white text-ink-secondary hover:text-ink text-xs hover:bg-surface self-start sm:self-auto transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh Stock</span>
        </button>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="p-4 sm:p-5 rounded-3xl bg-white border border-line space-y-3 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Quick Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search by Product Name, SKU code, Brand, Category, or Barcode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 min-h-11 sm:min-h-0 rounded-full bg-surface border border-line text-ink placeholder-muted text-xs focus:border-primary focus:bg-white focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setFilterType('ALL')}
              className={`px-3 py-2 min-h-11 sm:min-h-0 inline-flex items-center rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                filterType === 'ALL'
                  ? 'bg-primary text-white shadow-xs'
                  : 'bg-white text-ink-secondary hover:text-ink border border-line hover:bg-surface'
              }`}
            >
              All SKUs ({products.length})
            </button>
            <button
              onClick={() => setFilterType('IN_STOCK')}
              className={`px-3 py-2 min-h-11 sm:min-h-0 inline-flex items-center rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                filterType === 'IN_STOCK'
                  ? 'bg-success text-white shadow-xs'
                  : 'bg-white text-ink-secondary hover:text-success border border-line hover:bg-surface'
              }`}
            >
              In Stock ({products.length - outOfStockCount})
            </button>
            <button
              onClick={() => setFilterType('LOW_STOCK')}
              className={`px-3 py-2 min-h-11 sm:min-h-0 inline-flex items-center rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                filterType === 'LOW_STOCK'
                  ? 'bg-warning text-white shadow-xs'
                  : 'bg-white text-ink-secondary hover:text-warning border border-line hover:bg-surface'
              }`}
            >
              Low Stock ({lowStockCount})
            </button>
            <button
              onClick={() => setFilterType('OUT_OF_STOCK')}
              className={`px-3 py-2 min-h-11 sm:min-h-0 inline-flex items-center rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                filterType === 'OUT_OF_STOCK'
                  ? 'bg-danger text-white shadow-xs'
                  : 'bg-white text-ink-secondary hover:text-danger border border-line hover:bg-surface'
              }`}
            >
              Out of Stock ({outOfStockCount})
            </button>
          </div>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-3xl border border-line overflow-hidden shadow-xs">
        <div className="p-4 sm:p-5 border-b border-line flex items-center justify-between bg-surface">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted font-mono">
            Depot Stock Matrix ({filteredProducts.length} items)
          </h2>
          <span className="text-xs text-muted font-mono">
            Threshold: &le; 10 units = Low Stock
          </span>
        </div>

        {isLoading ? (
          <div className="text-center py-16 space-y-2">
            <RefreshCw className="h-6 w-6 animate-spin text-primary mx-auto" />
            <p className="text-xs text-muted">Loading inventory...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <Boxes className="h-10 w-10 text-muted mx-auto" />
            <p className="text-sm font-semibold text-ink">No products found</p>
            <p className="text-xs text-muted max-w-sm mx-auto">
              No products match your current search query or filter.
            </p>
          </div>
        ) : (
          <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-surface border-b border-line text-[10px] font-mono uppercase text-muted">
                <tr>
                  <th className="p-4">Product / Model</th>
                  <th className="p-4">SKU / Code</th>
                  <th className="p-4">Category</th>
                  <th className="p-4 text-center">Depot Stock</th>
                  <th className="p-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-medium">
                {filteredProducts.map((product) => {
                  const stock = product.depotBreakdown?.[depotId] || 0;
                  const isOut = stock === 0;
                  const isLow = stock > 0 && stock <= (product.minStockLevel || 10);

                  return (
                    <tr key={product.id} className="hover:bg-surface transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <img
                            src="/placeholder-product.svg"
                            alt={product.name}
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '/placeholder-product.svg';
                            }}
                            className="h-10 w-10 rounded-xl object-contain p-0.5 border border-line bg-surface shrink-0"
                          />
                          <div>
                            <p className="font-semibold text-ink line-clamp-1">{product.name}</p>
                            <p className="text-[11px] text-muted font-mono mt-0.5">
                              {product.brand} {product.model ? `• ${product.model}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 font-mono font-bold text-primary whitespace-nowrap">
                        {product.sku}
                      </td>
                      <td className="p-4 text-ink-secondary whitespace-nowrap">
                        {product.categoryName || 'General Optics'}
                      </td>
                      <td className="p-4 text-center whitespace-nowrap">
                        <span className="font-mono text-base font-bold text-ink">
                          {stock}
                        </span>
                        <span className="text-muted text-[10px] block font-mono">
                          units available
                        </span>
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        {isOut ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold font-mono bg-danger-soft text-danger border border-danger-border">
                            OUT OF STOCK
                          </span>
                        ) : isLow ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold font-mono bg-warning-soft text-warning border border-warning-border">
                            LOW STOCK ({stock})
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold font-mono bg-success-soft text-success border border-success-border">
                            IN STOCK
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="md:hidden divide-y divide-line">
            {filteredProducts.map((product) => {
              const stock = product.depotBreakdown?.[depotId] || 0;
              const isOut = stock === 0;
              const isLow = stock > 0 && stock <= (product.minStockLevel || 10);

              return (
                <div key={product.id} className="p-4 flex items-center gap-3">
                  <img
                    src="/placeholder-product.svg"
                    alt={product.name}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/placeholder-product.svg';
                    }}
                    className="h-11 w-11 rounded-xl object-contain p-0.5 border border-line bg-surface shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink line-clamp-1 text-sm">{product.name}</p>
                    <p className="text-[11px] text-muted font-mono mt-0.5">
                      {product.brand} {product.model ? `• ${product.model}` : ''}
                    </p>
                    <p className="text-[11px] font-mono font-bold text-primary mt-0.5">{product.sku}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono text-base font-bold text-ink block">{stock}</span>
                    {isOut ? (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono bg-danger-soft text-danger border border-danger-border">
                        OUT
                      </span>
                    ) : isLow ? (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono bg-warning-soft text-warning border border-warning-border">
                        LOW
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono bg-success-soft text-success border border-success-border">
                        IN STOCK
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
