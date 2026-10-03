'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FileText,
  Plus,
  Trash2,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Building2,
  DollarSign,
  Calendar,
  Percent,
} from 'lucide-react';
import { Customer, ServiceCategory } from '@/types/erp';
import { formatUSD } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';

interface ServiceLineItemInput {
  id: string;
  description: string;
  category: ServiceCategory;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
}

const SERVICE_CATEGORIES: Array<{ value: ServiceCategory; label: string }> = [
  { value: 'LOGISTICS', label: 'Logistics Charges' },
  { value: 'PACKAGING', label: 'Packaging & Palletizing' },
  { value: 'TRANSPORTATION', label: 'Transportation & Freight' },
  { value: 'HANDLING', label: 'Handling & Loading Fees' },
  { value: 'INSTALLATION', label: 'Installation & Onsite Support' },
  { value: 'DOCUMENTATION', label: 'Documentation & Customs Clearance' },
  { value: 'SERVICE_FEE', label: 'Professional Service Fee' },
  { value: 'OTHER', label: 'Other Miscellaneous Service' },
];

export default function CreateServiceInvoicePage() {
  const { toast } = useToast();
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState<string>(
    new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
  );
  const [paymentTerms, setPaymentTerms] = useState<string>('IMMEDIATE');
  const [currency] = useState<string>('USD');
  const [otherCharges, setOtherCharges] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  const [internalRemarks, setInternalRemarks] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Line items
  const [items, setItems] = useState<ServiceLineItemInput[]>([
    {
      id: '1',
      description: 'Freight & Logistics Operations Charge',
      category: 'LOGISTICS',
      quantity: 1,
      unitPrice: 350,
      discountPercent: 0,
      taxRate: 5,
    },
  ]);

  useEffect(() => {
    async function loadCustomers() {
      try {
        const res = await fetch('/api/customers');
        if (res.ok) {
          const data = await res.json();
          setCustomers(Array.isArray(data) ? data : data.customers || []);
          if (data.length > 0) {
            setSelectedCustomerId(data[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load customers:', err);
      }
    }
    loadCustomers();
  }, []);

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        description: '',
        category: 'SERVICE_FEE',
        quantity: 1,
        unitPrice: 100,
        discountPercent: 0,
        taxRate: 5,
      },
    ]);
  };

  const handleRemoveItem = (id: string) => {
    if (items.length === 1) {
      toast({
        title: 'Line Item Required',
        description: 'At least one service line item is required.',
        variant: 'error',
      });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleItemChange = (id: string, field: keyof ServiceLineItemInput, value: any) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  // Summary Calculations
  let subtotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;

  items.forEach((item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;
    const discountPct = Number(item.discountPercent) || 0;
    const taxRatePct = Number(item.taxRate) || 0;

    const base = qty * price;
    const disc = (base * discountPct) / 100;
    const net = base - disc;
    const tax = (net * taxRatePct) / 100;

    subtotal += base;
    totalDiscount += disc;
    totalTax += tax;
  });

  const parsedOtherCharges = Number(otherCharges) || 0;
  const grandTotal = subtotal - totalDiscount + totalTax + parsedOtherCharges;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedCustomerId) {
      toast({
        title: 'Customer Required',
        description: 'Please select a customer for this service invoice.',
        variant: 'error',
      });
      return;
    }

    if (items.some((i) => !i.description.trim())) {
      toast({
        title: 'Line Items Incomplete',
        description: 'Please provide a description for all service items.',
        variant: 'error',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/service-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomerId,
          issueDate,
          dueDate,
          paymentTerms,
          currency,
          otherCharges: parsedOtherCharges,
          notes,
          internalRemarks,
          items: items.map((i) => ({
            description: i.description,
            category: i.category,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice),
            discountPercent: Number(i.discountPercent),
            taxRate: Number(i.taxRate),
          })),
        }),
      });

      const data = await res.json();

      if (res.ok) {
        toast({
          title: 'Service Invoice Created',
          description: `Service Invoice #${data.invoice?.invoiceNumber} created successfully.`,
          variant: 'success',
        });
        router.push('/service-invoices');
      } else {
        toast({
          title: 'Creation Failed',
          description: data.error || 'Failed to create service invoice',
          variant: 'error',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Network request failed',
        variant: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-24 animate-fade-in">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-[#E5E7EB] shadow-xs">
        <div className="flex items-center gap-3">
          <Link
            href="/service-invoices"
            className="flex h-11 w-11 shrink-0 items-center justify-center md:h-auto md:w-auto md:p-2 rounded-2xl bg-[#F8FAFC] border border-[#E5E7EB] hover:bg-[#F1F5F9] transition-all"
          >
            <ArrowLeft className="h-5 w-5 text-[#111827]" />
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#111827]">
              Create Manual Service Invoice
            </h1>
            <p className="text-xs text-[#6B7280]">
              Bill non-inventory business services (Logistics, Packaging, Freight, Customs)
            </p>
          </div>
        </div>

        <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-[#005E82]/10 text-[#005E82] border border-[#005E82]/20">
          SINV-AUTO
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Customer & Billing Details Card */}
        <div className="bg-white p-6 rounded-3xl border border-[#E5E7EB] shadow-xs space-y-5">
          <div className="text-sm font-bold text-[#111827] flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#005E82]" />
            <span>Customer & Payment Setup</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                Select Billed Customer *
              </label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full px-3 py-3 md:py-2.5 rounded-2xl bg-[#F8FAFC] border border-[#E5E7EB] text-[#111827] font-semibold focus:border-[#005E82] focus:outline-none"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName} ({c.contactPerson})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                Invoice Issue Date
              </label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full px-3 py-3 md:py-2.5 rounded-2xl bg-[#F8FAFC] border border-[#E5E7EB] text-[#111827] font-mono focus:border-[#005E82] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                Payment Due Date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-3 md:py-2.5 rounded-2xl bg-[#F8FAFC] border border-[#E5E7EB] text-[#111827] font-mono focus:border-[#005E82] focus:outline-none"
              />
            </div>
          </div>

          {selectedCustomer && (
            <div className="p-4 rounded-2xl bg-[#F8FAFC] border border-[#E5E7EB] text-xs space-y-1">
              <div className="font-bold text-[#005E82]">{selectedCustomer.companyName}</div>
              <div className="text-[#6B7280]">Contact: {selectedCustomer.contactPerson} • Email: {selectedCustomer.email}</div>
              <div className="text-[#6B7280]">Billing: {selectedCustomer.billingAddress || 'Standard Address'}</div>
            </div>
          )}
        </div>

        {/* Service Line Items Card */}
        <div className="bg-white p-6 rounded-3xl border border-[#E5E7EB] shadow-xs space-y-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-[#111827] flex items-center gap-2">
              <FileText className="h-4 w-4 text-[#005E82]" />
              <span>Service Line Items</span>
            </div>
            <button
              type="button"
              onClick={handleAddItem}
              className="flex items-center gap-1.5 px-3 py-1.5 min-h-11 md:min-h-0 rounded-xl bg-[#005E82]/10 text-[#005E82] hover:bg-[#005E82]/20 text-xs font-bold transition-all"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Service Line</span>
            </button>
          </div>

          <div className="space-y-4">
            {items.map((item, index) => {
              const base = item.quantity * item.unitPrice;
              const disc = (base * item.discountPercent) / 100;
              const net = base - disc;
              const tax = (net * item.taxRate) / 100;
              const lineTotal = net + tax;

              return (
                <div
                  key={item.id}
                  className="p-4 rounded-2xl bg-[#F8FAFC] border border-[#E5E7EB] space-y-3 relative transition-all hover:border-[#005E82]/30"
                >
                  <div className="flex items-center justify-between text-xs font-bold text-[#6B7280] font-mono">
                    <span>Service Item #{index + 1}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      className="inline-flex items-center justify-center min-h-11 min-w-11 md:min-h-0 md:min-w-0 text-red-500 hover:text-red-700 p-1"
                      title="Remove Item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                        Service Description *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. International Cargo Logistics & Airway Documentation"
                        value={item.description}
                        onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                        className="w-full px-3 py-3 md:py-2 rounded-xl bg-white border border-[#E5E7EB] text-[#111827] text-xs focus:border-[#005E82] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                        Service Category
                      </label>
                      <select
                        value={item.category}
                        onChange={(e) => handleItemChange(item.id, 'category', e.target.value as any)}
                        className="w-full px-3 py-3 md:py-2 rounded-xl bg-white border border-[#E5E7EB] text-[#111827] text-xs font-semibold focus:border-[#005E82] focus:outline-none"
                      >
                        {SERVICE_CATEGORIES.map((cat) => (
                          <option key={cat.value} value={cat.value}>
                            {cat.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                        Quantity
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.quantity}
                        onChange={(e) => handleItemChange(item.id, 'quantity', Number(e.target.value))}
                        className="w-full px-3 py-3 md:py-2 rounded-xl bg-white border border-[#E5E7EB] text-[#111827] text-xs font-mono focus:border-[#005E82] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                        Unit Rate ($ USD)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => handleItemChange(item.id, 'unitPrice', Number(e.target.value))}
                        className="w-full px-3 py-3 md:py-2 rounded-xl bg-white border border-[#E5E7EB] text-[#111827] text-xs font-mono focus:border-[#005E82] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                        Discount (%)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={item.discountPercent}
                        onChange={(e) => handleItemChange(item.id, 'discountPercent', Number(e.target.value))}
                        className="w-full px-3 py-3 md:py-2 rounded-xl bg-white border border-[#E5E7EB] text-[#111827] text-xs font-mono focus:border-[#005E82] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                        Tax Rate (%)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={item.taxRate}
                        onChange={(e) => handleItemChange(item.id, 'taxRate', Number(e.target.value))}
                        className="w-full px-3 py-3 md:py-2 rounded-xl bg-white border border-[#E5E7EB] text-[#111827] text-xs font-mono focus:border-[#005E82] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#E5E7EB] flex justify-end text-xs font-mono font-bold text-[#005E82]">
                    Line Amount: {formatUSD(lineTotal)} USD
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Calculation Summary Card */}
        <div className="bg-white p-6 rounded-3xl border border-[#E5E7EB] shadow-xs space-y-4">
          <div className="text-sm font-bold text-[#111827] flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-[#005E82]" />
            <span>Calculation Summary</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                  Additional Surcharges / Fees ($ USD)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={otherCharges}
                  onChange={(e) => setOtherCharges(Number(e.target.value))}
                  className="w-full px-3 py-3 md:py-2.5 rounded-2xl bg-[#F8FAFC] border border-[#E5E7EB] text-[#111827] font-mono focus:border-[#005E82] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                  Invoice Notes for Customer
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Payment due within 14 days. Thank you for your business."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-3 md:py-2 rounded-2xl bg-[#F8FAFC] border border-[#E5E7EB] text-[#111827] focus:border-[#005E82] focus:outline-none text-xs"
                />
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#F8FAFC] border border-[#E5E7EB] space-y-2.5 text-xs font-mono">
              <div className="flex justify-between text-[#6B7280]">
                <span>Service Subtotal:</span>
                <span className="font-bold text-[#111827]">{formatUSD(subtotal)}</span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between text-[#15803D]">
                  <span>Total Discount:</span>
                  <span className="font-bold">-{formatUSD(totalDiscount)}</span>
                </div>
              )}
              {totalTax > 0 && (
                <div className="flex justify-between text-[#6B7280]">
                  <span>Tax Amount:</span>
                  <span className="font-bold">+{formatUSD(totalTax)}</span>
                </div>
              )}
              {parsedOtherCharges > 0 && (
                <div className="flex justify-between text-[#6B7280]">
                  <span>Other Charges:</span>
                  <span className="font-bold">+{formatUSD(parsedOtherCharges)}</span>
                </div>
              )}

              <div className="pt-3 border-t border-[#E5E7EB] flex justify-between text-base font-bold text-[#005E82]">
                <span>Grand Total:</span>
                <span>{formatUSD(grandTotal)} USD</span>
              </div>
            </div>
          </div>
        </div>

        {/* Submit Actions */}
        <div className="flex items-center justify-end gap-3">
          <Link
            href="/service-invoices"
            className="flex items-center justify-center px-5 py-3.5 md:py-3 min-h-11 md:min-h-0 rounded-2xl bg-white border border-[#E5E7EB] text-[#6B7280] hover:text-[#111827] text-xs font-bold"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center justify-center gap-2 px-6 py-3.5 md:py-3 min-h-11 md:min-h-0 rounded-2xl bg-[#005E82] hover:bg-[#004B68] text-white text-xs font-bold shadow-xs transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Creating Service Invoice...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span>Issue Manual Service Invoice</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
