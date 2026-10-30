import { amountInWords } from '@/lib/documents/amount-words';
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const DEFAULT_PRODUCT_IMAGE = '/placeholder-product.svg';

// Client-safe Image thumbnail helper — inserts auto-quality/format and dimension transforms
// so list views, inventory tables, and avatars download tiny (~5-15KB) webp thumbnails.
// For products and external unsplash links, returns the unified local SVG placeholder.
export function cloudinaryThumb(url: string | undefined | null, size = 120): string | undefined | null {
  if (!url) return url;
  if (url.includes('images.unsplash.com')) return DEFAULT_PRODUCT_IMAGE;
  if (url.includes('res.cloudinary.com') && url.includes('/upload/')) {
    if (url.includes('/upload/w_') || url.includes('/upload/c_')) return url;
    const transform = `w_${size},h_${size},c_fill,g_auto,q_auto,f_auto`;
    return url.replace('/upload/', `/upload/${transform}/`);
  }
  return url;
}

/** Amount in a given ISO currency (the company's base currency for stock values): "$1,234.50", "AED 1,234.50". */
export function formatMoney(amount: number | undefined | null, currency = 'USD'): string {
  const n = amount === undefined || amount === null || isNaN(amount) ? 0 : amount;
  const code = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${code} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

/**
 * Sums a value across items that may be denominated in different currencies, grouped per currency
 * (summing AED and USD into one number would be meaningless). Use with formatByCurrency to display.
 */
export function sumByCurrency<T>(items: T[], value: (item: T) => number, currency: (item: T) => string | undefined): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const item of items) {
    const code = (currency(item) || 'USD').toUpperCase();
    totals[code] = (totals[code] || 0) + (value(item) || 0);
  }
  return totals;
}

/** Renders a per-currency total map as "AED 1,234.00" or, for several currencies, "AED 1,234.00 + USD 567.00". */
export function formatByCurrency(totals: Record<string, number>): string {
  const codes = Object.keys(totals).sort();
  if (codes.length === 0) return formatMoney(0);
  return codes.map((c) => formatMoney(totals[c], c)).join(' + ');
}

export function formatUSD(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || isNaN(amount)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(dateString: string | undefined | null): string {
  if (!dateString) return "—";
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(d);
  } catch {
    return dateString;
  }
}

export function formatDateTime(dateString: string | undefined | null): string {
  if (!dateString) return "—";
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return dateString;
  }
}

export function getStatusBadgeClasses(status: string | undefined | null): { bg: string; text: string; border: string; dot: string } {
  if (!status) {
    return {
      bg: "bg-slate-500/10",
      text: "text-slate-400",
      border: "border-slate-500/30",
      dot: "bg-slate-400",
    };
  }
  switch (status.toUpperCase()) {
    case "CONFIRMED":
    case "DELIVERED":
    case "PAID":
    case "ACTIVE":
    case "IN_STOCK":
    case "COMPLETED":
      return {
        bg: "bg-emerald-500/10",
        text: "text-emerald-400",
        border: "border-emerald-500/30",
        dot: "bg-emerald-400",
      };
    case "SHIPPED":
    case "DISPATCHED":
    case "IN_TRANSIT":
    case "SENT":
      return {
        bg: "bg-cyan-500/10",
        text: "text-cyan-400",
        border: "border-cyan-500/30",
        dot: "bg-cyan-400",
      };
    case "READY_FOR_PACKING":
    case "PACKED":
    case "PROCESSING":
    case "PENDING":
    case "ALLOCATED":
      return {
        bg: "bg-amber-500/10",
        text: "text-amber-400",
        border: "border-amber-500/30",
        dot: "bg-amber-400 animate-pulse",
      };
    case "DRAFT":
    case "PARTIALLY_PAID":
      return {
        bg: "bg-slate-500/10",
        text: "text-slate-400",
        border: "border-slate-500/30",
        dot: "bg-slate-400",
      };
    case "CANCELLED":
    case "DEFECTIVE":
    case "INACTIVE":
    case "UNPAID":
    case "ON_HOLD":
      return {
        bg: "bg-rose-500/10",
        text: "text-rose-400",
        border: "border-rose-500/30",
        dot: "bg-rose-400",
      };
    default:
      return {
        bg: "bg-blue-500/10",
        text: "text-blue-400",
        border: "border-blue-500/30",
        dot: "bg-blue-400",
      };
  }
}

export function generateId(prefix: string): string {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${timestamp}-${random}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/** Kept for existing callers: US Dollars. New code uses amountInWords(amount, currency). */
export function numberToWordsUSD(amount: number | undefined | null): string {
  return amountInWords(amount, 'USD');
}

export function formatDocDate(dateString: string | undefined | null): string {
  if (!dateString) return "—";
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  } catch {
    return dateString;
  }
}

