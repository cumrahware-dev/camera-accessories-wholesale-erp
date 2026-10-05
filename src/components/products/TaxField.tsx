'use client';

import React from 'react';
import { useDefaultTax } from '@/lib/default-tax-client';

/**
 * Product tax: follow the configured default tax (Settings -> Company & Business Details -> Tax Rates) or use a custom rate.
 * No rate is assumed here; the default is read from the database.
 */
export function TaxField({ useDefaultTax: useDefault, rate, onChange, disabled }: { useDefaultTax: boolean; rate: number; onChange: (v: { useDefaultTax: boolean; taxRate: number }) => void; disabled?: boolean }) {
  const def = useDefaultTax();
  const fieldCls = 'h-11 md:h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:opacity-50';
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="product-tax-mode" className="text-xs font-medium text-ink">Tax</label>
      <select
        id="product-tax-mode"
        aria-label="Tax"
        className={fieldCls}
        disabled={disabled}
        value={useDefault ? 'DEFAULT' : 'CUSTOM'}
        onChange={(e) => (e.target.value === 'DEFAULT' ? onChange({ useDefaultTax: true, taxRate: def.rate }) : onChange({ useDefaultTax: false, taxRate: rate }))}
      >
        <option value="DEFAULT">{def.loaded ? `Default tax (${def.name} ${def.rate}%)` : 'Default tax'}</option>
        <option value="CUSTOM">Custom rate…</option>
      </select>
      {!useDefault && (
        <input
          aria-label="Custom tax rate (%)"
          type="number" min={0} max={100} step="0.01" inputMode="decimal"
          className={fieldCls}
          disabled={disabled}
          value={Number.isFinite(rate) ? rate : 0}
          onChange={(e) => onChange({ useDefaultTax: false, taxRate: Number(e.target.value) })}
        />
      )}
      <span className="text-[11px] text-muted">{useDefault ? 'Follows the default tax; changes automatically when the default changes.' : 'A custom rate set on purpose for this product.'}</span>
    </div>
  );
}
