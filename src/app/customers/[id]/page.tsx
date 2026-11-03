'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Users,
  Building2,
  MapPin,
  Plus,
  Trash2,
} from 'lucide-react';
import { formatUSD, formatMoney, formatDate } from '@/lib/utils';
import { Customer, TaxInvoice, Proforma } from '@/types/erp';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { KPICard } from '@/components/ui/KPICard';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const id = params.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [proformas, setProformas] = useState<Proforma[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = async () => {
    try {
      const res = await fetch(`/api/customers/${id}`);
      if (!res.ok) {
        setCustomer(null);
        return;
      }
      const data = await res.json();
      setCustomer(data);
      setInvoices(data.taxInvoices || []);
      setProformas(data.proformas || []);
    } catch {
      setCustomer(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleDelete = async () => {
    if (!customer) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/customers/${customer.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to delete customer');
      }
      toast({ title: 'Customer deleted', variant: 'success' });
      router.push('/customers');
    } catch (err: any) {
      toast({ title: err.message || 'Failed to delete customer', variant: 'error' });
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-24 text-center space-y-4">
        <div className="text-muted text-xs font-medium">Loading customer profile...</div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="py-24 text-center space-y-4">
        <div className="text-muted text-sm font-semibold">Customer account not found</div>
        <LinkButton href="/customers" variant="outline" size="sm">
          Back to Customers
        </LinkButton>
      </div>
    );
  }

  const validInvoices = invoices.filter(
    (inv) => inv.fulfilmentStatus !== 'CANCELLED' && (inv as any).status !== 'CANCELLED'
  );
  const ordersCount = validInvoices.length > 0 ? validInvoices.length : (customer.totalOrders || 0);
  const totalRevenue = validInvoices.length > 0
    ? validInvoices
        .filter((inv) => inv.paymentStatus === 'PAID')
        .reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0)
    : (customer.totalSpent || 0);
  const outstandingBalance = validInvoices.length > 0
    ? validInvoices
        .filter((inv) => inv.paymentStatus !== 'PAID')
        .reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0)
    : Math.max(0, customer.currentBalance || 0);

  const creditUsedPercent = Math.min(100, Math.round((outstandingBalance / (customer.creditLimit || 1)) * 100));
  const estimatedProfit = totalRevenue * 0.22; // ~22% average gross margin

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-16">
      {/* Header */}
      <PageHeader
        breadcrumbs={[{ label: 'Customers', href: '/customers' }, { label: customer.companyName }]}
        title={
          <span className="inline-flex items-center gap-2.5">
            {customer.companyName}
            <span className="font-mono text-xs font-bold text-ink-secondary bg-surface-muted px-2 py-0.5 rounded border border-line align-middle">
              {customer.customerCode}
            </span>
          </span>
        }
        description={`Contact: ${customer.contactPerson} · ${customer.email} · ${customer.country}`}
        actions={
          <div className="flex items-center gap-2">
            <LinkButton
              href={`/proformas/new?customerId=${customer.id}`}
              iconLeft={<Plus className="h-4 w-4" />}
              size="sm"
            >
              Create Proforma
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

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <KPICard
          label="Total Revenue"
          value={formatUSD(totalRevenue)}
          helperText={`${ordersCount} lifetime orders`}
        />
        <KPICard
          label="Orders Count"
          value={ordersCount}
          helperText="Completed & active"
        />
        <KPICard
          label="Outstanding Balance"
          value={formatUSD(outstandingBalance)}
          helperText={`Credit limit: ${formatUSD(customer.creditLimit)}`}
        />
        <KPICard
          label="Profit Generated"
          value={formatUSD(estimatedProfit)}
          helperText="Estimated gross profit"
        />
      </div>

      {/* Addresses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-ink font-bold">
            <MapPin className="h-4 w-4 text-primary" />
            <span>Billing Address</span>
          </div>
          <p className="text-ink-secondary leading-relaxed">{customer.billingAddress}</p>
        </Card>

        <Card className="p-5 space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-ink font-bold">
            <Building2 className="h-4 w-4 text-emerald-600" />
            <span>Shipping / Receiving Hub</span>
          </div>
          <p className="text-ink-secondary leading-relaxed">{customer.shippingAddress}</p>
        </Card>
      </div>

      {/* Transaction History */}
      <Card className="overflow-hidden space-y-0">
        <div className="p-4 border-b border-line-soft bg-surface flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
            Invoices & Orders ({invoices.length})
          </h3>
        </div>

        <Table className="border-0 rounded-none shadow-none">
          <TableHeader>
            <TableHead>Invoice #</TableHead>
            <TableHead>Issue Date</TableHead>
            <TableHead>Depot Hub</TableHead>
            <TableHead align="right">Amount (USD)</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Fulfilment</TableHead>
            <TableHead align="right">Action</TableHead>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted">
                  No invoices generated yet for this customer account.
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono font-bold text-primary">{inv.invoiceNumber}</TableCell>
                  <TableCell className="text-muted">{formatDate(inv.issueDate)}</TableCell>
                  <TableCell className="text-ink-secondary">{inv.depotName}</TableCell>
                  <TableCell align="right" className="font-mono font-bold text-ink">{formatMoney(inv.grandTotal, inv.currency)}</TableCell>
                  <TableCell>
                    <StatusBadge status={inv.paymentStatus || 'UNPAID'} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={inv.fulfilmentStatus} />
                  </TableCell>
                  <TableCell align="right">
                    <LinkButton href={`/invoices/${inv.id}`} size="sm" variant="secondary">
                      View
                    </LinkButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <ConfirmDialog
        open={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleDelete}
        title={`Delete ${customer.companyName}?`}
        description="Are you sure you want to permanently delete this customer account? This cannot be undone."
        confirmLabel="Delete Customer"
        destructive
        loading={isDeleting}
      />
    </div>
  );
}
