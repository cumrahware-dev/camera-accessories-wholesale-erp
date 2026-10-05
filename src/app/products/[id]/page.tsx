'use client';

import React, { useState, useEffect } from 'react';
import { TaxField } from '@/components/products/TaxField';
import { useParams, useRouter } from 'next/navigation';
import {
  Barcode,
  Building2,
  Boxes,
  ArrowLeftRight,
  SlidersHorizontal,
  Image as ImageIcon,
  Edit,
  ArrowLeft,
  CheckCircle2,
  Hash,
  Trash2,
} from 'lucide-react';
import { formatUSD } from '@/lib/utils';
import { Product, SerialNumber, Depot } from '@/types/erp';
import { Card } from '@/components/ui/Card';
import { Button, LinkButton } from '@/components/ui/Button';
import { MarginBadge, StatusBadge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Drawer, ConfirmDialog } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const id = params.id as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [serials, setSerials] = useState<SerialNumber[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Edit Drawer state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    brand: '',
    model: '',
    categoryName: '',
    description: '',
    purchasePrice: 0,
    wholesalePrice: 0,
    sellingPrice: 0,
    taxRate: 0,
    useDefaultTax: true,
    minStockLevel: 5,
    depotBreakdown: {} as Record<string, number>,
  });

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [prodRes, serialsRes, depotsRes] = await Promise.all([
        fetch(`/api/products/${id}`),
        fetch(`/api/inventory/serials?productId=${id}`),
        fetch('/api/depots'),
      ]);

      if (prodRes.ok) {
        const prodData = await prodRes.json();
        setProduct(prodData);
        setEditForm({
          name: prodData.name || '',
          brand: prodData.brand || '',
          model: prodData.model || '',
          categoryName: prodData.categoryName || '',
          description: prodData.description || '',
          purchasePrice: prodData.purchasePrice || 0,
          wholesalePrice: prodData.wholesalePrice || 0,
          sellingPrice: prodData.sellingPrice || 0,
          taxRate: prodData.taxRate ?? 0,
          useDefaultTax: prodData.useDefaultTax ?? true,
          minStockLevel: prodData.minStockLevel ?? 5,
          depotBreakdown: prodData.depotBreakdown || {},
        });
      } else {
        setProduct(null);
      }

      if (serialsRes.ok) {
        const sData = await serialsRes.json();
        setSerials(sData.serials || (Array.isArray(sData) ? sData : []));
      }

      if (depotsRes.ok) {
        const depData = await depotsRes.json();
        setDepots(Array.isArray(depData) ? depData : []);
      }
    } catch (err) {
      console.error('Error loading product detail:', err);
      setProduct(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          brand: editForm.brand.trim(),
          model: editForm.model.trim(),
          categoryName: editForm.categoryName.trim(),
          description: editForm.description.trim(),
          purchasePrice: Number(editForm.purchasePrice),
          wholesalePrice: Number(editForm.wholesalePrice),
          sellingPrice: Number(editForm.sellingPrice),
          useDefaultTax: editForm.useDefaultTax,
          ...(editForm.useDefaultTax ? {} : { taxRate: Number(editForm.taxRate) }),
          minStockLevel: Number(editForm.minStockLevel),
          depotBreakdown: editForm.depotBreakdown,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to update product');
      }

      const updated = await res.json();
      setProduct((prev) => (prev ? { ...prev, ...updated } : updated));
      toast({ title: 'Product updated successfully', variant: 'success' });
      setIsEditOpen(false);
      loadData();
    } catch (err: any) {
      toast({ title: 'Update failed', description: err.message, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProduct = async () => {
    if (!product) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/products/${product.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to delete product');
      }
      toast({ title: 'Product deleted', variant: 'success' });
      router.push('/products');
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err.message, variant: 'error' });
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-24 text-center space-y-4">
        <div className="text-muted text-xs font-medium animate-pulse">
          Loading product specifications and inventory telemetry...
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="py-24 text-center space-y-4">
        <div className="text-muted text-sm font-semibold">Product model not found</div>
        <LinkButton href="/products" variant="outline" size="sm">
          Back to Product Catalog
        </LinkButton>
      </div>
    );
  }

  const marginVal = product.sellingPrice - product.purchasePrice;
  const marginPct = product.sellingPrice > 0 ? Number(((marginVal / product.sellingPrice) * 100).toFixed(1)) : 0;

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-16">
      {/* Header */}
      <PageHeader
        breadcrumbs={[{ label: 'Products', href: '/products' }, { label: product.name }]}
        title={
          <span className="inline-flex items-center gap-2.5">
            {product.name}
            <span className="font-mono text-xs text-primary font-bold bg-primary-soft px-2 py-0.5 rounded border border-primary/20 align-middle">
              {product.sku}
            </span>
          </span>
        }
        description={`Brand: ${product.brand} · Category: ${product.categoryName || 'General Optics'} · Barcode: ${product.barcode || 'N/A'}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Edit className="h-4 w-4" />}
              onClick={() => setIsEditOpen(true)}
            >
              Edit Product
            </Button>
            <LinkButton
              href={`/inventory/transfers?productId=${product.id}`}
              iconLeft={<ArrowLeftRight className="h-4 w-4" />}
              size="sm"
            >
              Transfer Stock
            </LinkButton>
            <LinkButton
              href={`/inventory/adjustments?productId=${product.id}`}
              iconLeft={<SlidersHorizontal className="h-4 w-4" />}
              variant="secondary"
              size="sm"
            >
              Adjust
            </LinkButton>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted hover:text-danger hover:bg-danger-soft"
              iconLeft={<Trash2 className="h-4 w-4" />}
              onClick={() => setIsDeleteOpen(true)}
            >
              Delete
            </Button>
          </div>
        }
      />

      {/* Main Specs & Image */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 overflow-hidden h-64 flex items-center justify-center bg-surface p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/placeholder-product.svg"
            alt={product.name}
            className="h-full w-full object-contain"
            onError={(e) => {
              e.currentTarget.src = '/placeholder-product.svg';
            }}
          />
        </Card>

        <Card className="md:col-span-2 p-6 flex flex-col justify-between space-y-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
              Product Record & Technical Specifications
            </h3>
            <p className="text-xs text-ink-secondary mt-2 leading-relaxed">
              {product.description || 'No detailed specifications recorded for this SKU.'}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-lg bg-surface border border-line text-xs font-mono">
            <div>
              <span className="text-muted block text-[10px] uppercase font-sans font-semibold">Tax</span>
              <span className="text-ink font-bold" data-testid="product-tax">{(product as any).taxRate ?? 0}%</span>
              <span className="text-muted block text-[10px] font-sans">{(product as any).useDefaultTax === false ? 'Custom rate' : 'Default tax'}</span>
            </div>
            <div>
              <span className="text-muted block text-[10px] uppercase font-sans font-semibold">Cost Price</span>
              <span className="text-ink font-bold">{formatUSD(product.purchasePrice)}</span>
            </div>
            <div>
              <span className="text-muted block text-[10px] uppercase font-sans font-semibold">Wholesale Price</span>
              <span className="text-ink font-bold">{formatUSD(product.wholesalePrice)}</span>
            </div>
            <div>
              <span className="text-muted block text-[10px] uppercase font-sans font-semibold">Gross Margin</span>
              <MarginBadge marginPercent={marginPct} />
            </div>
          </div>
        </Card>
      </div>

      {/* Depot Distribution Grid */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
            Inventory Distribution Across Depots
          </h3>
          <span className="font-mono text-xs font-bold text-ink-secondary">
            Total Available: {product.totalStock ?? 0} Units
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono">
          {depots.length > 0 ? (
            depots.map((d) => {
              const qty = product.depotBreakdown?.[d.id] ?? 0;
              return (
                <div key={d.id} className="p-4 rounded-lg bg-surface border border-line text-center">
                  <span className="text-xs text-muted font-sans block truncate">{d.name}</span>
                  <div className="text-lg font-bold text-ink mt-1">
                    {qty} <span className="text-xs font-normal text-muted">Units</span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-4 rounded-lg bg-surface border border-line text-center col-span-full">
              <span className="text-xs text-muted font-sans">Total Stock</span>
              <div className="text-xl font-bold text-ink mt-1">
                {product.totalStock ?? 0} Units
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Serial Numbers Table */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink">
              Tracked Serial Numbers ({serials.length})
            </h3>
          </div>
          <LinkButton
            href={`/inventory/serials?productId=${product.id}`}
            variant="ghost"
            size="sm"
            className="text-xs text-primary"
          >
            Manage Serials
          </LinkButton>
        </div>

        {serials.length === 0 ? (
          <div className="py-8 text-center text-muted text-xs bg-surface rounded-lg border border-dashed border-line">
            No tracked serial numbers registered for this product model yet.
          </div>
        ) : (
          <>
          <div className="hidden md:block overflow-x-auto border border-line rounded-lg">
            <table className="w-full text-xs text-left">
              <thead className="bg-surface text-muted font-semibold border-b border-line">
                <tr>
                  <th className="p-2.5">Serial Number</th>
                  <th className="p-2.5">Depot</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Allocated Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft font-mono">
                {serials.map((s) => (
                  <tr key={s.id} className="hover:bg-surface">
                    <td className="p-2.5 font-bold text-ink">{s.serialNumber}</td>
                    <td className="p-2.5 text-ink-secondary">{s.depotId}</td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          s.status === 'IN_STOCK'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : s.status === 'ALLOCATED'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-surface-muted text-ink-secondary border border-line'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="p-2.5 text-muted">{s.invoiceNumber || s.invoiceId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2 font-mono">
            {serials.map((s) => (
              <div key={s.id} className="p-3 rounded-lg border border-line bg-surface text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-ink">{s.serialNumber}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      s.status === 'IN_STOCK'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : s.status === 'ALLOCATED'
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-surface-muted text-ink-secondary border border-line'
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-ink-secondary">
                  <span>Depot: {s.depotId}</span>
                  <span className="text-muted">{s.invoiceNumber || s.invoiceId || '—'}</span>
                </div>
              </div>
            ))}
          </div>
          </>
        )}
      </Card>

      {/* Edit Product Drawer */}
      <Drawer
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title={`Edit ${product.name}`}
        description="Update pricing, technical specifications, or inventory distribution."
        width="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button loading={isSaving} onClick={handleEditSubmit}>
              Save Changes
            </Button>
          </div>
        }
      >
        <form onSubmit={handleEditSubmit} className="space-y-4 text-xs">
          <Input
            label="Product Name"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            required
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Brand"
              value={editForm.brand}
              onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
              required
            />
            <Input
              label="Model"
              value={editForm.model}
              onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
            />
          </div>
          <Input
            label="Category"
            value={editForm.categoryName}
            onChange={(e) => setEditForm({ ...editForm, categoryName: e.target.value })}
          />
          <Textarea
            label="Description / Specs"
            value={editForm.description}
            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            rows={3}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Cost Price ($)"
              type="number"
              min="0"
              step="0.01"
              value={editForm.purchasePrice}
              onChange={(e) => setEditForm({ ...editForm, purchasePrice: Number(e.target.value) })}
              required
            />
            <TaxField useDefaultTax={editForm.useDefaultTax} rate={editForm.taxRate} onChange={(v) => setEditForm({ ...editForm, ...v })} />
            <Input
              label="Wholesale Price ($)"
              type="number"
              min="0"
              step="0.01"
              value={editForm.wholesalePrice}
              onChange={(e) => setEditForm({ ...editForm, wholesalePrice: Number(e.target.value) })}
              required
            />
            <Input
              label="Selling Price ($)"
              type="number"
              min="0"
              step="0.01"
              value={editForm.sellingPrice}
              onChange={(e) => setEditForm({ ...editForm, sellingPrice: Number(e.target.value) })}
              required
            />
          </div>

          <div className="border-t border-line pt-3">
            <h4 className="font-semibold text-ink-secondary mb-2">Depot Stock Allocations</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {depots.map((d) => (
                <div key={d.id}>
                  <Input
                    label={d.name}
                    type="number"
                    min="0"
                    value={editForm.depotBreakdown[d.id] ?? 0}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        depotBreakdown: {
                          ...editForm.depotBreakdown,
                          [d.id]: Math.max(0, parseInt(e.target.value) || 0),
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </form>
      </Drawer>

      <ConfirmDialog
        open={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleDeleteProduct}
        title={`Delete ${product.name}?`}
        description="This will permanently delete this product and its associated records from the catalog. This cannot be undone."
        confirmLabel="Delete Product"
        destructive
        loading={isDeleting}
      />
    </div>
  );
}
