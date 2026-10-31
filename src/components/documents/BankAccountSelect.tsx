'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  Search,
  X,
  AlertTriangle,
  CreditCard,
  Check,
  Loader2,
  Landmark,
} from 'lucide-react';
import { BankAccountOption } from '@/types/erp';

/**
 * "Select Bank Account" picker for Proforma Invoices (and future documents).
 *
 * Lists every ACTIVE bank account, not just ones in the document's own currency: a settlement account in a
 * different currency than the invoice is a legitimate choice (e.g. a USD invoice paid into an AED account),
 * and the invoice's own currency must never be forced to change just to make an account selectable — that
 * exact coupling is what mislabelled PF-2026-00005 as AED when every line amount was still in USD. Same-currency
 * accounts are listed first; a cross-currency account shows a small "Different currency" badge, informational
 * only — picking one never blocks the save and never touches the document's currency field.
 *
 * - Searchable dropdown (bank name, account name, account number, IBAN).
 * - Rich option entries: bank name, account holder, account number, currency, IBAN.
 * - Prominent "Bank Account Details" summary card below the dropdown after selection.
 * - Empty states, loading state, error handling, click-outside and keyboard dismissal.
 */
export function BankAccountSelect({
  currency,
  value,
  onChange,
  disabled = false,
  required = true,
  label = 'Select Bank Account',
}: {
  currency: string;
  value: string | null | undefined;
  onChange: (bankAccountId: string | null, account: BankAccountOption | null) => void;
  disabled?: boolean;
  required?: boolean;
  label?: string;
}) {
  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const docCurrency = (currency || 'USD').toUpperCase();

  // Fetch every ACTIVE account, regardless of currency — the document's currency is never used to filter
  // out an otherwise-legitimate account. Same-currency accounts are sorted first for convenience only.
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');

    fetch('/api/bank-accounts', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load bank accounts.'))))
      .then((rows: BankAccountOption[]) => {
        if (!live) return;
        setAccounts(Array.isArray(rows) ? rows : []);
      })
      .catch((e) => {
        if (live) setError(e.message || 'Could not load bank accounts.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accounts list doesn't depend on currency; only sort order does, handled below
  }, []);

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      const aMatch = (a.currency || '').toUpperCase() === docCurrency ? 0 : 1;
      const bMatch = (b.currency || '').toUpperCase() === docCurrency ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return 0;
    });
  }, [accounts, docCurrency]);

  // Find currently selected account
  const selected = useMemo(() => accounts.find((a) => a.id === value) || null, [accounts, value]);
  const selectedMismatch = Boolean(selected && (selected.currency || '').toUpperCase() !== docCurrency);

  // Filter accounts by search query
  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedAccounts;
    return sortedAccounts.filter((a) => {
      const matchBank = a.bankName?.toLowerCase().includes(q);
      const matchHolder = (a.accountName || a.label)?.toLowerCase().includes(q);
      const matchNumber = a.accountNumber?.toLowerCase().includes(q) || a.accountNumberMasked?.toLowerCase().includes(q);
      const matchIban = a.iban?.toLowerCase().includes(q);
      const matchBranch = a.branch?.toLowerCase().includes(q);
      return matchBank || matchHolder || matchNumber || matchIban || matchBranch;
    });
  }, [sortedAccounts, searchQuery]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Click outside and escape key listener to close popover
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectAccount = (account: BankAccountOption) => {
    onChange(account.id, account);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onChange(null, null);
  };

  return (
    <div className="flex flex-col gap-2 relative w-full" ref={containerRef}>
      {/* Label */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-ink flex items-center gap-1">
          <Landmark className="h-3.5 w-3.5 text-primary" />
          <span>{label}</span>
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
        {selected && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="text-[11px] text-muted hover:text-danger transition-colors font-medium cursor-pointer"
          >
            Clear selection
          </button>
        )}
      </div>

      {/* Cross-currency notice: informational only — the selection and the invoice currency both stand as chosen. */}
      {selectedMismatch && selected && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2.5 shadow-xs">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-amber-950">Different currency account selected</div>
            <p className="text-[11.5px] text-amber-800 mt-0.5 leading-relaxed">
              This is a {selected.currency} account on a {docCurrency} document. That&apos;s fine for settlement — the invoice
              itself, its totals and amount in words stay in {docCurrency}. Only the bank details section will show {selected.currency}.
            </p>
          </div>
        </div>
      )}

      {/* Dropdown Trigger Button */}
      <div className="relative">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => setIsOpen((prev) => !prev)}
          className={`h-11 md:h-10 w-full rounded-lg border text-left px-3 text-sm transition-all flex items-center justify-between gap-2 shadow-xs cursor-pointer ${
            disabled
              ? 'bg-surface-muted text-muted cursor-not-allowed border-line-soft opacity-60'
              : isOpen
              ? 'border-primary ring-2 ring-primary-ring bg-surface'
              : 'border-line bg-surface hover:border-ink-secondary/40 text-ink'
          }`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {loading ? (
              <span className="flex items-center gap-2 text-muted text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Loading bank accounts…
              </span>
            ) : selected ? (
              <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                <span className="font-semibold text-ink text-xs truncate">
                  {selected.bankName}
                </span>
                <span className="text-muted text-xs shrink-0">—</span>
                <span className="text-ink-secondary text-xs truncate">
                  {selected.accountName || selected.label}
                </span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-primary-soft text-primary shrink-0">
                  {selected.currency}
                </span>
                <span className="text-muted text-xs font-mono shrink-0 hidden sm:inline">
                  {selected.accountNumberMasked}
                </span>
              </div>
            ) : (
              <span className="text-muted text-xs truncate">
                Search and select a bank account…
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {selected && !disabled && (
              <span
                role="button"
                tabIndex={0}
                onClick={handleClear}
                className="p-1 text-muted hover:text-danger rounded-md transition-colors"
                title="Clear selection"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronDown
              className={`h-4 w-4 text-muted transition-transform duration-200 ${
                isOpen ? 'rotate-180 text-primary' : ''
              }`}
            />
          </div>
        </button>

        {/* Searchable Dropdown Popover */}
        {isOpen && (
          <div
            className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border border-line bg-white shadow-xl overflow-hidden animate-fade-in flex flex-col max-h-80"
            role="listbox"
          >
            {/* Search Input */}
            <div className="p-2.5 border-b border-line-soft bg-surface-muted/40 sticky top-0 z-10">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search by bank, holder, account no, IBAN…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-8 pl-8 pr-7 text-xs rounded-md border border-line bg-white text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Account List */}
            <div className="overflow-y-auto divide-y divide-line-soft py-1">
              {filteredAccounts.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted">
                  {accounts.length === 0 ? (
                    <div>
                      <p className="font-semibold text-ink">No active bank accounts</p>
                      <p className="text-[11px] text-muted mt-1">
                        Configure bank accounts under Settings &rsaquo; Company &amp; Business.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium text-ink">No matching accounts found</p>
                      <p className="text-[11px] text-muted mt-0.5">
                        Try searching with a different bank name or account number.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                filteredAccounts.map((account) => {
                  const isCurSelected = selected?.id === account.id;
                  const isCrossCurrency = (account.currency || '').toUpperCase() !== docCurrency;
                  return (
                    <div
                      key={account.id}
                      role="option"
                      aria-selected={isCurSelected}
                      onClick={() => handleSelectAccount(account)}
                      className={`p-3 text-xs cursor-pointer transition-colors flex items-start justify-between gap-3 ${
                        isCurSelected
                          ? 'bg-primary-soft/40 border-l-4 border-primary text-ink'
                          : 'hover:bg-surface-muted/70 text-ink'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        {/* Line 1: Bank Name + Currency Badge + Default Badge */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-ink text-xs">
                            {account.bankName}
                            {account.branch ? ` (${account.branch})` : ''}
                          </span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-primary-soft text-primary">
                            {account.currency}
                          </span>
                          {isCrossCurrency && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-amber-100 text-amber-800" title={`This account is in ${account.currency}, this document is in ${docCurrency}`}>
                              Different currency
                            </span>
                          )}
                          {account.isDefault && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-emerald-100 text-emerald-800">
                              Default
                            </span>
                          )}
                        </div>

                        {/* Line 2: Account Holder Name */}
                        <div className="text-[11.5px] text-ink-secondary truncate">
                          <span className="text-muted">Account Holder:</span>{' '}
                          <span className="font-medium text-ink">
                            {account.accountName || account.label}
                          </span>
                        </div>

                        {/* Line 3: Account Number & IBAN */}
                        <div className="text-[11px] text-muted font-mono flex items-center gap-2 flex-wrap">
                          <span>
                            A/c: <strong className="text-ink">{account.accountNumberMasked}</strong>
                          </span>
                          {account.iban && (
                            <span>
                              · IBAN: <strong className="text-ink">{account.iban}</strong>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Selected Indicator */}
                      {isCurSelected && (
                        <div className="shrink-0 text-primary mt-1">
                          <Check className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer with count */}
            <div className="p-2 border-t border-line-soft bg-surface text-[10.5px] text-muted flex items-center justify-between">
              <span>
                {filteredAccounts.length} of {accounts.length} active account{accounts.length === 1 ? '' : 's'} ({docCurrency} shown first)
              </span>
              <span className="text-[10px] text-muted font-mono">Press ESC to close</span>
            </div>
          </div>
        )}
      </div>

      {/* Error state */}
      {error && <span className="text-[11px] text-danger">{error}</span>}

      {/* Selected Bank Details Summary Card */}
      {selected && (
        <div className="rounded-xl border border-success-border/70 bg-gradient-to-br from-success-soft/30 to-surface p-3.5 space-y-2 text-xs shadow-xs animate-fade-in">
          <div className="flex items-center justify-between pb-2 border-b border-line-soft">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
              <span className="font-bold text-ink text-xs">{selected.bankName}</span>
              {selected.branch && (
                <span className="text-[11px] text-muted">— {selected.branch}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-success text-white">
                {selected.currency}
              </span>
              {selected.isDefault && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-emerald-100 text-emerald-800">
                  Default
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px] pt-0.5">
            <div>
              <span className="text-muted block text-[10px] uppercase font-semibold">Account Holder</span>
              <span className="font-medium text-ink">{selected.accountName || selected.label}</span>
            </div>
            <div>
              <span className="text-muted block text-[10px] uppercase font-semibold">Account Number</span>
              <span className="font-mono font-medium text-ink">{selected.accountNumberMasked}</span>
            </div>
            {selected.iban && (
              <div className="sm:col-span-2">
                <span className="text-muted block text-[10px] uppercase font-semibold">IBAN</span>
                <span className="font-mono font-semibold text-ink tracking-wide">{selected.iban}</span>
              </div>
            )}
            {selected.swiftBic && (
              <div>
                <span className="text-muted block text-[10px] uppercase font-semibold">SWIFT / BIC</span>
                <span className="font-mono font-medium text-ink">{selected.swiftBic}</span>
              </div>
            )}
            {selected.bankAddress && (
              <div>
                <span className="text-muted block text-[10px] uppercase font-semibold">Bank Address</span>
                <span className="text-ink-secondary text-[11px] line-clamp-2">{selected.bankAddress}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unselected Empty State */}
      {!selected && !loading && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted px-1">
          <CreditCard className="h-3.5 w-3.5 text-muted shrink-0" />
          <span>
            {required ? (
              <strong className="text-warning font-semibold">No bank account selected. Required before issuing this proforma.</strong>
            ) : (
              'No bank account selected yet. Required before confirming or issuing.'
            )}
          </span>
        </div>
      )}
    </div>
  );
}
