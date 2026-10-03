'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Receipt,
  Printer,
  Building2,
  AlertCircle,
  Plus,
  XCircle,
  FileCheck2,
} from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatUSD, formatDate } from '@/lib/utils';
import { TaxInvoice, User } from '@/types/erp';
import PrintableDocumentModal from '@/components/pdf/PrintableDocumentModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton, IconButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { hasPermission } from '@/lib/rbac';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { SearchInput } from '@/components/ui/Input';
import { Toolbar, ToolbarGroup, FilterPillGroup } from '@/components/ui/FilterBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { fetchWithCache, getCurrentUserCachedSync } from '@/lib/client-cache';

export default function InvoicesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState<User>(
    () => (getCurrentUserCachedSync()?.user as User) || ({
      id: 'usr-admin',
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      email: 'admin@arib.com',
      status: 'ACTIVE',
    } as User)
  );
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [selectedDoc, setSelectedDoc] = useState<TaxInvoice | null>(null);
  const [cancellingInvoice, setCancellingInvoice] = useState<TaxInvoice | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (force = false) => {
    setIsLoading(true);
    try {
      const cached = getCurrentUserCachedSync()?.user;
      if (cached) setCurrentUser(cached);
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (filterStatus && filterStatus !== 'ALL') params.set('fulfilmentStatus', filterStatus);
      const url = `/api/invoices${params.toString() ? `?${params.toString()}` : ''}`;
      const data = await fetchWithCache<TaxInvoice[]>(url, undefined, force ? 0 : 5000);
      setInvoices(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      setError('Something went wrong. Please try again.');
      setInvoices([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);
  }, [debouncedSearch, filterStatus]);

  const isDepotUser = currentUser.role === 'DEPOT_USER';

  const filteredInvoices = invoices.filter((inv) => {
    if (isDepotUser && currentUser.assignedDepotId && inv.depotId !== currentUser.assignedDepotId) {
      return false;
    }
    if (filterStatus !== 'ALL' && inv.fulfilmentStatus !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customerCompany.toLowerCase().includes(q) ||
        inv.proformaNumber?.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const canCreate = hasPermission(currentUser.role, 'invoices.write');
  const totalInvoiced = filteredInvoices
    .filter((i) => i.fulfilmentStatus !== 'CANCELLED' && i.documentStatus !== 'DRAFT')
    .reduce((sum, i) => sum + i.grandTotal, 0);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        title="Tax Invoices"
        description="Legal commercial invoices and physical depot fulfilment queue."
        actions={
          canCreate ? (
            <>
              <LinkButton href="/proformas" variant="outline" iconLeft={<FileCheck2 className="h-4 w-4" />}>
                Convert Proforma
              </LinkButton>
              <LinkButton href="/invoices/new" iconLeft={<Plus className="h-4 w-4" />}>
                Create Direct Tax Invoice
              </LinkButton>
            </>
          ) : undefined
        }
      />

      {error && (
        <div className="p-3 rounded-2xl bg-danger-soft border border-danger-border text-danger text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary indicators */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-ink text-white px-4 h-9 text-xs font-semibold">
          Invoices <span className="tabular-nums">{filteredInvoices.length}</span>
        </div>
        {!isDepotUser && (
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft text-primary px-4 h-9 text-xs font-semibold">
            Total Invoiced <span className="tabular-nums">{formatUSD(totalInvoiced)}</span>
          </div>
        )}
      </div>

      {/* Filters + Search */}
      <Toolbar>
        <ToolbarGroup>
          <FilterPillGroup
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { label: 'All', value: 'ALL' },
              { label: 'Ready for Packing', value: 'READY_FOR_PACKING' },
              { label: 'Processing', value: 'PROCESSING' },
              { label: 'Packed', value: 'PACKED' },
              { label: 'Shipped', value: 'SHIPPED' },
              { label: 'Delivered', value: 'DELIVERED' },
            ]}
          />
        </ToolbarGroup>
        <SearchInput
          placeholder="Search invoice # or customer..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          wrapperClassName="w-full lg:w-72"
        />
      </Toolbar>

      {/* Invoices Table */}
      <div>
        {isLoading && invoices.length === 0 ? (
          <SkeletonTable rows={8} cols={6} />
        ) : filteredInvoices.length === 0 ? (
          <div className="rounded-2xl border border-line bg-white">
            <EmptyState
              icon={Receipt}
              title="No Tax Invoices Found"
              description="Convert approved proformas to generate tax invoices."
              action={
                <LinkButton href="/proformas/new" iconLeft={<Plus className="h-4 w-4" />}>
                  New Invoice
                </LinkButton>
              }
            />
          </div>
        ) : (
          <>
          <div className="md:hidden space-y-3">
            {filteredInvoices.map((inv) => (
              <Card
                key={inv.id}
                className="p-4 space-y-2.5 cursor-pointer"
                onClick={() => router.push(`/invoices/${inv.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/invoices/${inv.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-primary hover:underline text-sm"
                    >
                      {inv.documentStatus === 'DRAFT' ? 'Draft invoice' : inv.invoiceNumber}
                    </Link>
                    <div className="font-semibold text-ink text-xs truncate">{inv.customerCompany}</div>
                    <div className="text-[11px] text-muted truncate">{inv.customerName}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge status={inv.documentStatus === 'DRAFT' ? 'DRAFT' : inv.fulfilmentStatus} />
                    {inv.documentStatus !== 'DRAFT' && <StatusBadge status={inv.paymentStatus} />}
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono font-bold text-ink">
                    {!isDepotUser ? formatUSD(inv.grandTotal) : '—'}
                  </span>
                  <span className="font-mono text-xs text-muted">{formatDate(inv.issueDate)}</span>
                </div>

                <div className="flex items-center gap-1 text-xs text-ink-secondary">
                  <Building2 className="h-3.5 w-3.5 text-muted" />
                  {inv.depotName.replace(' Central Depot', '').replace(' Logistics Hub', '')}
                </div>

                <div
                  className="flex items-center justify-end gap-1 pt-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconButton label="Print / PDF" onClick={() => setSelectedDoc(inv)}>
                    <Printer className="h-3.5 w-3.5 text-muted" />
                  </IconButton>
                  <LinkButton href={`/invoices/${inv.id}`} size="sm" variant="secondary">
                    Open
                  </LinkButton>
                  {inv.fulfilmentStatus !== 'DELIVERED' &&
                    inv.fulfilmentStatus !== 'SHIPPED' &&
                    inv.fulfilmentStatus !== 'CANCELLED' && (
                      <IconButton
                        label="Cancel Invoice & Restore Stock"
                        onClick={() => setCancellingInvoice(inv)}
                        className="text-muted hover:text-warning hover:bg-warning-soft"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </IconButton>
                    )}
                </div>
              </Card>
            ))}
          </div>
          <div className="hidden md:block">
          <Table className="border-0 rounded-none shadow-none">
            <TableHeader>
              <TableHead>Invoice #</TableHead>
              <TableHead>Customer / Company</TableHead>
              <TableHead>Assigned Hub</TableHead>
              <TableHead>Issue Date</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="right">Total (USD)</TableHead>
              <TableHead align="right">Actions</TableHead>
            </TableHeader>
            <TableBody>
              {filteredInvoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-semibold text-primary hover:underline text-sm"
                    >
                      {inv.documentStatus === 'DRAFT' ? 'Draft invoice' : inv.invoiceNumber}
                    </Link>
                    {inv.proformaNumber && (
                      <div className="text-[10px] text-muted font-mono">Ref: {inv.proformaNumber}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-ink text-xs">{inv.customerCompany}</div>
                    <div className="text-[11px] text-muted">{inv.customerName}</div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-xs text-ink-secondary">
                      <Building2 className="h-3.5 w-3.5 text-muted" />
                      {inv.depotName.replace(' Central Depot', '').replace(' Logistics Hub', '')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted">{formatDate(inv.issueDate)}</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={inv.documentStatus === 'DRAFT' ? 'DRAFT' : inv.documentStatus === 'SENT' && inv.paymentStatus === 'UNPAID' ? 'SENT' : inv.paymentStatus} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={inv.fulfilmentStatus} />
                  </TableCell>
                  <TableCell align="right" className="font-mono font-bold text-xs text-ink">
                    {!isDepotUser ? formatUSD(inv.grandTotal) : '—'}
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton label="Print / PDF" onClick={() => setSelectedDoc(inv)}>
                        <Printer className="h-3.5 w-3.5 text-muted" />
                      </IconButton>
                      <LinkButton href={`/invoices/${inv.id}`} size="sm" variant="secondary">
                        Open
                      </LinkButton>
                      {inv.fulfilmentStatus !== 'DELIVERED' &&
                        inv.fulfilmentStatus !== 'SHIPPED' &&
                        inv.fulfilmentStatus !== 'CANCELLED' && (
                          <IconButton
                            label="Cancel Invoice & Restore Stock"
                            onClick={() => setCancellingInvoice(inv)}
                            className="text-muted hover:text-warning hover:bg-warning-soft"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </IconButton>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          </>
        )}
      </div>

      {/* Printable Modal */}
      {selectedDoc && (
        <PrintableDocumentModal
          isOpen={true}
          onClose={() => setSelectedDoc(null)}
          documentType="TAX_INVOICE"
          data={selectedDoc}
        />
      )}

      <ConfirmDialog
        open={cancellingInvoice !== null}
        onClose={() => setCancellingInvoice(null)}
        onConfirm={async () => {
          if (!cancellingInvoice) return;
          setIsCancelling(true);
          try {
            const res = await fetch(`/api/invoices/${cancellingInvoice.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fulfilmentStatus: 'CANCELLED' }),
            });
            if (!res.ok) {
              const d = await res.json().catch(() => ({}));
              throw new Error(d.error || 'Failed to cancel invoice');
            }
            toast({ title: 'Invoice cancelled and stock restored to depot', variant: 'success' });
            setCancellingInvoice(null);
            loadData(true);
          } catch (err: any) {
            toast({ title: err.message || 'Could not cancel invoice', variant: 'error' });
          } finally {
            setIsCancelling(false);
          }
        }}
        title={`Cancel Tax Invoice ${cancellingInvoice?.invoiceNumber}?`}
        description="This will cancel the invoice, restore allocated inventory units back to the depot, and release all reserved serial numbers."
        confirmLabel="Cancel Invoice"
        destructive
        loading={isCancelling}
      />
    </div>
  );
}
