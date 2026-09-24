'use client';

import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  TrendingUp,
  Package,
  Boxes,
  FileCheck2,
  Truck,
  BarChart3,
  PieChart,
  Users,
  Building2,
  Receipt,
  RotateCcw,
  Sparkles,
  Check,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export interface DashboardPreferences {
  // KPI Cards
  kpiRevenue: boolean;
  kpiProfit: boolean;
  kpiOrders: boolean;
  kpiInventory: boolean;
  kpiProformas: boolean;
  kpiShipments: boolean;

  // Sections & Widgets
  showRevenueProfitChart: boolean;
  showCategoryChart: boolean;
  showTopProducts: boolean;
  showTopCustomers: boolean;
  showDepotPerformance: boolean;
  showInvoicesQueue: boolean;
  showDispatchesQueue: boolean;
}

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = {
  kpiRevenue: true,
  kpiProfit: true,
  kpiOrders: true,
  kpiInventory: true,
  kpiProformas: true,
  kpiShipments: true,

  showRevenueProfitChart: true,
  showCategoryChart: true,
  showTopProducts: true,
  showTopCustomers: true,
  showDepotPerformance: true,
  showInvoicesQueue: true,
  showDispatchesQueue: true,
};

const PREFERENCES_STORAGE_KEY = 'erp_dashboard_customization_v1';

export function loadDashboardPreferences(): DashboardPreferences {
  if (typeof window === 'undefined') return DEFAULT_DASHBOARD_PREFERENCES;
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_DASHBOARD_PREFERENCES;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_DASHBOARD_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_DASHBOARD_PREFERENCES;
  }
}

export function saveDashboardPreferences(prefs: DashboardPreferences) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

export function isPreferencesModified(prefs: DashboardPreferences): boolean {
  return (Object.keys(DEFAULT_DASHBOARD_PREFERENCES) as Array<keyof DashboardPreferences>).some(
    (key) => prefs[key] !== DEFAULT_DASHBOARD_PREFERENCES[key]
  );
}

interface DashboardCustomizeModalProps {
  open: boolean;
  onClose: () => void;
  preferences: DashboardPreferences;
  onSave: (newPrefs: DashboardPreferences) => void;
  isDepotUser?: boolean;
}

export function DashboardCustomizeModal({
  open,
  onClose,
  preferences,
  onSave,
  isDepotUser = false,
}: DashboardCustomizeModalProps) {
  const [draft, setDraft] = useState<DashboardPreferences>(preferences);

  useEffect(() => {
    if (open) {
      setDraft(preferences);
    }
  }, [open, preferences]);

  const toggle = (key: keyof DashboardPreferences) => {
    setDraft((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const applyPreset = (preset: 'all' | 'sales' | 'ops' | 'minimal') => {
    if (preset === 'all') {
      setDraft(DEFAULT_DASHBOARD_PREFERENCES);
    } else if (preset === 'sales') {
      setDraft({
        kpiRevenue: true,
        kpiProfit: true,
        kpiOrders: true,
        kpiInventory: false,
        kpiProformas: true,
        kpiShipments: false,
        showRevenueProfitChart: true,
        showCategoryChart: true,
        showTopProducts: true,
        showTopCustomers: true,
        showDepotPerformance: false,
        showInvoicesQueue: true,
        showDispatchesQueue: false,
      });
    } else if (preset === 'ops') {
      setDraft({
        kpiRevenue: false,
        kpiProfit: false,
        kpiOrders: true,
        kpiInventory: true,
        kpiProformas: true,
        kpiShipments: true,
        showRevenueProfitChart: false,
        showCategoryChart: false,
        showTopProducts: false,
        showTopCustomers: false,
        showDepotPerformance: true,
        showInvoicesQueue: true,
        showDispatchesQueue: true,
      });
    } else if (preset === 'minimal') {
      setDraft({
        kpiRevenue: true,
        kpiProfit: true,
        kpiOrders: true,
        kpiInventory: false,
        kpiProformas: false,
        kpiShipments: false,
        showRevenueProfitChart: true,
        showCategoryChart: false,
        showTopProducts: false,
        showTopCustomers: false,
        showDepotPerformance: false,
        showInvoicesQueue: true,
        showDispatchesQueue: false,
      });
    }
  };

  const handleSave = () => {
    saveDashboardPreferences(draft);
    onSave(draft);
    onClose();
  };

  const handleReset = () => {
    setDraft(DEFAULT_DASHBOARD_PREFERENCES);
    saveDashboardPreferences(DEFAULT_DASHBOARD_PREFERENCES);
    onSave(DEFAULT_DASHBOARD_PREFERENCES);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customize Dashboard"
      description="Choose which metric cards and functional sections are displayed on your overview. You can select a role preset or customize individual elements."
      size="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            size="sm"
            variant="ghost"
            iconLeft={<RotateCcw className="h-3.5 w-3.5 text-slate-500" />}
            onClick={handleReset}
          >
            Reset to Defaults
          </Button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" iconLeft={<Check className="h-3.5 w-3.5" />} onClick={handleSave}>
              Save Layout
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6 py-1">
        {/* Quick Presets */}
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-2.5">
            <Sparkles className="h-3.5 w-3.5 text-brand-500" />
            Quick Role Presets
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => applyPreset('all')}
              className="flex flex-col items-start p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50/40 text-left transition-all group"
            >
              <span className="text-xs font-semibold text-slate-800 group-hover:text-brand-700">Executive (All)</span>
              <span className="text-[11px] text-slate-500">Every metric & queue</span>
            </button>

            {!isDepotUser && (
              <button
                type="button"
                onClick={() => applyPreset('sales')}
                className="flex flex-col items-start p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50/40 text-left transition-all group"
              >
                <span className="text-xs font-semibold text-slate-800 group-hover:text-brand-700">Sales Focus</span>
                <span className="text-[11px] text-slate-500">Revenue, margin & products</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => applyPreset('ops')}
              className="flex flex-col items-start p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50/40 text-left transition-all group"
            >
              <span className="text-xs font-semibold text-slate-800 group-hover:text-brand-700">Operations Focus</span>
              <span className="text-[11px] text-slate-500">Inventory, dispatches & hubs</span>
            </button>

            <button
              type="button"
              onClick={() => applyPreset('minimal')}
              className="flex flex-col items-start p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50/40 text-left transition-all group"
            >
              <span className="text-xs font-semibold text-slate-800 group-hover:text-brand-700">Minimalist</span>
              <span className="text-[11px] text-slate-500">Clean essential KPIs</span>
            </button>
          </div>
        </div>

        {/* KPI Cards Section */}
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Overview KPI Cards
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {!isDepotUser && (
              <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-md bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                    <DollarSign className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Revenue</div>
                    <div className="text-[11px] text-slate-500">Total gross invoiced</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.kpiRevenue}
                  onChange={() => toggle('kpiRevenue')}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
              </label>
            )}

            {!isDepotUser && (
              <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-md bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Gross Profit & Margin</div>
                    <div className="text-[11px] text-slate-500">Profit margin percentage</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.kpiProfit}
                  onChange={() => toggle('kpiProfit')}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
              </label>
            )}

            <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-md bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-600 shrink-0">
                  <Package className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-800">Orders</div>
                  <div className="text-[11px] text-slate-500">Fulfilled order count</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={draft.kpiOrders}
                onChange={() => toggle('kpiOrders')}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
              />
            </label>

            {!isDepotUser && (
              <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-md bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                    <Boxes className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Inventory Valuation</div>
                    <div className="text-[11px] text-slate-500">Stock units & value</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.kpiInventory}
                  onChange={() => toggle('kpiInventory')}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
              </label>
            )}

            <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-md bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shrink-0">
                  <FileCheck2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-800">Pending Proformas</div>
                  <div className="text-[11px] text-slate-500">Awaiting conversion</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={draft.kpiProformas}
                onChange={() => toggle('kpiProformas')}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-md bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                  <Truck className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-800">Pending Shipments</div>
                  <div className="text-[11px] text-slate-500">Active dispatches in transit</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={draft.kpiShipments}
                onChange={() => toggle('kpiShipments')}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* Dashboard Sections Section */}
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Dashboard Sections & Tables
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {!isDepotUser && (
              <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-md bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                    <BarChart3 className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Revenue & Profit Chart</div>
                    <div className="text-[11px] text-slate-500">Time-series bar and profit line</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.showRevenueProfitChart}
                  onChange={() => toggle('showRevenueProfitChart')}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
              </label>
            )}

            {!isDepotUser && (
              <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-md bg-cyan-50 border border-cyan-100 flex items-center justify-center text-cyan-600 shrink-0">
                    <PieChart className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Sales by Category</div>
                    <div className="text-[11px] text-slate-500">Distribution by optics & gear</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.showCategoryChart}
                  onChange={() => toggle('showCategoryChart')}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
              </label>
            )}

            {!isDepotUser && (
              <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-md bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                    <Package className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Top Products Ranking</div>
                    <div className="text-[11px] text-slate-500">Highest grossing SKUs and margins</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.showTopProducts}
                  onChange={() => toggle('showTopProducts')}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
              </label>
            )}

            {!isDepotUser && (
              <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-md bg-violet-50 border border-violet-100 flex items-center justify-center text-violet-600 shrink-0">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Top Customers Ranking</div>
                    <div className="text-[11px] text-slate-500">Leading wholesale accounts</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.showTopCustomers}
                  onChange={() => toggle('showTopCustomers')}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
              </label>
            )}

            {!isDepotUser && (
              <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-md bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 shrink-0">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Depot Hub Performance</div>
                    <div className="text-[11px] text-slate-500">Regional warehouse sales & stock</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.showDepotPerformance}
                  onChange={() => toggle('showDepotPerformance')}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
              </label>
            )}

            <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-md bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                  <Receipt className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-800">Tax Invoices Queue</div>
                  <div className="text-[11px] text-slate-500">Recent invoices & fulfilment status</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={draft.showInvoicesQueue}
                onChange={() => toggle('showInvoicesQueue')}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/80 cursor-pointer transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-md bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                  <Truck className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-800">Recent Dispatches Queue</div>
                  <div className="text-[11px] text-slate-500">Live courier tracking and AWBs</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={draft.showDispatchesQueue}
                onChange={() => toggle('showDispatchesQueue')}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
              />
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
}
