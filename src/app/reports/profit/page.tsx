'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { formatUSD } from '@/lib/utils';
import { ProfitabilityMetric, BusinessInsight } from '@/types/erp';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { KPICard } from '@/components/ui/KPICard';
import { MarginBadge, Badge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';

export default function ProfitabilityPage() {
  const [metrics, setMetrics] = useState<ProfitabilityMetric[]>([]);
  const [insights, setInsights] = useState<BusinessInsight[]>([]);
  const [summary, setSummary] = useState<{ productsSold: number; shown: number; totalRevenue: number; totalCost: number; grossProfit: number } | null>(null);
  const [visible, setVisible] = useState(50);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadData = async () => {
    setState('loading');
    try {
      const res = await fetch('/api/dashboard/stats');
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setMetrics(data.profitability || []);
      setInsights(data.insights || []);
      setSummary(data.profitabilitySummary || null);
      setState('ready');
    } catch {
      setState('error');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Headline numbers come from the server, over ALL products that sold; the table below lists the top of them.
  const totalRevenue = summary ? summary.totalRevenue : metrics.reduce((sum, m) => sum + m.totalRevenue, 0);
  const totalCost = summary ? summary.totalCost : metrics.reduce((sum, m) => sum + m.totalCost, 0);
  const totalProfit = summary ? summary.grossProfit : metrics.reduce((sum, m) => sum + m.grossProfit, 0);
  const overallMargin = totalRevenue > 0 ? Number(((totalProfit / totalRevenue) * 100).toFixed(1)) : 0;

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Profitability"
        description="Executive margin analysis across equipment models, categories, and customer channels."
      />

      {/* Top Margin KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
        <KPICard
          label="Total Revenue"
          value={formatUSD(totalRevenue)}
          helperText="Gross invoiced volume"
        />
        <KPICard
          label="Cost of Goods Sold (COGS)"
          value={formatUSD(totalCost)}
          helperText="Manufacturer base cost"
        />
        <KPICard
          label="Gross Profit"
          value={formatUSD(totalProfit)}
          tone="success"
          helperText="Net wholesale earnings"
        />
        <KPICard
          label="Gross Margin %"
          value={`${overallMargin}%`}
          tone="primary"
          helperText="Target benchmark: 22.0%"
        />
      </div>

      {/* Automated BI Insights */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
            Business Intelligence Insights
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {insights.map((bi) => (
            <Card key={bi.id} className="p-4 flex flex-col justify-between space-y-2">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Badge tone={bi.urgency === 'ALERT' ? 'danger' : bi.urgency === 'SUCCESS' ? 'success' : 'primary'}>
                    {bi.type.replace(/_/g, ' ')}
                  </Badge>
                  {bi.metricValue && (
                    <span className="font-mono text-xs font-bold text-ink">{bi.metricValue}</span>
                  )}
                </div>
                <h4 className="text-xs font-bold text-ink leading-snug">{bi.title}</h4>
                <p className="text-xs text-muted mt-1 leading-relaxed">{bi.message}</p>
              </div>

              {bi.actionLink && (
                <div className="pt-3 border-t border-line-soft mt-2">
                  <Link
                    href={bi.actionLink}
                    className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                  >
                    <span>{bi.actionLabel || 'Investigate in System'}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {/* Product Profitability Table */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-line-soft bg-surface flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
            Most Profitable Products & Margin Contribution
          </h3>
          {summary && (
            <span className="text-[11px] text-muted">Top {Math.min(visible, metrics.length)} of {summary.productsSold.toLocaleString()} products with sales, by revenue</span>
          )}
        </div>
        {state === 'loading' && <div className="p-6 text-xs text-muted">Loading profitability…</div>}
        {state === 'error' && (
          <div className="p-6 text-xs text-danger flex items-center gap-3">Could not load the report. <button onClick={loadData} className="font-semibold underline">Retry</button></div>
        )}
        {state === 'ready' && metrics.length === 0 && <div className="p-6 text-xs text-muted">No sales yet, so there is nothing to analyse.</div>}

        <Table className="border-0 rounded-none shadow-none">
          <TableHeader>
            <TableHead>Equipment / Product</TableHead>
            <TableHead>Category</TableHead>
            <TableHead align="right">Units Sold</TableHead>
            <TableHead align="right">Revenue ($)</TableHead>
            <TableHead align="right">Cost ($)</TableHead>
            <TableHead align="right">Gross Profit ($)</TableHead>
            <TableHead align="right">Margin Status</TableHead>
          </TableHeader>
          <TableBody>
            {metrics.slice(0, visible).map((m) => (
              <TableRow key={m.productId}>
                <TableCell>
                  <div className="font-bold text-ink text-xs">{m.productName}</div>
                  <div className="text-[11px] text-muted font-mono">
                    SKU: {m.sku} · {m.brand}
                  </div>
                </TableCell>
                <TableCell className="text-ink-secondary">{m.categoryName}</TableCell>
                <TableCell align="right" className="font-bold text-ink">{m.unitsSold}</TableCell>
                <TableCell align="right" className="font-bold text-ink">{formatUSD(m.totalRevenue)}</TableCell>
                <TableCell align="right" className="text-muted">{formatUSD(m.totalCost)}</TableCell>
                <TableCell align="right" className="font-bold text-success">
                  {formatUSD(m.grossProfit)}
                </TableCell>
                <TableCell align="right">
                  <MarginBadge marginPercent={m.grossMarginPercent} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {metrics.length > visible && (
          <div className="p-3 text-center border-t border-line-soft">
            <button onClick={() => setVisible((v) => v + 100)} className="text-xs font-semibold text-primary hover:underline min-h-[44px]">
              Show more ({metrics.length - visible} remaining)
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
