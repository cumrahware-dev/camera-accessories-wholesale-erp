'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Indicator, Level, reviewIndicators } from '@/lib/ocr/review-state';

const STYLE: Record<Level, { box: string; icon: React.ReactNode; word: string }> = {
  ok: { box: 'border-line bg-white', icon: <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />, word: 'OK' },
  review: { box: 'border-warning-border bg-warning-soft', icon: <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />, word: 'Review' },
  missing: { box: 'border-danger-border bg-danger-soft', icon: <CircleAlert className="h-4 w-4 text-danger" aria-hidden />, word: 'Needs input' },
};

/**
 * One indicator per thing a reviewer must trust. Yellow means "look at it", not "error"; red means conversion is
 * blocked until it is supplied. Confirming a yellow header field records that a person checked it.
 */
export function ReviewSummary({ doc, check, canConfirm, onConfirm, onJump }: {
  doc: any; check: any; canConfirm: boolean; onConfirm: (fields: string[]) => void; onJump: (i: Indicator) => void;
}) {
  const items = reviewIndicators(doc, check);
  const open = items.filter((i) => i.level !== 'ok').length;
  return (
    <Card>
      <CardHeader><CardTitle>Review checklist {open > 0 ? <span className="ml-1 text-xs font-medium text-warning">{open} to check</span> : <span className="ml-1 text-xs font-medium text-success">all clear</span>}</CardTitle></CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((i) => {
            const st = STYLE[i.level];
            const confirmable = canConfirm && i.level === 'review' && i.field && (doc.reviewFields ?? []).includes(i.field);
            return (
              <li key={i.key} className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${st.box}`}>
                <span className="mt-0.5 shrink-0">{st.icon}</span>
                <button type="button" onClick={() => onJump(i)} className="min-w-0 flex-1 text-left">
                  <span className="block font-semibold text-ink">{i.label} <span className="font-normal text-muted">· {st.word}</span></span>
                  <span className="block break-words text-ink-secondary">{i.detail}</span>
                </button>
                {confirmable && <Button size="sm" variant="outline" onClick={() => onConfirm([i.field!])}>Confirm</Button>}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11px] text-muted">These checks use matching and arithmetic, not only OCR confidence: a clearly read number can still be the wrong number.</p>
      </CardContent>
    </Card>
  );
}
