/**
 * finance.ts — shared (client + server) finance model: the eight overhead
 * heads, annual budget / expense / invoice record shapes, and the pure helpers
 * that both the Finance page and the API routes rely on. No `window` access
 * here, so API routes can import it safely.
 */
import type { ReceiptFile } from './local-data';

/** The eight overhead heads every annual budget is broken up into, and every expense is booked against. */
export const EXPENSE_HEADS = [
  { key: 'manpower', label: 'Manpower' },
  { key: 'travel', label: 'Travel Expenses' },
  { key: 'utilities', label: 'Utilities & Maintenance' },
  { key: 'marketing', label: 'Marketing, Promotion & Publicity' },
  { key: 'networking', label: 'Networking & Training Programs' },
  { key: 'admin', label: 'Other Administrative Expenses' },
  { key: 'startups', label: 'Support to Startups' },
  { key: 'misc', label: 'Miscellaneous' },
] as const;

export type ExpenseHeadKey = (typeof EXPENSE_HEADS)[number]['key'];

export function isExpenseHeadKey(value: unknown): value is ExpenseHeadKey {
  return EXPENSE_HEADS.some(h => h.key === value);
}

export function getExpenseHeadLabel(key: string | undefined): string {
  return EXPENSE_HEADS.find(h => h.key === key)?.label || 'Unassigned';
}

/** One budget per Indian financial year (Apr–Mar), broken up across the eight heads. */
export interface AnnualBudgetItem {
  id: string; // always `ab_<financialYear>`
  financialYear: string; // 'YYYY-YYYY'
  totalAmount: number;
  allocations: Partial<Record<ExpenseHeadKey, number>>;
  notes?: string;
  updatedBy: string;
  updatedAt: string;
}

export function annualBudgetId(financialYear: string): string {
  return `ab_${financialYear}`;
}

/** An expense booked by an employee: bill(s) + description + the head it falls under are all mandatory. */
export interface ExpenseItem {
  id: string;
  financialYear: string;
  head: ExpenseHeadKey;
  amount: number;
  description: string;
  expenseDate: string; // YYYY-MM-DD, the date on the bill
  billFiles: ReceiptFile[];
  vendor?: string;
  eventId?: string;
  eventName?: string;
  submittedBy: string;
  submittedByEmail: string;
  submittedAt: string;
}

export type InvoiceStatus = 'Issued' | 'Payment Recorded' | 'Paid' | 'Cancelled';

export interface InvoiceLine {
  description: string;
  quantity: number;
  rate: number;
}

export interface InvoicePayment {
  amount: number;
  mode: 'Bank Transfer' | 'UPI' | 'Cheque' | 'Cash' | 'Other';
  reference: string; // UTR / cheque number / receipt number
  paidOn: string; // YYYY-MM-DD
  proofFiles: ReceiptFile[];
  recordedBy: string;
  recordedByEmail: string;
  recordedAt: string;
  rejectionNote?: string; // set (and payment cleared) when a verifier sends it back — kept in history on the invoice
}

export interface ClientRecord {
  id: string;
  name: string; // Client / Company / Startup name
  email?: string;
  address?: string;
  gstin?: string;
  isStartup?: boolean;
  startupName?: string;
  founderName?: string;
  phone?: string;
  notes?: string;
  defaultTaxPercent?: number;
  lastBilledAt?: string;
  totalBilled?: number;
  invoiceCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface InvoiceItem {
  id: string;
  invoiceNumber: string;
  financialYear: string;
  clientName: string;
  clientEmail?: string;
  clientAddress?: string;
  clientGstin?: string;
  isStartup?: boolean;
  startupName?: string;
  clientId?: string;
  issueDate: string;
  dueDate?: string;
  lineItems: InvoiceLine[];
  subtotal: number;
  taxPercent: number;
  taxAmount: number;
  totalAmount: number;
  notes?: string;
  status: InvoiceStatus;
  payment?: InvoicePayment;
  /** Payments a verifier sent back, kept as a trail. */
  rejectedPayments?: InvoicePayment[];
  verifiedBy?: string;
  verifiedAt?: string;
  /** Id of the income entry this invoice produced once its payment was verified. */
  incomeId?: string;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  cancelledBy?: string;
  cancelledAt?: string;
}

export function getFinancialYearForDate(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1; // Apr–Dec → this year; Jan–Mar → previous year
  return `${startYear}-${startYear + 1}`;
}

export function incomeIdForInvoice(invoiceId: string): string {
  return `inc_inv_${invoiceId}`;
}

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function computeInvoiceTotals(lineItems: InvoiceLine[], taxPercent: number) {
  const subtotal = round2(lineItems.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0));
  const taxAmount = round2((subtotal * (Number(taxPercent) || 0)) / 100);
  return { subtotal, taxAmount, totalAmount: round2(subtotal + taxAmount) };
}

/**
 * The income entry a verified invoice payment turns into. Lives in the same
 * `incomeSources` collection as sponsorships/grants/donations, under the
 * "Other Income" head, with enough back-references to trace it to the invoice.
 */
export function buildIncomeFromInvoice(invoice: InvoiceItem, verifiedBy: string) {
  const payment = invoice.payment!;
  return {
    id: incomeIdForInvoice(invoice.id),
    name: `Invoice ${invoice.invoiceNumber} — ${invoice.clientName}`,
    amount: payment.amount,
    type: 'other' as const,
    source: 'invoice' as const,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    clientName: invoice.clientName,
    paymentMode: payment.mode,
    paymentReference: payment.reference,
    financialYear: getFinancialYearForDate(payment.paidOn),
    receivedDate: payment.paidOn,
    notes: `Payment verified by ${verifiedBy} for invoice ${invoice.invoiceNumber}.`,
    submittedBy: verifiedBy,
    createdAt: new Date().toISOString().split('T')[0],
  };
}
