'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Smartphone,
  Boxes,
  Package,
  Truck,
  CheckCircle2,
  Camera,
  UploadCloud,
  ExternalLink,
  ChevronRight,
  Barcode,
  Search,
  Building2,
  AlertCircle,
  Clock,
  Printer,
} from 'lucide-react';
import { fetchCurrentUserCached, getCurrentUserCachedSync } from '@/lib/client-cache';
import { formatDate, formatUSD } from '@/lib/utils';
import { TaxInvoice, User, Depot } from '@/types/erp';
import CloudinaryUploadModal from '@/components/documents/CloudinaryUploadModal';
import PrintableDocumentModal from '@/components/pdf/PrintableDocumentModal';
import { isDepotRole } from '@/lib/rbac';

export default function DepotMobilePage() {
  const [currentUser, setCurrentUser] = useState<User>(
    () => (getCurrentUserCachedSync()?.user as User) || ({
      id: 'usr-admin',
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      email: 'admin@arib.com',
      status: 'ACTIVE',
    } as User)
  );
  const [depots, setDepots] = useState<Depot[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [activeTab, setActiveTab] = useState<'READY' | 'PACKING' | 'DISPATCH'>('READY');
  const [selectedInvoice, setSelectedInvoice] = useState<TaxInvoice | null>(null);
  const [isCameraUploadOpen, setIsCameraUploadOpen] = useState(false);
  const [isSlipOpen, setIsSlipOpen] = useState(false);
  const [awbInput, setAwbInput] = useState('');
  const [courierInput, setCourierInput] = useState('DHL_EXPRESS');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyInvoiceId, setBusyInvoiceId] = useState<string | null>(null);

  const loadData = async () => {
    let user = currentUser;

    try {
      const userData = await fetchCurrentUserCached();
      if (userData?.authenticated && userData.user) {
        user = userData.user;
        setCurrentUser(user);
      } else if (typeof window !== 'undefined') {
        const storedUser = localStorage.getItem('erp_current_user');
        if (storedUser) {
          user = JSON.parse(storedUser);
          setCurrentUser(user);
        }
      }
    } catch {}

    let allDepots: Depot[] = [];
    try {
      const depotsRes = await fetch('/api/depots');
      if (depotsRes.ok) {
        const databaseDepots = await depotsRes.json();
        if (Array.isArray(databaseDepots)) {
          allDepots = databaseDepots;
          setDepots(allDepots);
        }
      }
    } catch {}

    const activeDepot = selectedDepotId || user?.assignedDepotId || allDepots[0]?.id || '';
    if (!selectedDepotId && activeDepot) {
      setSelectedDepotId(activeDepot);
    }

    try {
      const res = await fetch('/api/invoices');
      if (res.ok) {
        const allInvoices = await res.json();
        const filtered = Array.isArray(allInvoices)
          ? allInvoices.filter((inv: any) => !activeDepot || inv.depotId === activeDepot)
          : [];
        setInvoices(filtered);
      } else {
        setInvoices([]);
      }
    } catch {
      setInvoices([]);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedDepotId]);

  const activeDepotObj = depots.find((d) => d.id === selectedDepotId);

  // Categorize queues
  const readyToPick = invoices.filter((i) => i.fulfilmentStatus === 'READY_FOR_PACKING');
  const inPacking = invoices.filter((i) => i.fulfilmentStatus === 'PROCESSING' || i.fulfilmentStatus === 'PACKED');
  const dispatched = invoices.filter((i) => i.fulfilmentStatus === 'SHIPPED' || i.fulfilmentStatus === 'DELIVERED');

  const performInvoiceAction = async (invoiceId: string, path: 'pick' | 'pack' | 'ship', body: Record<string, unknown>) => {
    setActionError(null);
    setBusyInvoiceId(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        throw new Error(result.error || `Unable to ${path} this order`);
      }
      await loadData();
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to complete this depot action');
      return false;
    } finally {
      setBusyInvoiceId(null);
    }
  };

  const handlePickOrder = async (inv: TaxInvoice) => {
    await performInvoiceAction(inv.id, 'pick', {
      itemPicks: Object.fromEntries((inv.items || []).map((item) => [item.id, true])),
    });
  };

  const handlePackOrder = async (inv: TaxInvoice) => {
    await performInvoiceAction(inv.id, 'pack', {
      packedBy: currentUser.name,
      packageCount: inv.packingDetails?.packageCount || 1,
      totalWeightKg: inv.packingDetails?.totalWeightKg || 5.0,
      dimensionsCm: { length: 45, width: 35, height: 25 },
      packagePhotoUrl: inv.packingDetails?.packagePhotoUrl || null,
    });
  };

  const handleQuickShip = async (inv: TaxInvoice) => {
    const awb = awbInput || `DHL-${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const shipped = await performInvoiceAction(inv.id, 'ship', {
      courier: courierInput as any,
      airwayBillNumber: awb,
      trackingUrl: `https://www.dhl.com/en/express/tracking.html?AWB=${awb.replace(/[^0-9]/g, '')}`,
      weightKg: inv.packingDetails?.totalWeightKg || 5.0,
      packageCount: inv.packingDetails?.packageCount || 1,
      airwayBillDocUrl: null,
    });
    if (shipped) setAwbInput('');
  };

  return (
    <div className="space-y-4 animate-fade-in pb-20 max-w-3xl mx-auto">
      {/* Mobile Header */}
      <div className="p-4 rounded-2xl border border-line bg-white shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pdflogo.png"
            alt="ARIB GLOBAL"
            className="h-8 w-auto object-contain shrink-0 max-h-8"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold font-mono text-primary uppercase tracking-wider">
                Depot Fulfilment App
              </span>
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
            </div>
            <h1 className="text-base font-bold text-ink leading-tight">
              {activeDepotObj?.name || 'Central Logistics Hub'}
            </h1>
          </div>
        </div>

        {/* Depot Switcher if Admin/Manager */}
        {!isDepotRole(currentUser.role) && (
          <select
            value={selectedDepotId}
            onChange={(e) => setSelectedDepotId(e.target.value)}
            className="rounded-full border border-line bg-surface px-3.5 py-1.5 min-h-11 sm:min-h-0 text-xs text-ink focus:outline-none focus:border-primary"
          >
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name.split(' ')[0]} Hub
              </option>
            ))}
          </select>
        )}
      </div>

      {actionError && (
        <div className="rounded-2xl border border-danger-border bg-danger-soft px-3 py-2 text-xs text-danger flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Touch-Friendly Workflow Navigation Tabs */}
      <div className="grid grid-cols-3 gap-2 bg-surface p-1.5 rounded-2xl border border-line">
        <button
          onClick={() => setActiveTab('READY')}
          className={`py-2.5 rounded-full text-xs font-bold transition-all flex flex-col items-center gap-0.5 ${
            activeTab === 'READY'
              ? 'bg-warning text-white shadow-xs'
              : 'text-ink-secondary hover:text-ink'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Boxes className="h-4 w-4" />
            <span>1. Pick Items</span>
          </div>
          <span className="text-[10px] font-mono opacity-80">{readyToPick.length} pending</span>
        </button>

        <button
          onClick={() => setActiveTab('PACKING')}
          className={`py-2.5 rounded-full text-xs font-bold transition-all flex flex-col items-center gap-0.5 ${
            activeTab === 'PACKING'
              ? 'bg-orange text-white shadow-xs'
              : 'text-ink-secondary hover:text-ink'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Package className="h-4 w-4" />
            <span>2. Pack & Photo</span>
          </div>
          <span className="text-[10px] font-mono opacity-80">{inPacking.length} in queue</span>
        </button>

        <button
          onClick={() => setActiveTab('DISPATCH')}
          className={`py-2.5 rounded-full text-xs font-bold transition-all flex flex-col items-center gap-0.5 ${
            activeTab === 'DISPATCH'
              ? 'bg-primary text-white shadow-xs'
              : 'text-ink-secondary hover:text-ink'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Truck className="h-4 w-4" />
            <span>3. Dispatched</span>
          </div>
          <span className="text-[10px] font-mono opacity-80">{dispatched.length} shipped</span>
        </button>
      </div>

      {/* Queue 1: Ready to Pick */}
      {activeTab === 'READY' && (
        <div className="space-y-3">
          {readyToPick.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-line text-muted text-xs shadow-xs">
              <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2" />
              <span>No pending orders waiting to be picked at this depot.</span>
            </div>
          ) : (
            readyToPick.map((inv) => (
              <div
                key={inv.id}
                className="bg-white p-4 rounded-2xl border border-line space-y-3 shadow-xs hover:border-primary/30 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-mono font-bold text-warning bg-warning-soft px-2 py-0.5 rounded border border-warning-border">
                      NEW ORDER • READY TO PICK
                    </span>
                    <h3 className="text-sm font-bold text-ink mt-1.5">{inv.customerCompany}</h3>
                    <p className="text-xs font-mono text-muted">Invoice: {inv.invoiceNumber}</p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedInvoice(inv);
                      setIsSlipOpen(true);
                    }}
                    title="Print Pick List"
                    className="p-2 text-ink-secondary hover:text-ink rounded-full bg-surface border border-line"
                  >
                    <Printer className="h-4 w-4" />
                  </button>
                </div>

                {/* Items to Pick */}
                <div className="p-3 rounded-xl bg-surface border border-line space-y-2">
                  <div className="text-[11px] font-bold uppercase text-muted font-mono">
                    Items & Serial Allocations:
                  </div>
                  {(inv.items || []).map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-line last:border-0">
                      <div>
                        <span className="font-semibold text-ink">{item.productName}</span>
                        {item.allocatedSerials && item.allocatedSerials.length > 0 && (
                          <div className="text-[10px] font-mono text-primary mt-0.5">
                            Allocate Serials: {item.allocatedSerials.join(', ')}
                          </div>
                        )}
                      </div>
                      <span className="font-mono font-bold text-success bg-success-soft px-2 py-0.5 rounded">
                        Qty: {item.quantity}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="px-3 py-2 min-h-11 sm:min-h-0 rounded-full bg-surface hover:bg-line text-xs text-ink-secondary hover:text-ink font-medium border border-line"
                  >
                    View Details
                  </Link>
                  <button
                    onClick={() => handlePickOrder(inv)}
                    disabled={busyInvoiceId === inv.id}
                    className="flex items-center gap-1.5 px-5 py-2 min-h-11 sm:min-h-0 rounded-full bg-primary hover:bg-primary-hover text-white text-xs font-bold transition-all"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{busyInvoiceId === inv.id ? 'Saving…' : 'Confirm Pick & Move to Packing'}</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Queue 2: Packing & Camera Inspection */}
      {activeTab === 'PACKING' && (
        <div className="space-y-3">
          {inPacking.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-line text-muted text-xs shadow-xs">
              <span>No orders currently on the packing tables.</span>
            </div>
          ) : (
            inPacking.map((inv) => (
              <div
                key={inv.id}
                className="bg-white p-4 rounded-2xl border border-line space-y-3 shadow-xs hover:border-primary/30 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-mono font-bold text-orange bg-orange-soft px-2 py-0.5 rounded border border-orange/20">
                      {inv.fulfilmentStatus === 'PACKED' ? 'PACKED • READY FOR AWB' : 'PACKING IN PROGRESS'}
                    </span>
                    <h3 className="text-sm font-bold text-ink mt-1.5">{inv.customerCompany}</h3>
                    <p className="text-xs font-mono text-muted">Invoice: {inv.invoiceNumber}</p>
                  </div>
                </div>

                {/* Direct Action Bar */}
                <div className="p-3 rounded-xl bg-surface border border-line space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Box Photo Inspection:</span>
                    <button
                      onClick={() => {
                        setSelectedInvoice(inv);
                        setIsCameraUploadOpen(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-line hover:bg-line text-primary font-semibold text-[11px]"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      <span>Take Photo / Upload</span>
                    </button>
                  </div>

                  {inv.fulfilmentStatus !== 'PACKED' ? (
                    <button
                      onClick={() => handlePackOrder(inv)}
                      disabled={busyInvoiceId === inv.id}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full bg-orange hover:bg-orange-hover text-white font-bold text-xs"
                    >
                      <Package className="h-4 w-4" />
                      <span>{busyInvoiceId === inv.id ? 'Saving…' : 'Mark Packed & Verified'}</span>
                    </button>
                  ) : (
                    <div className="space-y-2 pt-2 border-t border-line">
                      <label className="block text-[11px] font-medium text-ink-secondary">
                        Quick Airway Bill Dispatch:
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="e.g. DHL-9482103847"
                          value={awbInput}
                          onChange={(e) => setAwbInput(e.target.value)}
                          className="flex-1 rounded-full border border-line bg-white px-3.5 py-1.5 min-h-11 sm:min-h-0 text-xs text-ink font-mono focus:border-primary focus:outline-none"
                        />
                        <button
                          onClick={() => handleQuickShip(inv)}
                          disabled={busyInvoiceId === inv.id}
                          className="px-4 py-1.5 min-h-11 sm:min-h-0 rounded-full bg-primary hover:bg-primary-hover text-white font-bold text-xs whitespace-nowrap"
                        >
                          {busyInvoiceId === inv.id ? 'Shipping…' : 'Ship AWB'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Queue 3: Dispatched & In Transit */}
      {activeTab === 'DISPATCH' && (
        <div className="space-y-3">
          {dispatched.map((inv) => (
            <div
              key={inv.id}
              className="bg-white p-4 rounded-2xl border border-line space-y-2 text-xs shadow-xs"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-bold text-ink">{inv.customerCompany}</h4>
                  <p className="font-mono text-muted text-[11px]">Invoice: {inv.invoiceNumber}</p>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-success-soft text-success border border-success-border">
                  {inv.fulfilmentStatus}
                </span>
              </div>
              <p className="text-[11px] text-muted">{inv.shippingAddress}</p>
              <div className="pt-2 flex justify-end">
                <Link
                  href={`/invoices/${inv.id}`}
                  className="text-[11px] text-primary hover:underline font-semibold flex items-center gap-1"
                >
                  <span>View Shipment Tracking</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Camera / Document Modal */}
      {isCameraUploadOpen && selectedInvoice && (
        <CloudinaryUploadModal
          isOpen={true}
          onClose={() => setIsCameraUploadOpen(false)}
          onUploaded={() => loadData()}
          defaultCategory="PACKING_LIST"
          defaultEntityType="INVOICE"
          defaultEntityId={selectedInvoice.id}
          defaultEntityLabel={selectedInvoice.invoiceNumber}
        />
      )}

      {/* Pick List Modal */}
      {isSlipOpen && selectedInvoice && (
        <PrintableDocumentModal
          isOpen={true}
          onClose={() => setIsSlipOpen(false)}
          documentType="PACKING_LIST"
          data={selectedInvoice}
        />
      )}
    </div>
  );
}
