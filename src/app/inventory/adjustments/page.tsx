import { useUnits } from '@/lib/hooks/useUnits';
import { addQty, subQty, parseQty, formatQty } from '@/lib/quantity';
'use client';

import React, { useState, useEffect } from 'react';
import { SlidersHorizontal, Plus, CheckCircle2 } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { StockAdjustment, Product, Depot } from '@/types/erp';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { SearchInput, Input, Select, Textarea } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

const REASON_OPTIONS = [
  { label: 'Cycle Count', value: 'CYCLE_COUNT' },
  { label: 'Damaged', value: 'DAMAGED' },
  { label: 'Found', value: 'FOUND' },
  { label: 'Defective', value: 'DEFECTIVE' },
  { label: 'Other', value: 'OTHER' },
];

export default function StockAdjustmentsPage() {
  const { toast } = useToast();
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [reasonFilter, setReasonFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [productId, setProductId] = useState('');
  const [depotId, setDepotId] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'ADD' | 'REMOVE'>('REMOVE');
  const [quantityText, setQuantityText] = useState<string>('1');
  const { decimalsFor, fmt } = useUnits();
  const [reason, setReason] = useState('CYCLE_COUNT');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async () => {
    try {
      const [adjRes, prodRes, depRes] = await Promise.all([
        fetch('/api/inventory/adjustments'),
        fetch('/api/products'),
        fetch('/api/depots'),
      ]);
      if (adjRes.ok) {
        const data = await adjRes.json();
        setAdjustments(Array.isArray(data) ? data : []);
      }
      if (prodRes.ok) {
        const prods = await prodRes.json();
        setProducts(Array.isArray(prods) ? prods : []);
        if (prods.length > 0) setProductId((prev) => prev || prods[0].id);
      }
      if (depRes.ok) {
        const deps = await depRes.json();
        setDepots(Array.isArray(deps) ? deps : []);
        if (deps.length > 0) setDepotId((prev) => prev || deps[0].id);
      }
    } catch {
      toast({ title: 'Unable to load stock adjustments', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedProduct = products.find((p) => p.id === productId);
  const selectedDepotObj = depots.find((d) => d.id === depotId);
  const currentDepotStock = selectedProduct?.depotBreakdown?.[depotId] ?? 0;
  const selectedUnit = products.find((p) => p.id === productId)?.unit;
  const parsedQty = parseQty(quantityText, { maxDecimals: decimalsFor(selectedUnit) });
  const quantity = parsedQty.value ?? 0;
  const deltaQty = adjustmentType === 'ADD' ? Math.abs(quantity) : -Math.abs(quantity);
  const projectedNewQty = Math.max(0, addQty(currentDepotStock, deltaQty));

  const handleCreateAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!productId || !depotId || parsedQty.error !== undefined) {
      setFormError(parsedQty.error !== undefined && productId && depotId ? parsedQty.error : 'Select a product and depot, and enter a valid quantity.');
      return;
    }
    if (adjustmentType === 'REMOVE' && subQty(currentDepotStock, quantity) < 0) {
      setFormError(
        `Cannot deduct ${fmt(quantity, selectedUnit)} — ${selectedDepotObj?.name || 'this depot'} only has ${fmt(currentDepotStock, selectedUnit)}.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/inventory/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, depotId, deltaQty, reason, notes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Stock adjustment failed.');
      }
      toast({ title: 'Stock adjusted', variant: 'success' });
      setIsDrawerOpen(false);
      setQuantityText('1');
      setNotes('');
      await loadData();
    } catch (err: any) {
      setFormError(err.message || 'Stock adjustment failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filtered = adjustments.filter((adj) => {
    if (reasonFilter !== 'ALL' && adj.reason !== reasonFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        (adj.productSku || '').toLowerCase().includes(q) ||
        (adj.productName || '').toLowerCase().includes(q) ||
        (adj.depotName || '').toLowerCase().includes(q) ||
        (adj.user || '').toLowerCase().includes(q) ||
        (adj.notes || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const canAdjust = products.length > 0 && depots.length > 0;

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Stock Adjustments' }]}
        title="Stock Adjustments"
        description="Correct stock levels from cycle counts, damage, or recovered units."
        actions={
          canAdjust && (
            <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setIsDrawerOpen(true)}>
              New Adjustment
            </Button>
          )
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <SearchInput
          placeholder="Search product, SKU, depot, or user..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          wrapperClassName="w-full sm:w-80"
        />
        <Select
          options={[{ label: 'All reasons', value: 'ALL' }, ...REASON_OPTIONS]}
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          wrapperClassName="w-44"
        />
        <span className="text-xs text-muted sm:ml-auto">{filtered.length} adjustments</span>
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title={adjustments.length === 0 ? 'No stock adjustments yet' : 'No matching adjustments'}
          description={
            adjustments.length === 0
              ? canAdjust
                ? 'Record an adjustment when a cycle count, damage, or recovery changes physical stock.'
                : 'Add products and stock first — adjustments correct existing inventory levels.'
              : 'No adjustments match your search or filter.'
          }
          action={
            adjustments.length === 0 &&
            canAdjust && (
              <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setIsDrawerOpen(true)}>
                New Adjustment
              </Button>
            )
          }
        />
      ) : (
        <>
        <Card className="hidden md:block overflow-hidden p-0 border-0 rounded-none bg-transparent">
          <Table>
            <TableHeader>
              <TableHead>Product</TableHead>
              <TableHead>Depot</TableHead>
              <TableHead align="right">Change</TableHead>
              <TableHead align="right">New Qty</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>By</TableHead>
              <TableHead>When</TableHead>
            </TableHeader>
            <TableBody>
              {filtered.map((adj) => (
                <TableRow key={adj.id}>
                  <TableCell>
                    <div className="font-semibold text-ink">{adj.productName}</div>
                    <div className="text-xs text-muted font-mono mt-0.5">{adj.productSku}</div>
                  </TableCell>
                  <TableCell className="text-muted">{adj.depotName}</TableCell>
                  <TableCell align="right">
                    <span
                      className={`font-mono font-semibold ${adj.deltaQty >= 0 ? 'text-success' : 'text-danger'}`}
                    >
                      {adj.deltaQty >= 0 ? '+' : ''}
                      {formatQty(adj.deltaQty)}
                    </span>
                  </TableCell>
                  <TableCell align="right" className="font-mono">{formatQty(adj.newQty)}</TableCell>
                  <TableCell>
                    <Badge tone={adj.reason === 'DAMAGED' || adj.reason === 'DEFECTIVE' ? 'danger' : 'neutral'}>
                      {(adj.reason || '').replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted">{adj.user}</TableCell>
                  <TableCell className="text-muted whitespace-nowrap">{formatDateTime(adj.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="md:hidden space-y-3">
          {filtered.map((adj) => (
            <Card key={adj.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-ink truncate">{adj.productName}</div>
                  <div className="text-xs text-muted font-mono mt-0.5">{adj.productSku}</div>
                </div>
                <span
                  className={`font-mono font-semibold text-sm shrink-0 ${adj.deltaQty >= 0 ? 'text-success' : 'text-danger'}`}
                >
                  {adj.deltaQty >= 0 ? '+' : ''}
                  {formatQty(adj.deltaQty)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">{adj.depotName}</span>
                <Badge tone={adj.reason === 'DAMAGED' || adj.reason === 'DEFECTIVE' ? 'danger' : 'neutral'}>
                  {(adj.reason || '').replace(/_/g, ' ')}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs pt-1.5 border-t border-line-soft text-muted">
                <span>New Qty: <span className="font-mono text-ink-secondary">{formatQty(adj.newQty)}</span></span>
                <span>{adj.user}</span>
              </div>
              <div className="text-[11px] text-muted">{formatDateTime(adj.createdAt)}</div>
            </Card>
          ))}
        </div>
        </>
      )}

      <Drawer
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="New Stock Adjustment"
        description="Correct the recorded stock level for a product at a depot."
        footer={
          <>
            <Button variant="outline" onClick={() => setIsDrawerOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="adjustment-form" loading={isSubmitting} iconLeft={!isSubmitting ? <CheckCircle2 className="h-4 w-4" /> : undefined}>
              Apply Adjustment
            </Button>
          </>
        }
      >
        <form id="adjustment-form" onSubmit={handleCreateAdjustment} className="flex flex-col gap-4">
          {formError && (
            <div className="rounded-lg border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger">
              {formError}
            </div>
          )}

          <Select
            label="Product"
            options={products.map((p) => ({ label: `${p.name} (${p.sku})`, value: p.id }))}
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          />
          <Select
            label="Depot"
            options={depots.map((d) => ({ label: d.name, value: d.id }))}
            value={depotId}
            onChange={(e) => setDepotId(e.target.value)}
          />
          <Select
            label="Adjustment Type"
            options={[
              { label: 'Remove stock', value: 'REMOVE' },
              { label: 'Add stock', value: 'ADD' },
            ]}
            value={adjustmentType}
            onChange={(e) => setAdjustmentType(e.target.value as 'ADD' | 'REMOVE')}
          />
          <Input
            label="Quantity"
            type="text"
            inputMode="decimal"
            value={quantityText}
            onChange={(e) => setQuantityText(e.target.value.replace(/,/g, ''))}
            hint={selectedUnit && selectedUnit !== 'Pcs' ? `Unit: ${selectedUnit} (up to ${decimalsFor(selectedUnit)} decimals)` : undefined}
          />

          <div className="rounded-lg border border-line bg-surface-muted px-3.5 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Current stock</span>
              <span className="font-mono font-semibold text-ink">{fmt(currentDepotStock, selectedUnit, false)}</span>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-muted">After adjustment</span>
              <span className="font-mono font-semibold text-ink">{fmt(projectedNewQty, selectedUnit, false)}</span>
            </div>
          </div>

          <Select
            label="Reason"
            options={REASON_OPTIONS}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </form>
      </Drawer>
    </div>
  );
}
