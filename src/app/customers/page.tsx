'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Users,
  Plus,
  ArrowRight,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { formatUSD } from '@/lib/utils';
import { Customer, PaymentTerms } from '@/types/erp';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { SearchInput, Input, Select, Textarea } from '@/components/ui/Input';
import { Drawer, ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { fetchWithCache } from '@/lib/client-cache';
import { PAYMENT_METHODS, termsOptionsFor, termsLabel } from '@/lib/documents/terms';

const PAYMENT_METHOD_OPTIONS = [{ label: 'Not set', value: '' }, ...PAYMENT_METHODS.map((m) => ({ label: m, value: m }))];

const STATUS_OPTIONS = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'On Hold', value: 'ON_HOLD' },
  { label: 'Inactive', value: 'INACTIVE' },
];

interface CustomerFormState {
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  country: string;
  billingAddress: string;
  shippingAddress: string;
  taxNumber: string;
  paymentTerms: PaymentTerms;
  customPaymentTerms: string;
  paymentMethod: string;
  creditLimit: number;
  status: 'ACTIVE' | 'ON_HOLD' | 'INACTIVE';
  notes: string;
}

const EMPTY_FORM: CustomerFormState = {
  companyName: '',
  contactPerson: '',
  email: '',
  phone: '',
  country: '',
  billingAddress: '',
  shippingAddress: '',
  taxNumber: '',
  paymentTerms: 'NET_30',
  customPaymentTerms: '',
  paymentMethod: '',
  creditLimit: 50000,
  status: 'ACTIVE',
  notes: '',
};

export default function CustomersPage() {
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [form, setForm] = useState<CustomerFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async (query = '', activeRef?: { current: boolean }) => {
    setError(null);
    try {
      const url = query ? `/api/customers?q=${encodeURIComponent(query)}` : '/api/customers';
      const data = await fetchWithCache<Customer[]>(url, undefined, 3000);
      if (activeRef && !activeRef.current) return;
      setCustomers(Array.isArray(data) ? data : []);
    } catch {
      if (activeRef && !activeRef.current) return;
      setError('Something went wrong. Please try again.');
    } finally {
      if (!activeRef || activeRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const activeRef = { current: true };
    loadData(debouncedSearch, activeRef);
    return () => {
      activeRef.current = false;
    };
  }, [debouncedSearch]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setDrawerMode('create');
  };

  const openEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setForm({
      companyName: customer.companyName || '',
      contactPerson: customer.contactPerson || '',
      email: customer.email || '',
      phone: customer.phone || '',
      country: customer.country || '',
      billingAddress: customer.billingAddress || '',
      shippingAddress: customer.shippingAddress || '',
      taxNumber: customer.taxNumber || '',
      paymentTerms: customer.paymentTerms || 'NET_30',
      customPaymentTerms: customer.customPaymentTerms || '',
      paymentMethod: customer.paymentMethod || '',
      creditLimit: customer.creditLimit || 50000,
      status: (customer.status as any) || 'ACTIVE',
      notes: customer.notes || '',
    });
    setFormError('');
    setDrawerMode('edit');
  };

  const closeDrawer = () => {
    setDrawerMode(null);
    setEditingCustomer(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!form.companyName.trim() || !form.contactPerson.trim() || !form.email.trim()) {
      setFormError('Company name, contact person, and email are required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const isEdit = drawerMode === 'edit' && editingCustomer;
      const url = isEdit ? `/api/customers/${editingCustomer.id}` : '/api/customers';
      const method = isEdit ? 'PUT' : 'POST';
      const body = isEdit
        ? { ...form }
        : {
            companyName: form.companyName.trim(),
            contactPerson: form.contactPerson.trim(),
            email: form.email.trim(),
            phone: form.phone.trim(),
            country: form.country.trim(),
            billingAddress: form.billingAddress.trim() || `${form.companyName}, ${form.country}`,
            shippingAddress: form.shippingAddress.trim() || form.billingAddress.trim() || `${form.companyName}, ${form.country}`,
            taxNumber: form.taxNumber.trim() || 'TAX-PENDING',
            paymentTerms: form.paymentTerms,
            customPaymentTerms: form.paymentTerms === 'CUSTOM' ? form.customPaymentTerms : '',
            paymentMethod: form.paymentMethod,
            creditLimit: Number(form.creditLimit),
            notes: form.notes.trim(),
          };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Failed to ${isEdit ? 'update' : 'create'} customer`);
      }

      toast({ title: isEdit ? 'Customer updated' : 'Customer created', variant: 'success' });
      await loadData(debouncedSearch);
      closeDrawer();
    } catch (err: any) {
      setFormError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingCustomer) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/customers/${deletingCustomer.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to delete customer');
      }
      toast({ title: 'Customer deleted', variant: 'success' });
      setDeletingCustomer(null);
      await loadData(debouncedSearch);
    } catch (err: any) {
      toast({ title: err.message || 'Failed to delete customer', variant: 'error' });
    } finally {
      setIsDeleting(false);
    }
  };

  const filtered = customers.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.companyName.toLowerCase().includes(q) ||
      c.contactPerson.toLowerCase().includes(q) ||
      c.customerCode.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.country && c.country.toLowerCase().includes(q))
    );
  });

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Customers"
        description="B2B client directory — credit limits, payment terms, and account management."
        actions={
          <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>
            New Customer
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <SearchInput
          placeholder="Search company, code, email, or country..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          wrapperClassName="w-full sm:w-96"
        />
        <span className="text-xs text-muted sm:ml-auto">{filtered.length} accounts</span>
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={7} />
      ) : error ? (
        <ErrorState description={error} action={<Button onClick={() => loadData()}>Try Again</Button>} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={searchQuery ? 'No matching customers' : 'No customers yet'}
          description={
            searchQuery
              ? 'No client accounts match your search.'
              : 'Create your first B2B wholesale client to start issuing proformas and invoices.'
          }
          action={
            !searchQuery && (
              <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>
                Create Customer
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className="overflow-hidden p-0 border-0 rounded-none bg-transparent">
              <Table>
                <TableHeader>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead align="right">Credit Limit</TableHead>
                  <TableHead align="right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Action</TableHead>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-semibold text-ink">{c.companyName}</div>
                        <div className="text-xs text-muted font-mono mt-0.5">{c.customerCode}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-ink">{c.contactPerson}</div>
                        <div className="text-xs text-muted mt-0.5">{c.email}</div>
                      </TableCell>
                      <TableCell className="text-muted">{c.country || '—'}</TableCell>
                      <TableCell align="right" className="font-mono">{formatUSD(c.creditLimit)}</TableCell>
                      <TableCell align="right" className="font-mono">{formatUSD(c.currentBalance)}</TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell align="right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                            Edit
                          </Button>
                          <LinkButton href={`/customers/${c.id}`} size="sm" variant="secondary" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
                            View
                          </LinkButton>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted hover:text-danger hover:bg-danger-soft px-2"
                            onClick={() => setDeletingCustomer(c)}
                            title="Delete Customer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>

          <div className="md:hidden space-y-3">
            {filtered.map((c) => (
              <Card key={c.id} className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink truncate">{c.companyName}</div>
                    <div className="text-xs text-muted font-mono mt-0.5">{c.customerCode}</div>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <div className="text-xs text-ink-secondary">
                  <div>{c.contactPerson}</div>
                  <div className="text-muted mt-0.5">{c.email}</div>
                </div>
                <div className="flex items-center justify-between text-xs pt-1 border-t border-line-soft">
                  <span className="text-muted">{c.country || '—'}</span>
                  <span className="font-mono text-ink">{formatUSD(c.creditLimit)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">Balance</span>
                  <span className="font-mono text-ink">{formatUSD(c.currentBalance)}</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(c)}>
                    Edit
                  </Button>
                  <LinkButton href={`/customers/${c.id}`} size="sm" variant="secondary" className="flex-1" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
                    View
                  </LinkButton>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted hover:text-danger hover:bg-danger-soft px-2.5"
                    onClick={() => setDeletingCustomer(c)}
                    title="Delete Customer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <Drawer
        open={drawerMode !== null}
        onClose={closeDrawer}
        width="lg"
        title={drawerMode === 'edit' ? `Edit ${editingCustomer?.companyName || 'Customer'}` : 'New Customer'}
        description={
          drawerMode === 'edit'
            ? 'Update commercial terms, addresses, and contact information.'
            : 'Register a new B2B wholesale client, production house, or rental agency.'
        }
        footer={
          <>
            <Button variant="outline" onClick={closeDrawer} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="customer-form" loading={isSubmitting} iconLeft={!isSubmitting ? <CheckCircle2 className="h-4 w-4" /> : undefined}>
              {drawerMode === 'edit' ? 'Save Changes' : 'Create Customer'}
            </Button>
          </>
        }
      >
        <form id="customer-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
          {formError && (
            <div className="rounded-lg border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger">
              {formError}
            </div>
          )}

          <div className="flex flex-col gap-3.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Company &amp; Contact</div>
            <Input
              label="Company Name"
              required
              value={form.companyName}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              placeholder="e.g. Apex Broadcast & Cinema Solutions LLC"
            />
            <Input
              label="Primary Contact Person"
              required
              value={form.contactPerson}
              onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
              placeholder="e.g. Alex Morgan"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Work Email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="purchasing@company.com"
              />
              <Input
                label="Phone / WhatsApp"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+971 4 390 1200"
              />
            </div>
            {drawerMode === 'edit' && (
              <Select
                label="Account Status"
                options={STATUS_OPTIONS}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as any })}
              />
            )}
          </div>

          <div className="flex flex-col gap-3.5 pt-2 border-t border-line">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Location &amp; Tax</div>
            <Input
              label="Country / Region"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              placeholder="e.g. United Arab Emirates"
            />
            <Input
              label="Tax / VAT / GST Number"
              value={form.taxNumber}
              onChange={(e) => setForm({ ...form, taxNumber: e.target.value })}
              placeholder="e.g. TRN-10029384910003"
            />
            <Textarea
              label="Billing Address"
              rows={2}
              value={form.billingAddress}
              onChange={(e) => setForm({ ...form, billingAddress: e.target.value })}
            />
            <Textarea
              label="Shipping Address"
              rows={2}
              value={form.shippingAddress}
              onChange={(e) => setForm({ ...form, shippingAddress: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-3.5 pt-2 border-t border-line">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Commercial Terms</div>
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Payment Terms"
                options={termsOptionsFor(form.paymentTerms).map((o) => ({ label: o.label, value: o.value }))}
                value={form.paymentTerms}
                onChange={(e) => setForm({ ...form, paymentTerms: e.target.value as PaymentTerms })}
                hint="When payment is due"
              />
              <Select
                label="Payment Method"
                options={PAYMENT_METHOD_OPTIONS}
                value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                hint="How the customer pays"
              />
              {form.paymentTerms === 'CUSTOM' && (
                <Input
                  label="Custom payment terms"
                  value={form.customPaymentTerms}
                  maxLength={120}
                  onChange={(e) => setForm({ ...form, customPaymentTerms: e.target.value })}
                  placeholder="e.g. 40% advance, balance before dispatch"
                  wrapperClassName="col-span-2"
                />
              )}
              <Input
                label="Credit Limit ($ USD)"
                type="number"
                min={0}
                step={1000}
                value={form.creditLimit}
                onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) })}
              />
            </div>
            <Textarea
              label="Internal Notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. VIP rental house, preferential pricing tier 1..."
            />
          </div>
        </form>
      </Drawer>

      <ConfirmDialog
        open={deletingCustomer !== null}
        onClose={() => setDeletingCustomer(null)}
        onConfirm={confirmDelete}
        title={`Delete ${deletingCustomer?.companyName || 'customer'}?`}
        description="Are you sure you want to delete this customer account? This will permanently remove their records."
        confirmLabel="Delete Customer"
        destructive
        loading={isDeleting}
      />
    </div>
  );
}
