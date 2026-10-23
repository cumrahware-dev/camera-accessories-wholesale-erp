'use client';

import React, { useEffect, useRef, useState } from 'react';
import { QTY_DECIMALS, formatQty } from '@/lib/quantity';

/**
 * Quantity field for decimal quantities (54.620 Mt). It keeps what the person types ("54." and "54.0" stay as typed while
 * editing), accepts a pasted "1,234.500", never rounds to a whole number, limits the decimals to the unit's, and reports a
 * number only when the text is a valid quantity. On leaving the field the text is tidied to the unit's decimals ("54.62" -> "54.620").
 */
export function QuantityInput({ value, onChange, decimals = QTY_DECIMALS, min = 0, className, disabled, id, 'aria-label': ariaLabel, onInvalid }: {
  value: number | string;
  onChange: (n: number) => void;
  /** decimal places the unit allows (0 for Pcs, 3 for Mt/Kg ...) */
  decimals?: number;
  min?: number;
  className?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  onInvalid?: (message: string | null) => void;
}) {
  const dp = Math.min(QTY_DECIMALS, Math.max(0, decimals));
  const show = (v: number | string) => (v === '' || v === null || v === undefined ? '' : formatQty(v, dp).replace(/,/g, ''));
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  // follow changes made from outside (a different document loaded, quantity raised by "Add" again) but never while typing
  useEffect(() => { if (!focused.current) setText(show(value)); }, [value, dp]); // eslint-disable-line react-hooks/exhaustive-deps

  const accept = (raw: string) => {
    const t = raw.replace(/,/g, '').trim();
    if (t === '' || t === '.') { setText(t); onInvalid?.('Enter a quantity.'); return; }
    if (!/^\d*\.?\d*$/.test(t)) return; // ignore characters that are not part of a number
    if (dp === 0 && t.includes('.')) { onInvalid?.('This unit is sold in whole numbers.'); return; }
    const frac = t.split('.')[1] ?? '';
    if (frac.length > dp) { onInvalid?.(dp === 0 ? 'This unit is sold in whole numbers.' : `At most ${dp} decimal place${dp === 1 ? '' : 's'} for this unit.`); return; }
    setText(t);
    const n = Number(t);
    if (!Number.isFinite(n) || n < min || (min === 0 && n === 0)) { onInvalid?.('Quantity must be greater than 0.'); return; }
    onInvalid?.(null);
    onChange(n);
  };

  return (
    <input
      id={id}
      aria-label={ariaLabel}
      type="text"
      inputMode={dp === 0 ? 'numeric' : 'decimal'}
      autoComplete="off"
      disabled={disabled}
      value={text}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(show(value)); onInvalid?.(null); }}
      onChange={(e) => accept(e.target.value)}
      onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); accept(t); } }}
      className={className}
    />
  );
}
