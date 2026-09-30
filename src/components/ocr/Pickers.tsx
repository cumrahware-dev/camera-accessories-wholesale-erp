'use client';

import React, { useEffect, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useDebounce } from '@/hooks/useDebounce';

export interface Cand { id: string; label: string; sub: string; score?: number; reason?: string }

/** Existing-record search list shared by product / customer / supplier pickers. */
function SearchList({ fetcher, suggestions, onPick, placeholder }: { fetcher: (q: string) => Promise<Cand[]>; suggestions: Cand[]; onPick: (c: Cand) => void; placeholder: string }) {
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 250);
  const [results, setResults] = useState<Cand[] | null>(null);
  useEffect(() => {
    if (!dq.trim()) { setResults(null); return; }
    let alive = true;
    fetcher(dq.trim()).then((r) => alive && setResults(r)).catch(() => alive && setResults([]));
    return () => { alive = false; };
  }, [dq, fetcher]);
  const list = results ?? suggestions;
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-11 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-ring" />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{results ? 'Search results' : 'Suggested matches'}</p>
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">{results ? 'Nothing found. Try another search or create a new record.' : 'No similar records found. Search above or create a new one.'}</p>
      ) : (
        <ul className="max-h-64 divide-y divide-line-soft overflow-y-auto rounded-lg border border-line">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c)} className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface">
                <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{c.label}</span><span className="block truncate text-xs text-muted">{c.sub}</span></span>
                {c.score !== undefined && <Badge tone={c.score >= 0.95 ? 'success' : 'warning'}>{Math.round(c.score * 100)}% · {c.reason}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not create the record.');
  return j;
}

const productFetcher = async (q: string): Promise<Cand[]> => {
  const r = await fetch(`/api/products?q=${encodeURIComponent(q)}&limit=20`);
  const j = await r.json();
  return (Array.isArray(j) ? j : j.products ?? []).map((p: any) => ({ id: p.id, label: p.name, sub: `${p.sku} · ${p.brand}` }));
};
const customerFetcher = async (q: string): Promise<Cand[]> => {
  const r = await fetch(`/api/customers?q=${encodeURIComponent(q)}`);
  const j = await r.json();
  return (Array.isArray(j) ? j : []).slice(0, 20).map((c: any) => ({ id: c.id, label: c.companyName, sub: `${c.customerCode} · ${c.email}` }));
};
const supplierFetcher = async (q: string): Promise<Cand[]> => {
  const r = await fetch(`/api/suppliers?q=${encodeURIComponent(q)}`);
  const j = await r.json();
  return (Array.isArray(j) ? j : []).slice(0, 20).map((s: any) => ({ id: s.id, label: s.name, sub: `${s.contactPerson || ''} · ${s.email}` }));
};

type Tab = 'select' | 'create';
function TabBar({ tab, setTab, canCreate, noun }: { tab: Tab; setTab: (t: Tab) => void; canCreate: boolean; noun: string }) {
  return (
    <div className="mb-4 flex gap-1 rounded-full bg-surface-muted p-1 text-xs font-medium">
      {(['select', 'create'] as Tab[]).map((t) => (
        <button key={t} type="button" disabled={t === 'create' && !canCreate} onClick={() => setTab(t)} className={`flex-1 rounded-full px-3 py-2.5 md:py-1.5 disabled:opacity-40 ${tab === t ? 'bg-white text-ink shadow-card' : 'text-muted'}`}>
          {t === 'select' ? `Select existing ${noun}` : `Create new ${noun}`}
        </button>
      ))}
    </div>
  );
}

export function ProductPickerModal({ open, onClose, line, suggestions, canCreate, onPick }: { open: boolean; onClose: () => void; line: { description: string; sku: string; unitPrice: string }; suggestions: Cand[]; canCreate: boolean; onPick: (c: Cand) => void }) {
  const [tab, setTab] = useState<Tab>('select');
  const [f, setF] = useState({ name: '', sku: '', brand: '', price: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTab('select'); setErr(''); setF({ name: line.description, sku: line.sku, brand: '', price: line.unitPrice }); } }, [open]); // eslint-disable-line
  const create = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const j = await postJson('/api/products', { name: f.name, sku: f.sku, brand: f.brand, wholesalePrice: Number(f.price) || 0, sellingPrice: Number(f.price) || 0 });
      const p = j.product;
      onPick({ id: p.id, label: p.name, sub: `${p.sku} · ${p.brand}` });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Match product" description="Products are never created automatically. Choose an existing product or create one." size="lg"
      footer={tab === 'create' ? <><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={create} loading={busy} disabled={!f.name.trim() || !f.sku.trim() || !f.brand.trim()}>Create & use product</Button></> : <Button variant="outline" onClick={onClose}>Leave unmatched</Button>}>
      <TabBar tab={tab} setTab={setTab} canCreate={canCreate} noun="product" />
      {tab === 'select' ? <SearchList fetcher={productFetcher} suggestions={suggestions} onPick={onPick} placeholder="Search by name, SKU or brand" /> : (
        <div className="space-y-3">
          <Input id="pk-name" label="Product name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input id="pk-sku" label="SKU" required value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
            <Input id="pk-brand" label="Brand" required value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
          </div>
          <Input id="pk-price" label="Price" type="number" min="0" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} hint="Used as wholesale and selling price. You can refine it later in Products." />
          {err && <p role="alert" className="text-xs text-danger">{err}</p>}
        </div>
      )}
    </Modal>
  );
}

export function PartyPickerModal({ kind, open, onClose, initialName, initialEmail, suggestions, canCreate, onPick }: { kind: 'customer' | 'supplier'; open: boolean; onClose: () => void; initialName: string; initialEmail: string; suggestions: Cand[]; canCreate: boolean; onPick: (c: Cand) => void }) {
  const [tab, setTab] = useState<Tab>('select');
  const [f, setF] = useState({ name: '', email: '', phone: '', contact: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTab('select'); setErr(''); setF({ name: initialName, email: initialEmail, phone: '', contact: '' }); } }, [open]); // eslint-disable-line
  const create = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      if (kind === 'customer') {
        const c = await postJson('/api/customers', { companyName: f.name, contactPerson: f.contact || undefined, email: f.email, phone: f.phone || undefined });
        onPick({ id: c.id, label: c.companyName, sub: `${c.customerCode} · ${c.email}` });
      } else {
        const s = await postJson('/api/suppliers', { name: f.name, contactPerson: f.contact, email: f.email, phone: f.phone });
        onPick({ id: s.id, label: s.name, sub: s.email });
      }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const noun = kind === 'customer' ? 'customer' : 'supplier';
  return (
    <Modal open={open} onClose={onClose} title={`Match ${noun}`} description="Select an existing record to avoid duplicates. Create one only if it truly does not exist." size="lg"
      footer={tab === 'create' ? <><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={create} loading={busy} disabled={!f.name.trim() || !f.email.trim()}>Create & use {noun}</Button></> : <Button variant="outline" onClick={onClose}>Close</Button>}>
      <TabBar tab={tab} setTab={setTab} canCreate={canCreate} noun={noun} />
      {tab === 'select' ? <SearchList fetcher={kind === 'customer' ? customerFetcher : supplierFetcher} suggestions={suggestions} onPick={onPick} placeholder={`Search ${noun}s by name or email`} /> : (
        <div className="space-y-3">
          <Input id="pp-name" label="Company name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input id="pp-email" label="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} hint="Required by the ERP and used to detect duplicates." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input id="pp-contact" label="Contact person" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
            <Input id="pp-phone" label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </div>
          {err && <p role="alert" className="text-xs text-danger">{err}</p>}
        </div>
      )}
    </Modal>
  );
}
