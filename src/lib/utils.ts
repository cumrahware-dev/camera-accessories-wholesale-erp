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

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function convertLessThanThousand(num: number): string {
  if (num === 0) return '';
  if (num < 20) return ONES[num] + ' ';
  if (num < 100) return TENS[Math.floor(num / 10)] + (num % 10 !== 0 ? '-' + ONES[num % 10] : '') + ' ';
  return ONES[Math.floor(num / 100)] + ' Hundred ' + convertLessThanThousand(num % 100);
}

export function numberToWordsUSD(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || isNaN(amount) || amount === 0) {
    return 'US Dollars Zero Only.';
  }
  
  // Work in whole cents so values like 10.995 carry into the dollars instead of showing 100 cents.
  const totalCents = Math.round(Math.abs(amount) * 100);
  const dollars = Math.floor(totalCents / 100);
  const cents = totalCents % 100;
  
  const scales = ['', 'Thousand', 'Million', 'Billion'];
  let dollarWords = '';
  let temp = dollars;
  let scaleIdx = 0;
  
  if (dollars === 0) {
    dollarWords = 'Zero ';
  } else {
    while (temp > 0) {
      const chunk = temp % 1000;
      if (chunk !== 0) {
        const chunkWords = convertLessThanThousand(chunk);
        dollarWords = chunkWords + scales[scaleIdx] + (scaleIdx > 0 ? ' ' : '') + dollarWords;
      }
      temp = Math.floor(temp / 1000);
      scaleIdx++;
    }
  }
  
  let result = 'US Dollars ' + dollarWords.trim();
  if (cents > 0) {
    const centWords = convertLessThanThousand(cents).trim();
    result += ' and ' + centWords + ' Cents';
  }
  return result + ' Only.';
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

