'use client';

import React, { useState, useEffect } from 'react';
import { Building2, CreditCard, FileText, Mail, Save, Cpu, Sparkles, Truck, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import ImageUploadField from '@/components/ui/ImageUploadField';
import { fetchSettingsCached, invalidateSettings } from '@/lib/client-cache';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

interface CompanySettings {
  id: string;
  companyName: string;
  tradingName: string;
  logoUrl: string;
  sealUrl?: string;
  taxRegistrationNumber: string;
  vatGstNumber: string;
  corporateTaxNumber?: string;
  tradeLicenceNumber?: string;
  dunsNumber?: string;
  companyAddress: string;
  phone: string;
  email: string;
  website: string;
  currency: string;
  currencySymbol: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  swiftBic: string;
  iban: string;
  routingCode: string;
  invoicePrefix: string;
  proformaPrefix: string;
  invoiceNextNumber: number;
  proformaNextNumber: number;
  defaultPaymentTerms: string;
  defaultDeliveryTerms: string;
  freightVolumetricDivisor: number;
  freightDefaultRatePerKg: number;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFromName: string;
  smtpFromEmail: string;
  updatedAt: Date;
}

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-6">
      <div className="flex items-start gap-2.5 mb-4">
        <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
          {description && <p className="text-sm text-muted mt-1">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [ocrStatus, setOcrStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadSettings = async () => {
    setLoadError(false);
    try {
      const [data, ocrRes] = await Promise.all([
        fetchSettingsCached(true),
        fetch('/api/ai/ocr-status').catch(() => null),
      ]);
      if (data) setSettings(data);
      else setLoadError(true);

      if (ocrRes && ocrRes.ok) {
        const ocrData = await ocrRes.json();
        setOcrStatus(ocrData);
      }
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Failed to save settings');
      invalidateSettings();
      toast({ title: 'Settings saved', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Could not save settings', description: err.message, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const set = (patch: Partial<CompanySettings>) => setSettings((s) => (s ? { ...s, ...patch } : s));

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 max-w-3xl">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadError || !settings) {
    return (
      <ErrorState
        title="Unable to load settings"
        description="We couldn't reach the settings service. Check your connection and try again."
        action={<Button onClick={loadSettings}>Try Again</Button>}
      />
    );
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-8 pb-16 max-w-3xl">
      <PageHeader
        title="Settings"
        description="Company identity, banking details, document numbering, and email delivery."
        actions={
          <Button type="submit" loading={isSaving} iconLeft={!isSaving ? <Save className="h-4 w-4" /> : undefined}>
            Save Changes
          </Button>
        }
      />

      <Section icon={Building2} title="Company" description="Legal entity details shown on invoices and proformas.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Company Legal Name"
            value={settings.companyName}
            onChange={(e) => set({ companyName: e.target.value })}
          />
          <Input
            label="Trading Name"
            value={settings.tradingName}
            onChange={(e) => set({ tradingName: e.target.value })}
          />
          <Input
            label="Registered Address"
            wrapperClassName="sm:col-span-2"
            value={settings.companyAddress}
            onChange={(e) => set({ companyAddress: e.target.value })}
          />
          <Input
            label="VAT Registration Number / TRN"
            value={settings.vatGstNumber || ''}
            onChange={(e) => set({ vatGstNumber: e.target.value })}
            placeholder="e.g. TRN-100889218200001"
          />
          <Input
            label="Corporate Tax Number"
            value={settings.corporateTaxNumber || ''}
            onChange={(e) => set({ corporateTaxNumber: e.target.value })}
            placeholder="e.g. CT-1009827361"
          />
          <Input
            label="Trade Licence Number"
            value={settings.tradeLicenceNumber || ''}
            onChange={(e) => set({ tradeLicenceNumber: e.target.value })}
            placeholder="e.g. TL-992810"
          />
          <Input
            label="D-U-N-S Number"
            value={settings.dunsNumber || ''}
            onChange={(e) => set({ dunsNumber: e.target.value })}
            placeholder="e.g. 12-345-6789"
          />
          <Input label="Phone" value={settings.phone} onChange={(e) => set({ phone: e.target.value })} />
          <Input label="Email" type="email" value={settings.email} onChange={(e) => set({ email: e.target.value })} />
          <Input
            label="Website"
            wrapperClassName="sm:col-span-2"
            value={settings.website}
            onChange={(e) => set({ website: e.target.value })}
          />
          <div className="sm:col-span-2">
            <ImageUploadField
              value={settings.logoUrl}
              onChange={(url) => set({ logoUrl: url })}
              label="Company Logo"
              placeholder="Paste a logo URL, or upload a PNG/SVG"
            />
          </div>

          <div className="sm:col-span-2 p-4 rounded-2xl bg-surface border border-line space-y-3">
            <div className="flex items-start gap-4">
              <div className="p-2.5 rounded-2xl bg-white border border-line shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={settings.sealUrl || '/arib-seal.png'}
                  alt="ARIB GLOBAL Official Company Seal"
                  className="h-20 w-20 object-contain"
                  style={{ aspectRatio: '1 / 1' }}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-ink uppercase tracking-wider">
                    Official Company Seal
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-success-soft text-success border border-success-border">
                    Smart Commercial Policy
                  </span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  Registered company stamp: <strong className="text-ink-secondary">ARIB GLOBAL GENERAL TRADING L.L.C • DUBAI - U.A.E.</strong> Affixed exclusively to legally binding financial documents.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] pt-1">
                  <div className="flex items-center gap-1.5 text-success">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    <span>Sealed: Tax Invoices & Confirmed Proformas</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted" />
                    <span>Omitted: Packing Slips & Draft Quotes</span>
                  </div>
                </div>
                <div className="text-[11px] text-muted font-mono pt-0.5">Asset: public/arib-seal.png (1024×1024 Hi-Res Transparent PNG)</div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section
        icon={CreditCard}
        title="Banking"
        description="Wire transfer instructions rendered on invoices and proformas."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Bank Name" wrapperClassName="sm:col-span-2" value={settings.bankName} onChange={(e) => set({ bankName: e.target.value })} />
          <Input label="Account Name" value={settings.accountName} onChange={(e) => set({ accountName: e.target.value })} />
          <Input label="Account Number" value={settings.accountNumber} onChange={(e) => set({ accountNumber: e.target.value })} />
          <Input label="SWIFT / BIC" value={settings.swiftBic} onChange={(e) => set({ swiftBic: e.target.value })} />
          <Input label="IBAN" value={settings.iban} onChange={(e) => set({ iban: e.target.value })} />
          <Input label="Routing Code" value={settings.routingCode} onChange={(e) => set({ routingCode: e.target.value })} />
        </div>
      </Section>

      <Section icon={FileText} title="Document Numbering" description="Prefixes and next sequence numbers for generated documents.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Invoice Prefix" value={settings.invoicePrefix} onChange={(e) => set({ invoicePrefix: e.target.value })} />
          <Input
            label="Next Invoice Number"
            type="number"
            min={1}
            value={settings.invoiceNextNumber}
            onChange={(e) => set({ invoiceNextNumber: Number(e.target.value) })}
          />
          <Input label="Proforma Prefix" value={settings.proformaPrefix} onChange={(e) => set({ proformaPrefix: e.target.value })} />
          <Input
            label="Next Proforma Number"
            type="number"
            min={1}
            value={settings.proformaNextNumber}
            onChange={(e) => set({ proformaNextNumber: Number(e.target.value) })}
          />
          <Input
            label="Default Payment Terms"
            wrapperClassName="sm:col-span-2"
            value={settings.defaultPaymentTerms}
            onChange={(e) => set({ defaultPaymentTerms: e.target.value })}
          />
          <Input
            label="Default Delivery Terms"
            wrapperClassName="sm:col-span-2"
            value={settings.defaultDeliveryTerms}
            onChange={(e) => set({ defaultDeliveryTerms: e.target.value })}
          />
        </div>
      </Section>

      <Section
        icon={Truck}
        title="Freight & Logistics"
        description="Defaults used by the freight calculator on Proformas and Tax Invoices. Nothing here is hardcoded in the app — change it any time as carrier terms change."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Volumetric Divisor"
            type="number"
            min={1}
            step="1"
            value={settings.freightVolumetricDivisor}
            onChange={(e) => set({ freightVolumetricDivisor: Number(e.target.value) })}
            hint="Standard air freight divisors are 5000 or 6000 (cm³ per chargeable kg)."
          />
          <Input
            label="Default Freight Rate ($ / kg)"
            type="number"
            min={0}
            step="0.01"
            value={settings.freightDefaultRatePerKg}
            onChange={(e) => set({ freightDefaultRatePerKg: Number(e.target.value) })}
            hint="Pre-fills the rate field; always editable per shipment."
          />
        </div>
      </Section>

      <Section icon={Mail} title="Email Delivery" description="SMTP credentials used to send proformas and invoices to customers.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="SMTP Host" value={settings.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} />
          <Input
            label="SMTP Port"
            type="number"
            value={settings.smtpPort}
            onChange={(e) => set({ smtpPort: Number(e.target.value) })}
          />
          <Input label="SMTP Username" value={settings.smtpUser} onChange={(e) => set({ smtpUser: e.target.value })} />
          <Input
            label="SMTP Password"
            type="password"
            value={settings.smtpPassword}
            onChange={(e) => set({ smtpPassword: e.target.value })}
            hint="Stored securely and never shown in documents."
          />
          <Input label="From Name" value={settings.smtpFromName} onChange={(e) => set({ smtpFromName: e.target.value })} />
          <Input
            label="From Email"
            type="email"
            value={settings.smtpFromEmail}
            onChange={(e) => set({ smtpFromEmail: e.target.value })}
          />
        </div>
      </Section>

      <Section
        icon={Cpu}
        title="OCR Document Extraction"
        description="Open-source OCR used to read invoices and quotations from PDFs and images. Extracted data is always reviewed before saving."
      >
        <div className="p-4 rounded-xl border border-line bg-surface-muted/30 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <div>
                <div className="text-sm font-semibold text-ink">External OCR service (Tesseract)</div>
                <div className="text-xs text-muted">
                  Runs as a separate service the ERP calls securely from the server.
                </div>
              </div>
            </div>
            {ocrStatus?.connected ? (
              <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>Connected</Badge>
            ) : (
              <Badge tone="danger" icon={<XCircle className="h-3 w-3" />}>OCR Service Not Connected</Badge>
            )}
          </div>
          {!ocrStatus?.connected && ocrStatus?.reason && (
            <div className="text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 px-3 py-2 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>Reason: {ocrStatus.reason}</span>
            </div>
          )}
          <div className="text-xs text-muted leading-relaxed">
            {ocrStatus?.detail ? <span className="block mb-1 font-mono text-ink">{ocrStatus.detail}</span> : null}
            <span className="font-semibold text-ink">Setup:</span> deploy <code className="bg-surface-muted px-1.5 py-0.5 rounded text-ink font-mono">ocr-service</code> and set <code className="bg-surface-muted px-1.5 py-0.5 rounded text-ink font-mono">OCR_API_URL</code> and <code className="bg-surface-muted px-1.5 py-0.5 rounded text-ink font-mono">OCR_API_KEY</code> in the ERP server environment.
          </div>
        </div>
      </Section>

      <div className="flex justify-end border-t border-line pt-5">
        <Button type="submit" loading={isSaving} iconLeft={!isSaving ? <Save className="h-4 w-4" /> : undefined}>
          Save Changes
        </Button>
      </div>
    </form>
  );
}
