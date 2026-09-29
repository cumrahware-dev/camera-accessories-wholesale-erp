'use client';

import React, { useState, useEffect } from 'react';
import {
  Building2,
  Plus,
  Edit2,
  Trash2,
  Mail,
  Phone,
  MapPin,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { Supplier } from '@/types/erp';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { SearchInput, Input, Select, Textarea } from '@/components/ui/Input';
import { Drawer, ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { fetchWithCache } from '@/lib/client-cache';
import { useDebounce } from '@/hooks/useDebounce';

const PAYMENT_TERMS_OPTIONS = [
  { label: 'NET 15 Days', value: 'NET_15' },
  { label: 'NET 30 Days', value: 'NET_30' },
  { label: 'NET 60 Days', value: 'NET_60' },
  { label: 'Immediate / Wire Transfer', value: 'IMMEDIATE' },
  { label: '50% Advance, 50% on Dispatch', value: 'ADVANCE_50' },
  { label: 'Cash In Advance', value: 'CASH_IN_ADVANCE' },
];

interface SupplierFormState {
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  country: string;
  taxId: string;
  paymentTerms: string;
}

const EMPTY_FORM: SupplierFormState = {
  name: '',
  contactPerson: '',
  email: '',
  phone: '',
  address: '',
  country: 'United Arab Emirates',
  taxId: '',
  paymentTerms: 'NET_30',
};

export default function SuppliersPage() {
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Deep link from global search: /path?search=term pre-fills the list search box.
  useEffect(() => {
    const term = new URLSearchParams(window.location.search).get('search');
    if (term) setSearchQuery(term);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deletingSupplier, setDeletingSupplier] = useState<Supplier | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [form, setForm] = useState<SupplierFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async (query = '', activeRef?: { current: boolean }) => {
    setError(null);
    try {
      const url = query ? `/api/suppliers?q=${encodeURIComponent(query)}` : '/api/suppliers';
      const data = await fetchWithCache<Supplier[]>(url, undefined, 3000);
      if (activeRef && !activeRef.current) return;
      setSuppliers(Array.isArray(data) ? data : []);
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

  const openEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setForm({
      name: supplier.name,
      contactPerson: supplier.contactPerson,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      country: supplier.country,
      taxId: supplier.taxId || '',
      paymentTerms: supplier.paymentTerms,
    });
    setFormError('');
    setDrawerMode('edit');
  };

  const closeDrawer = () => {
    setDrawerMode(null);
    setEditingSupplier(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError('Supplier / Vendor Name is required.');
      return;
    }
    if (!form.email.trim()) {
      setFormError('Contact Email is required.');
      return;
    }

    setIsSubmitting(true);
    setFormError('');
    try {
      if (drawerMode === 'create') {
        const res = await fetch('/api/suppliers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || 'Failed to create supplier');
        }
        toast({ title: 'Supplier created successfully', variant: 'success' });
      } else if (drawerMode === 'edit' && editingSupplier) {
        const res = await fetch(`/api/suppliers/${editingSupplier.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || 'Failed to update supplier');
        }
        toast({ title: 'Supplier updated successfully', variant: 'success' });
      }
      closeDrawer();
      await loadData(debouncedSearch);
    } catch (err: any) {
      setFormError(err.message || 'Operation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingSupplier) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/suppliers/${deletingSupplier.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to delete supplier');
      }
      toast({ title: 'Supplier deleted successfully', variant: 'success' });
      setDeletingSupplier(null);
      await loadData(debouncedSearch);
    } catch (err: any) {
      toast({ title: err.message || 'Could not delete supplier', variant: 'error' });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Suppliers & Vendors"
        description="Authorized camera distributors, optical manufacturers, and parts suppliers."
        actions={
          <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>
            New Supplier
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <SearchInput
          placeholder="Search by name, contact person, email, or country..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          wrapperClassName="w-full sm:w-96"
        />
        <span className="text-xs text-muted sm:ml-auto">
          {suppliers.length} vendor{suppliers.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <SkeletonTable rows={5} cols={5} />
      ) : error ? (
        <ErrorState description={error} action={<Button onClick={() => loadData(debouncedSearch)}>Try Again</Button>} />
      ) : suppliers.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No suppliers found"
          description={
            searchQuery ? `No results for "${searchQuery}".` : 'Add your first supplier to begin tracking optical inventory sources.'
          }
          action={
            searchQuery ? (
              <Button variant="secondary" onClick={() => setSearchQuery('')}>
                Clear Search
              </Button>
            ) : (
              <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>
                Add Supplier
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableHead>Supplier / Company</TableHead>
                <TableHead>Contact Person</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Tax / VAT ID</TableHead>
                <TableHead>Payment Terms</TableHead>
                <TableHead align="right">Actions</TableHead>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-semibold text-ink">{s.name}</div>
                      <div className="text-xs text-muted flex items-center gap-1.5 mt-0.5">
                        <Mail className="h-3 w-3 text-muted" />
                        <span>{s.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-ink-secondary">{s.contactPerson}</div>
                      <div className="text-xs text-muted flex items-center gap-1.5 mt-0.5">
                        <Phone className="h-3 w-3 text-muted" />
                        <span>{s.phone}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-xs text-ink-secondary">
                        <MapPin className="h-3.5 w-3.5 text-muted" />
                        <span>{s.country || 'UAE'}</span>
                      </div>
                      {s.address && <div className="text-[11px] text-muted truncate max-w-xs">{s.address}</div>}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted">{s.taxId || 'N/A'}</span>
                    </TableCell>
                    <TableCell>
                      <Badge tone="neutral">{s.paymentTerms.replace('_', ' ')}</Badge>
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-1.5">
                        <IconButton label="Edit Supplier" onClick={() => openEdit(s)}>
                          <Edit2 className="h-3.5 w-3.5 text-muted" />
                        </IconButton>
                        <IconButton
                          label="Delete Supplier"
                          className="text-muted hover:text-danger hover:bg-danger-soft"
                          onClick={() => setDeletingSupplier(s)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-3">
            {suppliers.map((s) => (
              <Card key={s.id} className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink truncate">{s.name}</div>
                    <div className="text-xs text-muted flex items-center gap-1.5 mt-0.5">
                      <Mail className="h-3 w-3 text-muted shrink-0" />
                      <span className="truncate">{s.email}</span>
                    </div>
                  </div>
                  <Badge tone="neutral" className="shrink-0">{s.paymentTerms.replace('_', ' ')}</Badge>
                </div>
                <div className="text-xs text-ink-secondary">
                  <div>{s.contactPerson}</div>
                  <div className="text-muted flex items-center gap-1.5 mt-0.5">
                    <Phone className="h-3 w-3 text-muted" />
                    <span>{s.phone}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs pt-1 border-t border-line-soft">
                  <span className="flex items-center gap-1 text-ink-secondary">
                    <MapPin className="h-3.5 w-3.5 text-muted" />
                    {s.country || 'UAE'}
                  </span>
                  <span className="text-muted">{s.taxId || 'N/A'}</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(s)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted hover:text-danger hover:bg-danger-soft px-2.5"
                    onClick={() => setDeletingSupplier(s)}
                    title="Delete Supplier"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Create / Edit Drawer */}
      <Drawer
        open={drawerMode !== null}
        onClose={closeDrawer}
        title={drawerMode === 'edit' ? 'Edit Supplier' : 'Add New Supplier'}
        description="Maintain official supplier profile and commercial terms."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={closeDrawer} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={isSubmitting}>
              {drawerMode === 'edit' ? 'Save Changes' : 'Create Supplier'}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="p-3 rounded-2xl bg-danger-soft border border-danger-border text-danger text-xs flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <Input
            label="Supplier / Company Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Sony Middle East FZE"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Contact Person"
              required
              value={form.contactPerson}
              onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
              placeholder="e.g. Kenjiro Takahashi"
            />
            <Input
              label="Email Address"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="e.g. procurement@supplier.com"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Phone Number"
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="e.g. +971 4 881 2345"
            />
            <Input
              label="Country / Jurisdiction"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              placeholder="e.g. Japan / UAE"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Tax / TRN / VAT ID"
              value={form.taxId}
              onChange={(e) => setForm({ ...form, taxId: e.target.value })}
              placeholder="e.g. 100234567800003"
            />
            <Select
              label="Payment Terms"
              value={form.paymentTerms}
              onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
              options={PAYMENT_TERMS_OPTIONS}
            />
          </div>

          <Textarea
            label="Office / Facility Address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="e.g. JAFZA View 19, Jebel Ali Free Zone, Dubai"
            rows={3}
          />
        </form>
      </Drawer>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deletingSupplier !== null}
        onClose={() => setDeletingSupplier(null)}
        onConfirm={confirmDelete}
        title="Delete Supplier"
        description={`Are you sure you want to remove "${deletingSupplier?.name}"? This action cannot be undone.`}
        confirmLabel="Delete Supplier"
        destructive
        loading={isDeleting}
      />
    </div>
  );
}
