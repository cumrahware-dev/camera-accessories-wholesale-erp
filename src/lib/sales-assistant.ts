/**
 * Sales AI Assistant — a deterministic, RBAC-scoped question router over
 * real ERP data.
 *
 * This intentionally does NOT hand a raw dataset to an LLM and ask it to
 * "figure out the answer": that risks hallucinated numbers and would mean
 * shipping much more data than the browser needs. Instead, the question is
 * matched to one of a fixed set of known intents, each backed by a real
 * aggregation query (Prisma, with a dataStore fallback for when the DB is
 * unreachable) that is scoped to the caller's depot access exactly like
 * every other report in the app. Only the final computed answer — a few
 * numbers and labels — ever leaves the server.
 */
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { AuthUser, depotIdFilter } from '@/lib/api-auth';
import { formatUSD } from '@/lib/utils';
import type { TaxInvoice, Product, Customer } from '@/types/erp';

export interface AssistantAnswer {
  intent: string;
  answerText: string;
  data?: any;
  periodLabel: string;
  dataSource: string;
  generatedAt: string;
}

const TODAY = () => new Date();

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfQuarter(d: Date) {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}
function startOfYear(d: Date) {
  return new Date(d.getFullYear(), 0, 1);
}
function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000);
}

// --- Data loading (scoped to the caller's depot access) -------------------

async function loadInvoices(depotId?: string): Promise<TaxInvoice[]> {
  try {
    const rows = await prisma.taxInvoice.findMany({
      where: depotId ? { depotId } : undefined,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    return rows as unknown as TaxInvoice[];
  } catch {
    return dataStore.getInvoices(depotId ? { depotId } : undefined);
  }
}

async function loadProducts(depotId?: string): Promise<Product[]> {
  try {
    const rows = await prisma.product.findMany({
      include: { inventories: depotId ? { where: { depotId } } : true },
      take: 5000,
    });
    return rows.map((p: any) => {
      const totalStock = depotId
        ? p.inventories.reduce((s: number, inv: any) => s + inv.quantity, 0)
        : p.totalStock;
      return { ...p, totalStock };
    }) as Product[];
  } catch {
    const products = dataStore.getProducts();
    if (!depotId) return products;
    return products.map((p) => ({ ...p, totalStock: p.depotBreakdown?.[depotId] || 0 }));
  }
}

async function loadCustomers(): Promise<Customer[]> {
  try {
    return (await prisma.customer.findMany({ take: 5000 })) as unknown as Customer[];
  } catch {
    return dataStore.getCustomers();
  }
}

// --- Intent detection -------------------------------------------------------

type Intent =
  | 'TOP_CUSTOMERS'
  | 'TOP_PRODUCTS'
  | 'OUTSTANDING_INVOICES'
  | 'MONTH_SALES'
  | 'INACTIVE_CUSTOMERS'
  | 'INVENTORY_VALUE'
  | 'LOW_STOCK'
  | 'RECENT_ORDERS'
  | 'SALES_BY_CATEGORY'
  | 'SALES_TREND'
  | 'UNKNOWN';

function detectIntent(q: string): Intent {
  const t = q.toLowerCase();

  if (/(low\s*(on\s*|in\s*)?stock|stock\s*(is\s*)?low|reorder|running\s*out|understock)/.test(t)) return 'LOW_STOCK';
  if (/(inventory\s*value|stock\s*value|value\s*of\s*(the\s*)?inventory|worth\s*of\s*stock)/.test(t)) return 'INVENTORY_VALUE';
  if (/(outstanding|unpaid|overdue).*invoice|invoice.*(outstanding|unpaid|overdue)/.test(t)) return 'OUTSTANDING_INVOICES';
  if (/(haven'?t|not)\s*(purchased|ordered|bought)|inactive\s*customer|no\s*recent\s*(order|purchase)|churn/.test(t)) return 'INACTIVE_CUSTOMERS';
  if (/top\s*customer|best\s*customer|highest\s*(revenue|spending)\s*customer|customer.*most\s*revenue/.test(t)) return 'TOP_CUSTOMERS';
  if (/top\s*(selling\s*)?product|best\s*sell|most\s*popular\s*product|which\s*products?\s*(are\s*)?sell/.test(t)) return 'TOP_PRODUCTS';
  if (/(by\s*category|category\s*breakdown|sales\s*by\s*category)/.test(t)) return 'SALES_BY_CATEGORY';
  if (/recent\s*order|latest\s*order|last\s*\d*\s*orders?|newest\s*order/.test(t)) return 'RECENT_ORDERS';
  if (/this\s*month.*sales|sales.*this\s*month|month'?s\s*sales|monthly\s*sales/.test(t)) return 'MONTH_SALES';
  if (/trend|summary|how\s*(are|is)\s*sales|this\s*quarter|this\s*year|year\s*to\s*date|overview/.test(t)) return 'SALES_TREND';

  return 'UNKNOWN';
}

// --- Intent handlers ---------------------------------------------------------

async function handleTopCustomers(depotId?: string): Promise<AssistantAnswer> {
  const invoices = await loadInvoices(depotId);
  const byCustomer = new Map<string, { name: string; revenue: number; orders: number }>();
  for (const inv of invoices) {
    const key = inv.customerId;
    const entry = byCustomer.get(key) || { name: inv.customerCompany || inv.customerName, revenue: 0, orders: 0 };
    entry.revenue += inv.grandTotal || 0;
    entry.orders += 1;
    byCustomer.set(key, entry);
  }
  const ranked = Array.from(byCustomer.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const answerText =
    ranked.length === 0
      ? 'No invoiced revenue found yet, so there are no customers to rank.'
      : `Top customers by revenue (all-time, from ${invoices.length} invoice${invoices.length === 1 ? '' : 's'}):\n` +
        ranked.map((c, i) => `${i + 1}. ${c.name} — ${formatUSD(c.revenue)} across ${c.orders} order${c.orders === 1 ? '' : 's'}`).join('\n');

  return {
    intent: 'TOP_CUSTOMERS',
    answerText,
    data: ranked,
    periodLabel: 'All-time',
    dataSource: 'Tax invoices',
    generatedAt: new Date().toISOString(),
  };
}

async function handleTopProducts(depotId?: string): Promise<AssistantAnswer> {
  const invoices = await loadInvoices(depotId);
  const byProduct = new Map<string, { name: string; sku: string; qty: number; revenue: number }>();
  for (const inv of invoices) {
    for (const item of inv.items || []) {
      const key = item.productId || item.productSku;
      const entry = byProduct.get(key) || { name: item.productName, sku: item.productSku, qty: 0, revenue: 0 };
      entry.qty += item.quantity || 0;
      entry.revenue += item.totalPrice || 0;
      byProduct.set(key, entry);
    }
  }
  const ranked = Array.from(byProduct.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const answerText =
    ranked.length === 0
      ? 'No invoice line items found yet, so there are no products to rank.'
      : `Top-selling products by revenue (all-time):\n` +
        ranked.map((p, i) => `${i + 1}. ${p.name} (${p.sku}) — ${formatUSD(p.revenue)} from ${p.qty} unit${p.qty === 1 ? '' : 's'} sold`).join('\n');

  return {
    intent: 'TOP_PRODUCTS',
    answerText,
    data: ranked,
    periodLabel: 'All-time',
    dataSource: 'Invoice line items',
    generatedAt: new Date().toISOString(),
  };
}

async function handleOutstandingInvoices(depotId?: string): Promise<AssistantAnswer> {
  const invoices = await loadInvoices(depotId);
  const outstanding = invoices.filter((i) => i.paymentStatus !== 'PAID');
  const totalOutstanding = outstanding.reduce((s, i) => s + (i.grandTotal || 0), 0);
  const overdue = outstanding.filter((i) => new Date(i.dueDate) < TODAY());
  const totalOverdue = overdue.reduce((s, i) => s + (i.grandTotal || 0), 0);

  const topFive = [...outstanding].sort((a, b) => (b.grandTotal || 0) - (a.grandTotal || 0)).slice(0, 5);

  const answerText =
    outstanding.length === 0
      ? 'No outstanding invoices — everything is fully paid as of now.'
      : `${outstanding.length} outstanding invoice${outstanding.length === 1 ? '' : 's'} totaling ${formatUSD(totalOutstanding)} (as of now).\n` +
        `${overdue.length} of those are past their due date, totaling ${formatUSD(totalOverdue)}.\n\n` +
        `Largest outstanding invoices:\n` +
        topFive.map((i) => `- ${i.invoiceNumber} (${i.customerCompany}) — ${formatUSD(i.grandTotal)}, due ${new Date(i.dueDate).toLocaleDateString()}`).join('\n');

  return {
    intent: 'OUTSTANDING_INVOICES',
    answerText,
    data: { count: outstanding.length, totalOutstanding, overdueCount: overdue.length, totalOverdue, topFive },
    periodLabel: `As of ${TODAY().toLocaleDateString()}`,
    dataSource: 'Tax invoices (paymentStatus)',
    generatedAt: new Date().toISOString(),
  };
}

async function handleMonthSales(depotId?: string): Promise<AssistantAnswer> {
  const invoices = await loadInvoices(depotId);
  const from = startOfMonth(TODAY());
  const inMonth = invoices.filter((i) => new Date(i.createdAt) >= from);
  const total = inMonth.reduce((s, i) => s + (i.grandTotal || 0), 0);
  const monthLabel = TODAY().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const answerText =
    inMonth.length === 0
      ? `No invoices have been created yet in ${monthLabel}.`
      : `${monthLabel} sales: ${formatUSD(total)} across ${inMonth.length} invoice${inMonth.length === 1 ? '' : 's'} (average ${formatUSD(total / inMonth.length)} per invoice).`;

  return {
    intent: 'MONTH_SALES',
    answerText,
    data: { total, orderCount: inMonth.length },
    periodLabel: monthLabel,
    dataSource: 'Tax invoices (createdAt)',
    generatedAt: new Date().toISOString(),
  };
}

async function handleInactiveCustomers(depotId?: string): Promise<AssistantAnswer> {
  const invoices = await loadInvoices(depotId);
  const customers = await loadCustomers();
  const cutoff = daysAgo(60);

  const lastOrderByCustomer = new Map<string, Date>();
  for (const inv of invoices) {
    const d = new Date(inv.createdAt);
    const existing = lastOrderByCustomer.get(inv.customerId);
    if (!existing || d > existing) lastOrderByCustomer.set(inv.customerId, d);
  }

  const inactive = customers.filter((c) => {
    if (c.status !== 'ACTIVE') return false;
    const last = lastOrderByCustomer.get(c.id);
    return !last || last < cutoff;
  });

  const answerText =
    inactive.length === 0
      ? 'Every active customer has ordered within the last 60 days.'
      : `${inactive.length} active customer${inactive.length === 1 ? ' has' : 's have'} not ordered in the last 60 days:\n` +
        inactive
          .slice(0, 10)
          .map((c) => {
            const last = lastOrderByCustomer.get(c.id);
            return `- ${c.companyName} — last order ${last ? last.toLocaleDateString() : 'never'}`;
          })
          .join('\n') +
        (inactive.length > 10 ? `\n...and ${inactive.length - 10} more.` : '');

  return {
    intent: 'INACTIVE_CUSTOMERS',
    answerText,
    data: inactive.slice(0, 25).map((c) => ({ id: c.id, name: c.companyName, lastOrder: lastOrderByCustomer.get(c.id) || null })),
    periodLabel: 'No orders in the last 60 days',
    dataSource: 'Tax invoices + customer records',
    generatedAt: new Date().toISOString(),
  };
}

async function handleInventoryValue(depotId?: string): Promise<AssistantAnswer> {
  const products = await loadProducts(depotId);
  const totalValue = products.reduce((s, p) => s + (p.totalStock || 0) * (p.purchasePrice || 0), 0);
  const totalUnits = products.reduce((s, p) => s + (p.totalStock || 0), 0);

  return {
    intent: 'INVENTORY_VALUE',
    answerText: `Current inventory value (at purchase cost): ${formatUSD(totalValue)} across ${totalUnits.toLocaleString()} units in ${products.length} SKU${products.length === 1 ? '' : 's'}.`,
    data: { totalValue, totalUnits, skuCount: products.length },
    periodLabel: `As of ${TODAY().toLocaleDateString()}`,
    dataSource: 'Product catalog (purchase price × on-hand stock)',
    generatedAt: new Date().toISOString(),
  };
}

async function handleLowStock(depotId?: string): Promise<AssistantAnswer> {
  const products = await loadProducts(depotId);
  const low = products.filter((p) => (p.totalStock || 0) <= (p.minStockLevel ?? 0));
  const sorted = [...low].sort((a, b) => (a.totalStock || 0) - (b.totalStock || 0)).slice(0, 10);

  const answerText =
    low.length === 0
      ? 'No products are at or below their minimum stock level right now.'
      : `${low.length} product${low.length === 1 ? ' is' : 's are'} at or below minimum stock level:\n` +
        sorted.map((p) => `- ${p.name} (${p.sku}) — ${p.totalStock ?? 0} on hand, minimum ${p.minStockLevel}`).join('\n') +
        (low.length > sorted.length ? `\n...and ${low.length - sorted.length} more.` : '');

  return {
    intent: 'LOW_STOCK',
    answerText,
    data: sorted,
    periodLabel: `As of ${TODAY().toLocaleDateString()}`,
    dataSource: 'Product catalog + depot inventory',
    generatedAt: new Date().toISOString(),
  };
}

async function handleRecentOrders(depotId?: string): Promise<AssistantAnswer> {
  const invoices = await loadInvoices(depotId);
  const recent = [...invoices]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  const answerText =
    recent.length === 0
      ? 'No orders have been placed yet.'
      : `Most recent orders:\n` +
        recent
          .map((i) => `- ${i.invoiceNumber} — ${i.customerCompany} — ${formatUSD(i.grandTotal)} — ${new Date(i.createdAt).toLocaleDateString()} (${i.fulfilmentStatus.replace(/_/g, ' ')})`)
          .join('\n');

  return {
    intent: 'RECENT_ORDERS',
    answerText,
    data: recent,
    periodLabel: 'Most recent',
    dataSource: 'Tax invoices',
    generatedAt: new Date().toISOString(),
  };
}

async function handleSalesByCategory(depotId?: string): Promise<AssistantAnswer> {
  const invoices = await loadInvoices(depotId);
  const products = await loadProducts(depotId);
  const categoryByProductId = new Map(products.map((p) => [p.id, p.categoryName || 'Uncategorized']));

  const byCategory = new Map<string, number>();
  for (const inv of invoices) {
    for (const item of inv.items || []) {
      const cat = categoryByProductId.get(item.productId) || 'Uncategorized';
      byCategory.set(cat, (byCategory.get(cat) || 0) + (item.totalPrice || 0));
    }
  }
  const ranked = Array.from(byCategory.entries())
    .map(([category, revenue]) => ({ category, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const answerText =
    ranked.length === 0
      ? 'No invoiced sales found yet to break down by category.'
      : `Sales by category (all-time):\n` + ranked.map((c) => `- ${c.category}: ${formatUSD(c.revenue)}`).join('\n');

  return {
    intent: 'SALES_BY_CATEGORY',
    answerText,
    data: ranked,
    periodLabel: 'All-time',
    dataSource: 'Invoice line items + product categories',
    generatedAt: new Date().toISOString(),
  };
}

async function handleSalesTrend(depotId?: string): Promise<AssistantAnswer> {
  const invoices = await loadInvoices(depotId);
  const now = TODAY();
  const months: { label: string; total: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const total = invoices
      .filter((inv) => {
        const d = new Date(inv.createdAt);
        return d >= monthStart && d < monthEnd;
      })
      .reduce((s, inv) => s + (inv.grandTotal || 0), 0);
    months.push({ label: monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), total });
  }

  const ytdTotal = invoices
    .filter((inv) => new Date(inv.createdAt) >= startOfYear(now))
    .reduce((s, inv) => s + (inv.grandTotal || 0), 0);
  const qtdTotal = invoices
    .filter((inv) => new Date(inv.createdAt) >= startOfQuarter(now))
    .reduce((s, inv) => s + (inv.grandTotal || 0), 0);

  const answerText =
    `Sales trend, last 6 months:\n` +
    months.map((m) => `- ${m.label}: ${formatUSD(m.total)}`).join('\n') +
    `\n\nYear-to-date (${now.getFullYear()}): ${formatUSD(ytdTotal)}\nThis quarter: ${formatUSD(qtdTotal)}`;

  return {
    intent: 'SALES_TREND',
    answerText,
    data: { months, ytdTotal, qtdTotal },
    periodLabel: `Last 6 months + YTD ${now.getFullYear()}`,
    dataSource: 'Tax invoices (createdAt)',
    generatedAt: new Date().toISOString(),
  };
}

function handleUnknown(): AssistantAnswer {
  return {
    intent: 'UNKNOWN',
    answerText:
      "I can answer questions about: top customers by revenue, top-selling products, outstanding/unpaid invoices, this month's sales, customers who haven't purchased recently, current inventory value, low-stock products, recent orders, sales by category, and sales trends. Try asking one of those.",
    periodLabel: '—',
    dataSource: '—',
    generatedAt: new Date().toISOString(),
  };
}

export async function answerSalesQuestion(question: string, user: AuthUser): Promise<AssistantAnswer> {
  const depotId = depotIdFilter(user);
  const intent = detectIntent(question || '');

  switch (intent) {
    case 'TOP_CUSTOMERS':
      return handleTopCustomers(depotId);
    case 'TOP_PRODUCTS':
      return handleTopProducts(depotId);
    case 'OUTSTANDING_INVOICES':
      return handleOutstandingInvoices(depotId);
    case 'MONTH_SALES':
      return handleMonthSales(depotId);
    case 'INACTIVE_CUSTOMERS':
      return handleInactiveCustomers(depotId);
    case 'INVENTORY_VALUE':
      return handleInventoryValue(depotId);
    case 'LOW_STOCK':
      return handleLowStock(depotId);
    case 'RECENT_ORDERS':
      return handleRecentOrders(depotId);
    case 'SALES_BY_CATEGORY':
      return handleSalesByCategory(depotId);
    case 'SALES_TREND':
      return handleSalesTrend(depotId);
    default:
      return handleUnknown();
  }
}

export const SUGGESTED_QUESTIONS = [
  'Which customers generated the most revenue?',
  'What products are selling the most?',
  'Which invoices are outstanding?',
  "What are this month's sales?",
  'Which customers have not purchased recently?',
  'What is the current inventory value?',
  'Which products are low in stock?',
  'What are the recent orders?',
  'Show me sales by category',
  'Give me a sales trend summary',
];
