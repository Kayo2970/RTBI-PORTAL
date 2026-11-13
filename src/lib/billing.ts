/**
 * billing.ts — shared (client + server) types and pure helpers for the
 * Bookings, Invoices/Payments and Inventory modules. No I/O in here.
 */

export type BookingStatus = 'Confirmed' | 'Cancelled';
export type InvoiceStatus = 'Unpaid' | 'Partially Paid' | 'Paid' | 'Void';
export type PaymentStatus = 'Pending Verification' | 'Verified' | 'Rejected';
export type PaymentMethod = 'UPI' | 'Bank Transfer' | 'Cash' | 'Cheque' | 'Card' | 'Other';
export const PAYMENT_METHODS: PaymentMethod[] = ['UPI', 'Bank Transfer', 'Cash', 'Cheque', 'Card', 'Other'];

export interface Room {
  id: string;
  name: string;
  capacity: number;
  location?: string;
  amenities?: string;
  /** Rupees per hour. 0 = free (no invoice is raised). */
  hourlyRate: number;
  /** Default tax percent applied to the room charge on the auto invoice. */
  gstPercent: number;
  active: boolean;
  createdAt: string;
}

export const DEFAULT_ROOMS: Room[] = [
  {
    id: 'room_boardroom',
    name: 'Boardroom',
    capacity: 14,
    location: 'RTBI Hub, 1st Floor',
    amenities: 'Executive conference table, HD display screen, Video conferencing setup, High-speed Wi-Fi',
    hourlyRate: 0,
    gstPercent: 0,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'room_meeting_room',
    name: 'Meeting Room',
    capacity: 6,
    location: 'RTBI Hub, Ground Floor',
    amenities: 'Team discussion table, Presentation monitor, Whiteboard, High-speed Wi-Fi',
    hourlyRate: 0,
    gstPercent: 0,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

export interface Booking {
  id: string;
  roomId: string;
  roomName: string;
  /** ISO timestamps (UTC). */
  start: string;
  end: string;
  title: string;
  attendees?: number;
  notes?: string;
  bookedById: string;
  bookedByName: string;
  bookedByEmail: string;
  organisation?: string;
  status: BookingStatus;
  invoiceId?: string;
  createdAt: string;
  cancelledAt?: string;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  /** Tax percent for this line. */
  taxPercent: number;
}

export interface Invoice {
  id: string;
  /** e.g. INV/2026-27/0001 — assigned server-side, sequential per financial year. */
  number: string;
  customerId?: string;
  customerName: string;
  customerEmail?: string;
  customerOrganisation?: string;
  issueDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  lines: InvoiceLine[];
  /** Flat discount in rupees, applied before tax is added back proportionally. */
  discount: number;
  notes?: string;
  status: InvoiceStatus;
  source: 'Manual' | 'Booking';
  bookingId?: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  voidedAt?: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  method: PaymentMethod;
  /** UTR / transaction id / cheque number. */
  reference: string;
  paidOn: string; // YYYY-MM-DD
  note?: string;
  status: PaymentStatus;
  submittedById: string;
  submittedByName: string;
  createdAt: string;
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  rejectReason?: string;
}

export interface BillingSettings {
  id: 'default';
  businessName: string;
  address?: string;
  gstin?: string;
  upiId?: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  ifsc?: string;
  /** Free text shown on every invoice (payment terms etc). */
  terms?: string;
  /** Days between issue and due date for auto-generated invoices. */
  defaultDueDays: number;
  updatedAt?: string;
}

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  id: 'default',
  businessName: 'RTBI',
  defaultDueDays: 7,
};

export interface InventoryItem {
  id: string;
  name: string;
  sku?: string;
  category?: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
  unitCost: number;
  location?: string;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MovementType = 'In' | 'Out' | 'Adjust';
export interface InventoryMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: MovementType;
  /** Signed change actually applied to stock (negative for Out). */
  delta: number;
  quantityAfter: number;
  reason?: string;
  by: string;
  at: string;
}

// ---------------------------------------------------------------- maths

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** Per-line figures after the discount has been spread across lines. */
  lines: { net: number; tax: number; gross: number }[];
}

/**
 * Subtotal − discount, with tax computed on each line's post-discount value
 * (the discount is spread proportionally across lines), so the tax breakup
 * is always consistent with the total.
 */
export function computeTotals(lines: InvoiceLine[], discount = 0): InvoiceTotals {
  const base = lines.map(l => r2(Math.max(0, l.quantity) * Math.max(0, l.unitPrice)));
  const subtotal = r2(base.reduce((s, n) => s + n, 0));
  const disc = r2(Math.min(Math.max(0, discount || 0), subtotal));
  let tax = 0;
  const out = lines.map((l, i) => {
    const share = subtotal > 0 ? disc * (base[i] / subtotal) : 0;
    const net = r2(base[i] - share);
    const t = r2(net * (Math.max(0, l.taxPercent || 0) / 100));
    tax += t;
    return { net, tax: t, gross: r2(net + t) };
  });
  tax = r2(tax);
  return { subtotal, discount: disc, tax, total: r2(subtotal - disc + tax), lines: out };
}

export function invoiceTotal(inv: Pick<Invoice, 'lines' | 'discount'>): number {
  return computeTotals(inv.lines, inv.discount).total;
}

/** Sum of verified payments for an invoice. */
export function amountPaid(invoiceId: string, payments: Payment[]): number {
  return r2(payments.filter(p => p.invoiceId === invoiceId && p.status === 'Verified').reduce((s, p) => s + p.amount, 0));
}

/** Verified + awaiting-verification — used to stop someone submitting more than is due. */
export function amountCommitted(invoiceId: string, payments: Payment[]): number {
  return r2(payments.filter(p => p.invoiceId === invoiceId && p.status !== 'Rejected').reduce((s, p) => s + p.amount, 0));
}

export function deriveInvoiceStatus(inv: Invoice, payments: Payment[]): InvoiceStatus {
  if (inv.status === 'Void') return 'Void';
  const total = invoiceTotal(inv);
  const paid = amountPaid(inv.id, payments);
  if (paid >= total - 0.005 && total > 0) return 'Paid';
  if (paid > 0) return 'Partially Paid';
  return 'Unpaid';
}

// ---------------------------------------------------------- invoice number

/** Indian financial year label (Apr–Mar) for a date, e.g. 2026-11-13 -> "2026-27". */
export function financialYearLabel(d: Date = new Date()): string {
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Next sequential invoice number for the issue date's financial year. */
export function nextInvoiceNumber(existing: Pick<Invoice, 'number'>[], issueDate: Date = new Date()): string {
  const fy = financialYearLabel(issueDate);
  const prefix = `INV/${fy}/`;
  let max = 0;
  for (const inv of existing) {
    if (inv.number?.startsWith(prefix)) {
      const n = parseInt(inv.number.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// ----------------------------------------------------------------- bookings

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime();
}

/** Billable hours, rounded UP to the next half hour, minimum 0.5. */
export function billableHours(start: string, end: string): number {
  const hrs = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
  return Math.max(0.5, Math.ceil(hrs * 2) / 2);
}

export function formatINR(n: number): string {
  return '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Build a upi://pay deep link (also used for the QR code). */
export function upiLink(settings: BillingSettings, amount: number, invoiceNumber: string): string | null {
  if (!settings.upiId) return null;
  const q = new URLSearchParams({
    pa: settings.upiId,
    pn: settings.accountName || settings.businessName,
    am: amount.toFixed(2),
    cu: 'INR',
    tn: invoiceNumber,
  });
  return `upi://pay?${q.toString()}`;
}
