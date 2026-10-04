'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, KeyRound } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

/**
 * Shows a secret that exists only in this one response (a new depot access code or a temporary password).
 * The value is held in component state only: it is not written to storage, the URL or the console, and it is
 * gone as soon as the dialog is closed. There is no way to show it again; generate a new one instead.
 */
export function SecretModal({
  open, onClose, title, label, value, hint,
}: {
  open: boolean; onClose: () => void; title: string; label: string; value: string; hint?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (open) { setCopied(false); setSaved(false); } }, [open, value]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* user can select the text */ }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (saved) onClose(); }}
      title={title}
      size="md"
      footer={<Button onClick={onClose} disabled={!saved}>Done</Button>}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft p-3 text-xs text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>This {label.toLowerCase()} is shown <strong>only once</strong>. It cannot be viewed again later: copy it now and share it securely.</span>
        </div>
        <div>
          <div className="text-xs font-semibold text-ink-secondary mb-1.5">{label}</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 rounded-xl border border-line bg-surface px-4 py-3 font-mono text-base sm:text-lg font-semibold tracking-wider text-ink break-all select-all">
              <KeyRound className="inline h-4 w-4 mr-2 text-primary align-[-2px]" />{value}
            </div>
            <Button variant="outline" onClick={copy} iconLeft={copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {hint && <p className="text-xs text-muted mt-2">{hint}</p>}
        </div>
        <label className="flex items-center gap-2.5 text-sm text-ink cursor-pointer select-none">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4" />
          I have copied it and stored it safely
        </label>
      </div>
    </Modal>
  );
}
