'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, Boxes, Inbox, Package, PackageCheck, Truck, Warehouse } from 'lucide-react';

interface Overview {
  depot: { name: string; code: string };
  orders: { incoming: number; pendingPicking: number; pendingPacking: number; readyToShip: number; shipped: number };
  inventory: { skus: number; units: number; allocated: number; available: number; lowStock: number };
  recentActivity: { id: string; timestamp: string; action: string; userName: string; description: string }[];
}

const when = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });

/** This depot's numbers only: the data comes from /api/depot/overview, which is filtered by the depot server-side. */
export function DepotOverview({ depotId }: { depotId?: string | null }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`/api/depot/overview${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error(j?.error || 'Could not load.'); return j; })
      .then((j) => alive && setData(j)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [depotId]);

  if (error) return <div className="rounded-2xl border border-line bg-white p-4 text-sm text-muted">{error}</div>;
  if (!data) return <div className="h-28 rounded-2xl border border-line bg-white animate-pulse" />;

  const tiles = [
    { label: 'Incoming (24h)', value: data.orders.incoming, icon: Inbox, href: '/depot/pick' },
    { label: 'Pending picking', value: data.orders.pendingPicking, icon: Boxes, href: '/depot/pick' },
    { label: 'Pending packing', value: data.orders.pendingPacking, icon: Package, href: '/depot/pack' },
    { label: 'Ready to ship', value: data.orders.readyToShip, icon: PackageCheck, href: '/depot/ship' },
    { label: 'Shipped', value: data.orders.shipped, icon: Truck, href: '/depot/ship' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-2xl border border-line bg-white p-4 hover:border-primary/40 transition-colors">
            <div className="flex items-center justify-between text-muted"><span className="text-[11px] font-semibold">{t.label}</span><t.icon className="h-4 w-4" /></div>
            <div className="mt-1 text-2xl font-black font-mono text-ink">{t.value}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted mb-3"><Warehouse className="h-4 w-4" /> Inventory summary</div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {[['Products', data.inventory.skus], ['On hand', data.inventory.units], ['Available', data.inventory.available], ['Low stock', data.inventory.lowStock]].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-surface p-2.5"><dt className="text-[11px] text-muted">{k}</dt><dd className={`text-lg font-bold font-mono ${k === 'Low stock' && Number(v) > 0 ? 'text-warning' : 'text-ink'}`}>{Number(v).toLocaleString()}</dd></div>
            ))}
          </dl>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted mb-3"><Activity className="h-4 w-4" /> Recent activity</div>
          {data.recentActivity.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : (
            <ul className="space-y-2 max-h-44 overflow-y-auto">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="text-xs"><span className="text-muted">{when(a.timestamp)} · </span><span className="text-ink">{a.description}</span><span className="text-muted"> — {a.userName}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
