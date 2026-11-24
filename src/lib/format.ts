/** Shared display formatters: India-style dates (DD Mon YYYY) and INR (lakh/crore grouping). */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null;
  // Plain YYYY-MM-DD must be read as a local date, not UTC midnight.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 05 Mar 2026 */
export function formatDate(v: string | number | Date | null | undefined, fallback = '—'): string {
  const d = toDate(v);
  if (!d) return fallback;
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** 05 Mar 2026, 14:30 */
export function formatDateTime(v: string | number | Date | null | undefined, fallback = '—'): string {
  const d = toDate(v);
  if (!d) return fallback;
  return `${formatDate(d)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ₹12,34,567 (lakh/crore grouping) */
export function formatINR(v: number | string | null | undefined, fallback = '—'): string {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Compact: ₹1.2 Cr, ₹4.5 L, ₹12,000 */
export function formatINRCompact(v: number | string | null | undefined, fallback = '—'): string {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2).replace(/\.?0+$/, '')} L`;
  return formatINR(n);
}

export function formatNumber(v: number | string | null | undefined, fallback = '—'): string {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-IN') : fallback;
}
