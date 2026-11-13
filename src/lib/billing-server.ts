/**
 * billing-server.ts — server-only helpers shared by the bookings, invoices,
 * payments and inventory API routes.
 */
import { readCollection, mutateCollection } from './server-db';
import {
  Invoice, InvoiceLine, Payment, Room, BillingSettings, DEFAULT_BILLING_SETTINGS,
  nextInvoiceNumber, deriveInvoiceStatus, invoiceTotal,
} from './billing';

/** Throw a user-facing validation error (apiError forwards plain Error messages). */
export function bad(message: string): never {
  throw new Error(message);
}

export function str(v: unknown, max = 300): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

export function isoDay(v: unknown, fallback: string): string {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(day: string, days: number): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getBillingSettings(): Promise<BillingSettings> {
  const rows = await readCollection<BillingSettings>('billingSettings');
  return { ...DEFAULT_BILLING_SETTINGS, ...(rows[0] || {}), id: 'default' };
}

export function cleanLines(raw: unknown): InvoiceLine[] {
  if (!Array.isArray(raw) || raw.length === 0) bad('Add at least one line item to the invoice.');
  if (raw.length > 100) bad('An invoice can have at most 100 line items.');
  return raw.map((l: any, i: number) => {
    const description = str(l?.description, 200);
    const quantity = num(l?.quantity, 1);
    const unitPrice = num(l?.unitPrice);
    const taxPercent = num(l?.taxPercent);
    if (!description) bad(`Line ${i + 1}: description is required.`);
    if (quantity <= 0) bad(`Line ${i + 1}: quantity must be greater than zero.`);
    if (unitPrice < 0) bad(`Line ${i + 1}: price cannot be negative.`);
    if (taxPercent < 0 || taxPercent > 100) bad(`Line ${i + 1}: tax must be between 0 and 100%.`);
    return { description, quantity, unitPrice, taxPercent };
  });
}

export interface NewInvoiceInput {
  customerId?: string;
  customerName: string;
  customerEmail?: string;
  customerOrganisation?: string;
  issueDate?: string;
  dueDate?: string;
  lines: InvoiceLine[];
  discount?: number;
  notes?: string;
  source: 'Manual' | 'Booking';
  bookingId?: string;
}

/**
 * Create an invoice with the next sequential number. The number is derived
 * inside the collection's write lock, so two simultaneous requests can never
 * be issued the same number.
 */
export async function createInvoice(input: NewInvoiceInput, actor: { id: string; name: string }): Promise<Invoice> {
  const settings = await getBillingSettings();
  const issueDate = isoDay(input.issueDate, todayISO());
  const dueDate = isoDay(input.dueDate, addDaysISO(issueDate, settings.defaultDueDays));
  if (dueDate < issueDate) bad('Due date cannot be before the issue date.');
  const discount = Math.max(0, num(input.discount));
  let created!: Invoice;
  await mutateCollection<Invoice>('invoices', (current) => {
    const inv: Invoice = {
      id: 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      number: nextInvoiceNumber(current, new Date(issueDate + 'T00:00:00')),
      customerId: input.customerId,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerOrganisation: input.customerOrganisation,
      issueDate,
      dueDate,
      lines: input.lines,
      discount,
      notes: input.notes,
      status: 'Unpaid',
      source: input.source,
      bookingId: input.bookingId,
      createdById: actor.id,
      createdByName: actor.name,
      createdAt: new Date().toISOString(),
    };
    if (invoiceTotal(inv) <= 0) bad('Invoice total must be greater than zero.');
    created = inv;
    return [...current, inv];
  });
  return created;
}

/** Recompute an invoice's status from its verified payments and persist it. */
export async function syncInvoiceStatus(invoiceId: string): Promise<void> {
  const payments = await readCollection<Payment>('payments');
  await mutateCollection<Invoice>('invoices', (current) =>
    current.map(inv => (inv.id === invoiceId ? { ...inv, status: deriveInvoiceStatus(inv, payments) } : inv))
  );
}

export function cleanRoom(b: any, base?: Room): Room {
  const name = str(b.name, 80);
  if (!name) bad('Room name is required.');
  const capacity = Math.round(num(b.capacity, 1));
  const hourlyRate = num(b.hourlyRate);
  const gstPercent = num(b.gstPercent);
  if (capacity < 1) bad('Capacity must be at least 1.');
  if (hourlyRate < 0) bad('Hourly rate cannot be negative.');
  if (gstPercent < 0 || gstPercent > 100) bad('GST must be between 0 and 100%.');
  return {
    id: base?.id || 'room_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name, capacity, hourlyRate, gstPercent,
    location: str(b.location, 120),
    amenities: str(b.amenities, 300),
    active: b.active === undefined ? base?.active ?? true : !!b.active,
    createdAt: base?.createdAt || new Date().toISOString(),
  };
}

