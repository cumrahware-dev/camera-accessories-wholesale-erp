'use client';

import React, { useState, useEffect } from 'react';
import {
  Truck,
  CheckCircle2,
  ExternalLink,
  Search,
  RefreshCw,
  Barcode,
  Package,
  Sparkles,
  Building2,
  Calendar,
  Layers,
  ArrowRight,
  Filter,
  Upload,
  FileCheck,
  Eye,
  X,
  FileText,
} from 'lucide-react';
import { User, TaxInvoice, Carrier } from '@/types/erp';
import { fetchCurrentUserCached, getCurrentUserCachedSync, fetchWithCache } from '@/lib/client-cache';
import { formatUSD, formatDate } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';

export default function DepotShipPage() {
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState<User | null>(() => getCurrentUserCachedSync()?.user || null);
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'READY_TO_SHIP' | 'DISPATCHED'>('ALL');

  // Per-card input state (invoiceId -> value, where value is a Carrier id)
  const [courierInputs, setCourierInputs] = useState<Record<string, string>>({});
  const [awbInputs, setAwbInputs] = useState<Record<string, string>>({});
  const [remarksInputs, setRemarksInputs] = useState<Record<string, string>>({});
  const [isShipping, setIsShipping] = useState<Record<string, boolean>>({});

  // AWB Document Upload States (invoiceId -> url/name/size/progress)
  const [awbDocUrls, setAwbDocUrls] = useState<Record<string, string>>({});
  const [awbDocNames, setAwbDocNames] = useState<Record<string, string>>({});
  const [awbDocSizes, setAwbDocSizes] = useState<Record<string, string>>({});
  const [isUploadingAwb, setIsUploadingAwb] = useState<Record<string, boolean>>({});

  const loadData = async () => {
    setIsLoading(true);
    let user: User | null = currentUser;

    try {
      const userData = await fetchCurrentUserCached();
      if (userData?.authenticated && userData.user) {
        user = userData.user;
        setCurrentUser(user);
      }
    } catch {}

    try {
      const allInvoices = await fetchWithCache<TaxInvoice[]>('/api/invoices', undefined, 10000);
      if (Array.isArray(allInvoices)) {
        const filtered = allInvoices.filter((inv: any) => {
          const statusMatch = ['PACKED', 'SHIPPED', 'DELIVERED'].includes(inv.fulfilmentStatus);
          const depotMatch = !user?.assignedDepotId || inv.depotId === user.assignedDepotId;
          return statusMatch && depotMatch;
        });
        setInvoices(filtered);

        // Pre-populate existing uploaded AWB documents
        const existingDocs: Record<string, string> = {};
        filtered.forEach((inv: any) => {
          const docUrl = inv.shippingDetails?.awbDocumentUrl || inv.shipment?.awbDocumentUrl;
          if (docUrl) {
            existingDocs[inv.id] = docUrl;
          }
        });
        setAwbDocUrls((prev) => ({ ...existingDocs, ...prev }));
      }
    } catch (e) {
      console.error('Error loading ship invoices:', e);
    } finally {
      setIsLoading(false);
    }

    try {
      const res = await fetch('/api/carriers?active=1', { cache: 'no-store' });
      if (res.ok) setCarriers(await res.json());
    } catch (e) {
      console.error('Error loading carriers:', e);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handle Airway Bill Document Upload via Cloudinary
  const handleAwbFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, invoice: TaxInvoice) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(file.type.toLowerCase())) {
      toast({
        title: 'Invalid File Type',
        description: 'Please select a PDF, JPG, JPEG, or PNG document.',
        variant: 'error',
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: 'File Too Large',
        description: 'Airway Bill document size must be under 10MB.',
        variant: 'error',
      });
      return;
    }

    const fileSizeFormatted =
      file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
        : `${Math.round(file.size / 1024)} KB`;

    setIsUploadingAwb((prev) => ({ ...prev, [invoice.id]: true }));

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const base64Data = event.target?.result as string;

          const res = await fetch('/api/cloudinary/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileData: base64Data,
              fileName: file.name,
              category: 'AIRWAY_BILL',
              relatedEntityType: 'SHIPMENT',
              relatedEntityId: invoice.id,
              relatedEntityLabel: `AWB Document for Invoice #${invoice.invoiceNumber}`,
              title: `Airway Bill - Invoice #${invoice.invoiceNumber}`,
            }),
          });

          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || 'Failed to upload Airway Bill document');

          const uploadedUrl = data.cloudinary?.secure_url || data.document?.cloudinaryUrl || base64Data;

          setAwbDocUrls((prev) => ({ ...prev, [invoice.id]: uploadedUrl }));
          setAwbDocNames((prev) => ({ ...prev, [invoice.id]: file.name }));
          setAwbDocSizes((prev) => ({ ...prev, [invoice.id]: fileSizeFormatted }));

          toast({
            title: 'Airway Bill Uploaded',
            description: `${file.name} uploaded successfully.`,
            variant: 'success',
          });
        } catch (uploadErr: any) {
          toast({
            title: 'Upload Failed',
            description: uploadErr.message || 'Failed to upload Airway Bill document',
            variant: 'error',
          });
        } finally {
          setIsUploadingAwb((prev) => ({ ...prev, [invoice.id]: false }));
        }
      };

      reader.onerror = () => {
        toast({
          title: 'Upload Failed',
          description: 'Failed to read file contents',
          variant: 'error',
        });
        setIsUploadingAwb((prev) => ({ ...prev, [invoice.id]: false }));
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      toast({
        title: 'Upload Failed',
        description: err.message || 'Failed to upload Airway Bill document',
        variant: 'error',
      });
      setIsUploadingAwb((prev) => ({ ...prev, [invoice.id]: false }));
    }
  };

  const removeAwbDocument = (invoiceId: string) => {
    setAwbDocUrls((prev) => {
      const next = { ...prev };
      delete next[invoiceId];
      return next;
    });
    setAwbDocNames((prev) => {
      const next = { ...prev };
      delete next[invoiceId];
      return next;
    });
    setAwbDocSizes((prev) => {
      const next = { ...prev };
      delete next[invoiceId];
      return next;
    });
  };

  // Filtered Invoices
  const filteredInvoices = invoices.filter((inv) => {
    const isPacked = inv.fulfilmentStatus === 'PACKED';
    const isDispatched = inv.fulfilmentStatus === 'SHIPPED' || inv.fulfilmentStatus === 'DELIVERED';

    if (filterType === 'READY_TO_SHIP' && !isPacked) return false;
    if (filterType === 'DISPATCHED' && !isDispatched) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchInv = inv.invoiceNumber?.toLowerCase().includes(q);
      const matchCompany = inv.customerCompany?.toLowerCase().includes(q);
      const matchAwb = inv.shippingDetails?.airwayBillNumber?.toLowerCase().includes(q);
      const matchCourier = inv.shippingDetails?.carrierName?.toLowerCase().includes(q) || inv.shippingDetails?.courier?.toLowerCase().includes(q);
      const matchItem = inv.items?.some(
        (item: any) =>
          item.productName?.toLowerCase().includes(q) ||
          item.productSku?.toLowerCase().includes(q)
      );
      return matchInv || matchCompany || matchAwb || matchCourier || matchItem;
    }

    return true;
  });

  const handleQuickShip = async (inv: TaxInvoice) => {
    const awbNumber = awbInputs[inv.id] || '';
    if (!awbNumber.trim()) {
      toast({
        title: 'Airway Bill Number Required',
        description: 'Please enter or auto-generate an Airway Bill (AWB) number before dispatching.',
        variant: 'error',
      });
      return;
    }

    const docUrl = awbDocUrls[inv.id] || inv.shippingDetails?.awbDocumentUrl || (inv as any).shipment?.awbDocumentUrl;
    if (!docUrl) {
      toast({
        title: 'Airway Bill Document Required',
        description: 'Please upload the Airway Bill before shipping.',
        variant: 'error',
      });
      return;
    }

    const carrierId = courierInputs[inv.id] || carriers[0]?.id || '';
    const carrier = carriers.find((c) => c.id === carrierId);
    setIsShipping((prev) => ({ ...prev, [inv.id]: true }));

    try {
      const res = await fetch(`/api/invoices/${inv.id}/ship`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrierId: carrierId || undefined,
          // No carrier registered yet (empty master): fall back to the legacy fixed courier so shipping still works.
          ...(carrierId ? {} : { courier: 'OTHER', customCourierName: 'Not specified' }),
          remarks: remarksInputs[inv.id] || undefined,
          airwayBillNumber: awbNumber.trim(),
          weightKg: inv.packingDetails?.totalWeightKg || 5.0,
          packageCount: inv.packingDetails?.packageCount || 1,
          airwayBillDocUrl: docUrl,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAwbInputs((prev) => ({ ...prev, [inv.id]: '' }));

        toast({
          title: 'Shipment Dispatched Successfully',
          description: `AWB: ${awbNumber.trim()} · Manager notification sent to prajwal0shetty11@gmail.com`,
          variant: 'success',
        });
        // Update local invoice state
        setInvoices((prev) =>
          prev.map((item) =>
            item.id === inv.id
              ? {
                  ...item,
                  fulfilmentStatus: 'SHIPPED',
                  shippingDetails: data.invoice?.shippingDetails || {
                    carrierId: carrier?.id,
                    carrierName: carrier?.name,
                    airwayBillNumber: awbNumber.trim(),
                    awbDocumentUrl: docUrl,
                  },
                }
              : item
          )
        );
      } else {
        const error = await res.json();
        toast({
          title: 'Dispatch Failed',
          description: error.error || 'Failed to complete shipment dispatch',
          variant: 'error',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Dispatch Error',
        description: err.message || 'Dispatch request failed',
        variant: 'error',
      });
    } finally {
      setIsShipping((prev) => ({ ...prev, [inv.id]: false }));
    }
  };

  // Quick auto-generate AWB helper for fast high-volume depot testing
  const generateAwb = (invoiceId: string, prefix = 'DHL') => {
    const randomDigits = Math.floor(1000000000 + Math.random() * 9000000000);
    const generated = `${prefix}-${randomDigits}`;
    setAwbInputs((prev) => ({ ...prev, [invoiceId]: generated }));
  };

  const packedOrders = invoices.filter((i) => i.fulfilmentStatus === 'PACKED');
  const shippedOrders = invoices.filter(
    (i) => i.fulfilmentStatus === 'SHIPPED' || i.fulfilmentStatus === 'DELIVERED'
  );

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Truck className="h-6 w-6 text-primary" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-ink">
              Shipments & Courier Dispatch
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-primary-soft text-primary border border-primary/20 font-bold">
              {invoices.length} Shipments
            </span>
          </div>
          <p className="text-xs sm:text-sm text-ink-secondary mt-1">
            Depot dispatch bay: Assign Airway Bill (AWB) numbers, choose freight couriers, and generate live tracking links for handover.
          </p>
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-1.5 min-h-11 sm:min-h-0 rounded-xl border border-line bg-white text-ink-secondary hover:text-ink text-xs hover:bg-surface self-start sm:self-auto transition-colors shadow-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh Queue</span>
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
              placeholder="Search by Invoice #, Customer, AWB Tracking #, or Courier name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 min-h-11 sm:min-h-0 rounded-2xl bg-surface border border-line text-ink placeholder-muted text-xs focus:border-primary focus:bg-white focus:outline-none transition-colors"
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
              className={`px-3 py-2 min-h-11 sm:min-h-0 inline-flex items-center rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                filterType === 'ALL'
                  ? 'bg-primary text-white shadow-xs'
                  : 'bg-white text-ink-secondary hover:text-ink border border-line hover:bg-surface'
              }`}
            >
              All ({invoices.length})
            </button>
            <button
              onClick={() => setFilterType('READY_TO_SHIP')}
              className={`px-3 py-2 min-h-11 sm:min-h-0 inline-flex items-center rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                filterType === 'READY_TO_SHIP'
                  ? 'bg-orange text-white shadow-xs'
                  : 'bg-white text-ink-secondary hover:text-orange border border-line hover:bg-surface'
              }`}
            >
              Ready to Ship ({packedOrders.length})
            </button>
            <button
              onClick={() => setFilterType('DISPATCHED')}
              className={`px-3 py-2 min-h-11 sm:min-h-0 inline-flex items-center rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                filterType === 'DISPATCHED'
                  ? 'bg-success text-white shadow-xs'
                  : 'bg-white text-ink-secondary hover:text-success border border-line hover:bg-surface'
              }`}
            >
              Dispatched ({shippedOrders.length})
            </button>
          </div>
        </div>
      </div>

      {/* Orders List */}
      {isLoading ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-line space-y-3 shadow-xs">
          <RefreshCw className="h-6 w-6 animate-spin text-primary mx-auto" />
          <p className="text-xs text-muted">Loading dispatch queue...</p>
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-line space-y-3 shadow-xs">
          <CheckCircle2 className="h-12 w-12 text-success mx-auto opacity-80" />
          <h3 className="text-base font-bold text-ink">No Shipments Found</h3>
          <p className="text-xs text-muted max-w-md mx-auto">
            {searchQuery
              ? `No shipments matched "${searchQuery}". Clear search to view all.`
              : 'There are no packed shipments ready for courier dispatch in this view.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {filteredInvoices.map((invoice) => {
            const isPacked = invoice.fulfilmentStatus === 'PACKED';
            const isShipped =
              invoice.fulfilmentStatus === 'SHIPPED' || invoice.fulfilmentStatus === 'DELIVERED';
            const awbVal = awbInputs[invoice.id] ?? '';
            const selectedCarrierId = courierInputs[invoice.id] ?? carriers[0]?.id ?? '';
            const selectedCarrier = carriers.find((c) => c.id === selectedCarrierId);
            const inProgress = Boolean(isShipping[invoice.id]);

            return (
              <div
                key={invoice.id}
                className="bg-white rounded-3xl border border-line p-5 sm:p-6 space-y-5 shadow-xs hover:border-primary/30 hover:shadow-md transition-all"
              >
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-primary">
                        #{invoice.invoiceNumber}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                          isShipped
                            ? 'bg-success-soft text-success border border-success-border'
                            : 'bg-orange-soft text-orange border border-orange/20'
                        }`}
                      >
                        {isShipped ? 'DISPATCHED & IN TRANSIT' : 'PACKED & READY FOR AWB'}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-ink mt-1">
                      {invoice.customerCompany}
                    </h3>
                    <p className="text-xs text-muted">
                      Destination: {invoice.shippingAddress || 'International Cargo Hub'} • Total: {formatUSD(invoice.grandTotal)}
                    </p>
                  </div>

                  <div className="text-right text-xs">
                    <span className="text-muted block text-[11px]">Weight & Boxes</span>
                    <span className="text-ink font-mono font-bold">
                      {invoice.packingDetails?.totalWeightKg || 4.5} KG ({invoice.packingDetails?.packageCount || 1} Box)
                    </span>
                  </div>
                </div>

                {/* Shipped Tracking Details if Dispatched */}
                {isShipped ? (
                  <div className="p-4 rounded-2xl bg-surface border border-line space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted">Courier Carrier:</span>
                      <span className="font-bold text-ink font-mono">
                        {invoice.shippingDetails?.carrierName
                          || (invoice as any).shipment?.carrierName
                          || (invoice.shippingDetails?.courier || (invoice as any).shipment?.courier || 'DHL_EXPRESS').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted">Airway Bill (AWB) #:</span>
                      <span className="font-bold text-primary font-mono text-sm">
                        {invoice.shippingDetails?.airwayBillNumber || (invoice as any).shipment?.airwayBillNumber || 'N/A'}
                      </span>
                    </div>
                    {(invoice.shippingDetails?.awbDocumentUrl || awbDocUrls[invoice.id] || (invoice as any).shipment?.awbDocumentUrl) && (
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-muted">AWB Document:</span>
                        <a
                          href={invoice.shippingDetails?.awbDocumentUrl || awbDocUrls[invoice.id] || (invoice as any).shipment?.awbDocumentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary font-semibold hover:underline font-mono"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span>View Airway Bill PDF/Image</span>
                        </a>
                      </div>
                    )}
                    {(invoice.shippingDetails?.trackingUrl || (invoice as any).shipment?.trackingUrl) && (
                      <div className="pt-2 border-t border-line flex justify-end">
                        <a
                          href={invoice.shippingDetails?.trackingUrl || (invoice as any).shipment?.trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline font-semibold font-mono"
                        >
                          <span>Track with Courier Carrier</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Courier & AWB Assignment Form for Ready to Ship */
                  <div className="p-4 rounded-2xl bg-surface border border-line space-y-3 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-muted mb-1">
                          Freight Courier Carrier
                        </label>
                        <select
                          value={courierInputs[invoice.id] ?? carriers[0]?.id ?? ''}
                          onChange={(e) =>
                            setCourierInputs((prev) => ({ ...prev, [invoice.id]: e.target.value }))
                          }
                          className="w-full px-3 py-2 min-h-11 sm:min-h-0 rounded-xl bg-white border border-line text-ink text-xs focus:border-primary focus:outline-none shadow-xs"
                        >
                          {carriers.length === 0 && <option value="">No carriers configured yet</option>}
                          {carriers.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        {carriers.length === 0 && (
                          <p className="text-[10px] text-muted mt-1">
                            Add a carrier under Settings &rsaquo; Carrier Management before dispatching.
                          </p>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-[11px] font-medium text-muted">
                            Airway Bill (AWB) Number *
                          </label>
                          <button
                            type="button"
                            onClick={() => generateAwb(invoice.id, (selectedCarrier?.code || selectedCarrier?.name || 'AWB').split(/\s+/)[0].toUpperCase())}
                            className="text-[10px] font-mono text-primary hover:underline font-semibold"
                          >
                            Auto-Generate AWB
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="e.g. DHL-9842104820"
                          value={awbVal}
                          onChange={(e) =>
                            setAwbInputs((prev) => ({ ...prev, [invoice.id]: e.target.value }))
                          }
                          className="w-full px-3 py-2 min-h-11 sm:min-h-0 rounded-xl bg-white border border-line text-ink text-xs font-mono focus:border-primary focus:outline-none shadow-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-muted mb-1">
                        Shipment Remarks <span className="text-muted/70">(optional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Fragile, handle with care"
                        value={remarksInputs[invoice.id] ?? ''}
                        onChange={(e) => setRemarksInputs((prev) => ({ ...prev, [invoice.id]: e.target.value }))}
                        className="w-full px-3 py-2 min-h-11 sm:min-h-0 rounded-xl bg-white border border-line text-ink text-xs focus:border-primary focus:outline-none shadow-xs"
                      />
                    </div>

                    {/* Airway Bill (AWB) Document Upload Field */}
                    <div className="space-y-1.5 pt-1">
                      <label className="block text-[11px] font-medium text-muted">
                        Upload Airway Bill (AWB Document) *
                      </label>

                      {awbDocUrls[invoice.id] ? (
                        <div className="flex items-center justify-between p-3 rounded-xl bg-success-soft border border-success/30 text-xs text-success">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileCheck className="h-5 w-5 text-success shrink-0" />
                            <div className="min-w-0">
                              <span className="font-semibold block truncate">
                                {awbDocNames[invoice.id] || 'Airway_Bill_Document.pdf'}
                              </span>
                              <span className="text-[10px] opacity-80 block">
                                {awbDocSizes[invoice.id] || 'Cloud Document Ready'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            <a
                              href={awbDocUrls[invoice.id]}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2.5 py-1 rounded-lg bg-white border border-success/30 text-success hover:bg-success hover:text-white transition-all text-[11px] font-bold flex items-center gap-1 shadow-xs"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>View</span>
                            </a>
                            <button
                              type="button"
                              onClick={() => removeAwbDocument(invoice.id)}
                              className="px-2.5 py-1 min-h-11 sm:min-h-0 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 transition-all text-[11px] font-bold flex items-center gap-1 shadow-xs"
                              title="Replace file"
                            >
                              <X className="h-3.5 w-3.5" />
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label
                          className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                            isUploadingAwb[invoice.id]
                              ? 'border-primary bg-primary/5'
                              : 'border-line hover:border-primary hover:bg-white bg-white/50'
                          }`}
                        >
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={(e) => handleAwbFileUpload(e, invoice)}
                            className="hidden"
                            disabled={Boolean(isUploadingAwb[invoice.id])}
                          />
                          {isUploadingAwb[invoice.id] ? (
                            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                              <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                              <span>Uploading Airway Bill to Cloud Storage...</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center text-center gap-1">
                              <Upload className="h-5 w-5 text-primary" />
                              <span className="text-xs font-semibold text-ink">
                                Click to Upload Airway Bill (AWB)
                              </span>
                              <span className="text-[10px] text-muted">
                                Supports PDF, JPG, JPEG, PNG (max 10MB)
                              </span>
                            </div>
                          )}
                        </label>
                      )}
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => handleQuickShip(invoice)}
                        disabled={inProgress || !awbVal.trim() || !awbDocUrls[invoice.id]}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-primary hover:bg-primary-hover text-white text-sm font-bold shadow-xs transition-all disabled:opacity-50 active:scale-98"
                      >
                        {inProgress ? (
                          <>
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            <span>Processing Dispatch...</span>
                          </>
                        ) : (
                          <>
                            <Truck className="h-5 w-5" />
                            <span>Confirm Courier Handover & Dispatch AWB</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
