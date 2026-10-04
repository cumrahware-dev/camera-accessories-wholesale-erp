'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { hasPermission } from '@/lib/rbac';
import { getCurrentUserCachedSync, fetchCurrentUserCached } from '@/lib/client-cache';

interface Tpl { key: string; label: string; subject: string; body: string; customized: boolean; defaults: { subject: string; body: string } }

const SAMPLE: Record<string, string> = {
  customer_name: 'ABC Trading LLC', company_name: 'ARIB GLOBAL', document_number: 'INV-2026-01024', document_date: '03 Oct 2026',
  due_date: '02 Nov 2026', total: '5,250.00', currency: 'USD', payment_terms: 'NET 30', document_type: 'Tax Invoice',
};
const fill = (t: string) => t.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => SAMPLE[k] ?? m);

export default function EmailTemplatesPage() {
  const { toast } = useToast();
  const [role, setRole] = useState<string | undefined>(() => getCurrentUserCachedSync()?.user?.role);
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [variables, setVariables] = useState<string[]>([]);
  const [active, setActive] = useState<string>('PROFORMA');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCurrentUserCached().then((a: any) => a?.user?.role && setRole(a.user.role)).catch(() => {});
    fetch('/api/email/templates', { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; })
      .then((j) => { setTemplates(j.templates); setVariables(j.variables); })
      .catch((e) => setError(e.message || 'Could not load templates.'));
  }, []);

  const current = useMemo(() => templates.find((t) => t.key === active), [templates, active]);
  useEffect(() => { if (current) { setSubject(current.subject); setBody(current.body); } }, [current]);
  const canEdit = hasPermission(role, 'settings.write');
  const dirty = !!current && (subject !== current.subject || body !== current.body);

  const save = async (reset = false) => {
    if (!current) return;
    setSaving(true);
    try {
      const res = await fetch('/api/email/templates', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { key: current.key, reset: true } : { key: current.key, subject, body }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Save failed');
      setTemplates((ts) => ts.map((t) => (t.key === current.key ? { ...t, subject: j.subject, body: j.body, customized: j.customized } : t)));
      toast({ title: reset ? 'Template reset to default' : 'Template saved', variant: 'success' });
    } catch (e: any) {
      toast({ title: e.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-16">
      <PageHeader
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Email Templates' }]}
        title="Email Templates"
        description="The default subject and message used when documents are emailed to customers. Staff can still edit the text before each send."
      />
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {templates.map((t) => (
          <button key={t.key} onClick={() => setActive(t.key)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium min-h-[36px] ${t.key === active ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink-secondary hover:bg-surface-muted'}`}>
            {t.label}{t.customized ? ' •' : ''}
          </button>
        ))}
      </div>

      {current && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">{current.label}</h3>
              <Badge tone={current.customized ? 'primary' : 'neutral'}>{current.customized ? 'Customized' : 'Default'}</Badge>
            </div>
            <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit} />
            <Textarea label="Message" value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit} className="min-h-[280px] font-sans" />
            <div className="text-xs text-muted">
              Variables: {variables.map((v) => <code key={v} className="mr-1.5 inline-block rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px]">{`{{${v}}}`}</code>)}
            </div>
            {canEdit && (
              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-line-soft">
                {current.customized && (
                  <Button variant="outline" iconLeft={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => save(true)} disabled={saving}>Reset to default</Button>
                )}
                <Button iconLeft={<Save className="h-3.5 w-3.5" />} onClick={() => save(false)} loading={saving} disabled={!dirty || !subject.trim() || !body.trim()}>Save template</Button>
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Preview (sample data)</h3>
            <div className="rounded-lg border border-line">
              <div className="border-b border-line px-4 py-2.5 text-sm"><span className="text-muted mr-2">Subject</span><span className="font-semibold text-ink">{fill(subject)}</span></div>
              <div className="px-4 py-4 text-sm text-ink whitespace-pre-wrap leading-relaxed">{fill(body)}</div>
            </div>
            <p className="text-xs text-muted">The PDF of the document is attached automatically, and a short summary (number, date, total) is added below the message.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
