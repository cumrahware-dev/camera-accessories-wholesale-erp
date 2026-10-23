'use client';
import { useUnits } from '@/lib/hooks/useUnits';
import { parseQty } from '@/lib/quantity';

import React, { useState, useEffect } from 'react';
import { ArrowLeftRight, ArrowRight, Plus, CheckCircle2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { StockTransfer, Product, Depot } from '@/types/erp';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

export default function TransfersPage() {
  const { toast } = useToast();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [sourceDepotId, setSourceDepotId] = useState('');
  const [destDepotId, setDestDepotId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantityText, setQuantityText] = useState('1');
  const { decimalsFor } = useUnits();
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [transRes, prodsRes, depsRes] = await Promise.all([
        fetch('/api/inventory/transfers'),
        fetch('/api/products'),
        fetch('/api/depots'),
      ]);

      const transData = transRes.ok ? await transRes.json() : [];
      const prodsData = prodsRes.ok ? await prodsRes.json() : [];
      const depsData = depsRes.ok ? await depsRes.json() : [];

      setTransfers(Array.isArray(transData) ? transData : []);
      setProducts(Array.isArray(prodsData) ? prodsData : []);
      setDepots(Array.isArray(depsData) ? depsData : []);

      if (depsData.length >= 2) {
        setSourceDepotId(depsData[0].id);
        setDestDepotId(depsData[1].id);
      }
      if (prodsData.length > 0) setProductId(prodsData[0].id);
    } catch {
      toast({ title: 'Unable to load transfers', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Transfers move stock between depots — impossible with a single depot.
  const canTransfer = depots.length >= 2;

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (sourceDepotId === destDepotId) {
      setFormError('Source and destination depots must be different.');
      return;
    }
    if (!productId) {
      setFormError('Select a product to transfer.');
      return;
    }
    const pq = parseQty(quantityText, { maxDecimals: decimalsFor(products.find((p) => p.id === productId)?.unit) });
    if (pq.error !== undefined) {
      setFormError(pq.error);
      return;
    }
    const quantity = pq.value;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/inventory/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceDepotId,
          destinationDepotId: destDepotId,
          items: [{ productId, quantity }],
          notes,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Transfer failed');
      }
      toast({ title: 'Transfer created', variant: 'success' });
      setIsDrawerOpen(false);
      setNotes('');
      setQuantityText('1');
      await loadData();
    } catch (err: any) {
      setFormError(err.message || 'Transfer failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (id: string, status: 'IN_TRANSIT' | 'COMPLETED') => {
    setUpdatingId(id);
    try {
      const res = await fetch('/api/inventory/transfers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error('Failed to update transfer');
      toast({ title: `Transfer marked ${status.replace('_', ' ').toLowerCase()}`, variant: 'success' });
      await loadData();
    } catch (err: any) {
      toast({ title: 'Update failed', description: err.message, variant: 'error' });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Stock Transfers' }]}
        title="Stock Transfers"
        description="Move stock between depots and track transfers in flight."
        actions={
          canTransfer && (
            <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setIsDrawerOpen(true)}>
              New Transfer
            </Button>
          )
        }
      />

      {!canTransfer && !loading && (
        <div className="rounded-2xl border border-info-border bg-info-soft px-4 py-3 text-sm text-info">
          Stock transfers move inventory between depots. You currently operate a single depot
          {depots[0] ? ` (${depots[0].name})` : ''}, so there is nowhere to transfer to. Add a second depot to
          enable transfers.
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={5} cols={6} />
      ) : transfers.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No stock transfers yet"
          description={
            canTransfer
              ? 'Create a transfer to move stock from one depot to another.'
              : 'Transfers will appear here once you operate more than one depot.'
          }
          action={
            canTransfer && (
              <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setIsDrawerOpen(true)}>
                New Transfer
              </Button>
            )
          }
        />
      ) : (
        <>
        <Card className="hidden md:block overflow-hidden p-0 border-0 rounded-none bg-transparent">
          <Table>
            <TableHeader>
              <TableHead>Transfer</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead align="right">Items</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="right">Action</TableHead>
            </TableHeader>
            <TableBody>
              {transfers.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono font-semibold text-ink">{t.transferNumber}</TableCell>
                  <TableCell className="text-muted">{t.sourceDepotName}</TableCell>
                  <TableCell className="text-muted">{t.destinationDepotName}</TableCell>
                  <TableCell align="right" className="font-mono">{t.items?.length ?? 0}</TableCell>
                  <TableCell className="text-muted">{formatDate(t.createdAt)}</TableCell>
                  <TableCell>
                    <StatusBadge status={t.status} />
                  </TableCell>
                  <TableCell align="right">
                    {t.status === 'PENDING' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={updatingId === t.id}
                        onClick={() => handleUpdateStatus(t.id, 'IN_TRANSIT')}
                      >
                        Mark In Transit
                      </Button>
                    )}
                    {t.status === 'IN_TRANSIT' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={updatingId === t.id}
                        onClick={() => handleUpdateStatus(t.id, 'COMPLETED')}
                      >
                        Mark Received
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="md:hidden space-y-3">
          {transfers.map((t: any) => (
            <Card key={t.id} className="p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono font-semibold text-ink text-sm">{t.transferNumber}</span>
                <StatusBadge status={t.status} />
              </div>
              <div className="flex items-center gap-2 text-xs text-ink-secondary">
                <span className="truncate">{t.sourceDepotName}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted shrink-0" />
                <span className="truncate">{t.destinationDepotName}</span>
              </div>
              <div className="flex items-center justify-between text-xs pt-1.5 border-t border-line-soft">
                <span className="text-muted">{t.items?.length ?? 0} items · {formatDate(t.createdAt)}</span>
              </div>
              {(t.status === 'PENDING' || t.status === 'IN_TRANSIT') && (
                <div className="pt-1">
                  {t.status === 'PENDING' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      loading={updatingId === t.id}
                      onClick={() => handleUpdateStatus(t.id, 'IN_TRANSIT')}
                    >
                      Mark In Transit
                    </Button>
                  )}
                  {t.status === 'IN_TRANSIT' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      loading={updatingId === t.id}
                      onClick={() => handleUpdateStatus(t.id, 'COMPLETED')}
                    >
                      Mark Received
                    </Button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
        </>
      )}

      <Drawer
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="New Stock Transfer"
        description="Move stock from one depot to another."
        footer={
          <>
            <Button variant="outline" onClick={() => setIsDrawerOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="transfer-form" loading={isSubmitting} iconLeft={!isSubmitting ? <CheckCircle2 className="h-4 w-4" /> : undefined}>
              Create Transfer
            </Button>
          </>
        }
      >
        <form id="transfer-form" onSubmit={handleCreateTransfer} className="flex flex-col gap-4">
          {formError && (
            <div className="rounded-lg border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger">
              {formError}
            </div>
          )}
          <Select
            label="From Depot"
            options={depots.map((d) => ({ label: d.name, value: d.id }))}
            value={sourceDepotId}
            onChange={(e) => setSourceDepotId(e.target.value)}
          />
          <Select
            label="To Depot"
            options={depots.map((d) => ({ label: d.name, value: d.id }))}
            value={destDepotId}
            onChange={(e) => setDestDepotId(e.target.value)}
          />
          <Select
            label="Product"
            options={products.map((p) => ({ label: `${p.name} (${p.sku})`, value: p.id }))}
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            placeholder={products.length === 0 ? 'No products available' : undefined}
          />
          <Input
            label="Quantity"
            type="text"
            inputMode="decimal"
            value={quantityText}
            onChange={(e) => setQuantityText(e.target.value.replace(/,/g, ''))}
          />
          <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </form>
      </Drawer>
    </div>
  );
}
