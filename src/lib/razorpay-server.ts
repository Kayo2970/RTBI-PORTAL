/**
 * razorpay-server.ts — server-only Razorpay helpers: credential store, REST calls, signature checks and the
 * idempotent "settle this invoice" step shared by the browser verify route and the webhook.
 *
 * Credentials live in the `razorpaySettings` collection (single row, encrypted at rest by server-db) and are
 * only ever returned to the client as booleans. `RAZORPAY_API_BASE` can point at a stub for local testing.
 */
import crypto from 'crypto';
import { readCollection, mutateCollection } from './server-db';
import { buildIncomeFromInvoice, type InvoiceItem } from './finance';

export interface RazorpayConfig {
  enabled: boolean;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/** A refusal the caller should treat as final (no retry): wrong amount, cancelled invoice, mismatched order… */
export class SettleRejected extends Error {}

export const KEY_ID_PATTERN = /^rzp_(test|live)_[A-Za-z0-9]{6,}$/;

export function razorpayMode(keyId: string): 'live' | 'test' {
  return keyId.startsWith('rzp_live_') ? 'live' : 'test';
}

const apiBase = () => (process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com').replace(/\/$/, '');

export async function readRazorpayRow(): Promise<Partial<RazorpayConfig> & { updatedAt?: string; updatedBy?: string }> {
  const rows = await readCollection<any>('razorpaySettings');
  return rows.find(r => r.id === 'default') || {};
}

/** Complete credentials, or null when Razorpay has not been set up. `requireEnabled` is false for the Settings "test" button. */
export async function getRazorpayConfig(requireEnabled = true): Promise<RazorpayConfig | null> {
  const row = await readRazorpayRow();
  if (!row.keyId || !row.keySecret) return null;
  if (requireEnabled && !row.enabled) return null;
  return { enabled: !!row.enabled, keyId: row.keyId, keySecret: row.keySecret, webhookSecret: row.webhookSecret || '' };
}

export async function saveRazorpayRow(patch: Record<string, unknown>) {
  await mutateCollection<any>('razorpaySettings', (cur) => {
    const idx = cur.findIndex(r => r.id === 'default');
    const next = { ...(idx === -1 ? { id: 'default' } : cur[idx]), ...patch };
    if (idx === -1) return [...cur, next];
    const out = [...cur];
    out[idx] = next;
    return out;
  });
}

export interface RazorpayPayment {
  id: string;
  order_id?: string;
  amount: number; // paise
  currency: string;
  status: string; // created | authorized | captured | refunded | failed
  method?: string;
  email?: string;
  contact?: string;
  notes?: Record<string, string> | unknown[];
}

async function rzp<T>(cfg: RazorpayConfig, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${apiBase()}/v1${path}`, {
    method: init.method || 'GET',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const desc = data?.error?.description || `Razorpay request failed (HTTP ${res.status}).`;
    throw new Error(res.status === 401 ? 'Razorpay rejected the API keys (401). Check the Key ID and Key Secret in Settings.' : desc);
  }
  return data as T;
}

export const createOrder = (cfg: RazorpayConfig, o: { amountPaise: number; receipt: string; notes: Record<string, string> }) =>
  rzp<{ id: string; amount: number; currency: string }>(cfg, '/orders', { method: 'POST', body: { amount: o.amountPaise, currency: 'INR', receipt: o.receipt, notes: o.notes } });

export const fetchPayment = (cfg: RazorpayConfig, id: string) => rzp<RazorpayPayment>(cfg, `/payments/${encodeURIComponent(id)}`);

export const capturePayment = (cfg: RazorpayConfig, id: string, amountPaise: number) =>
  rzp<RazorpayPayment>(cfg, `/payments/${encodeURIComponent(id)}/capture`, { method: 'POST', body: { amount: amountPaise, currency: 'INR' } });

/** Cheap authenticated call used by Settings → "Test connection". */
export const pingRazorpay = (cfg: RazorpayConfig) => rzp<unknown>(cfg, '/orders?count=1');

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const hmacHex = (secret: string, payload: string) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

/** Checkout success signature: HMAC-SHA256(order_id|payment_id) with the Key Secret. */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  return !!signature && safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature);
}

/** Webhook signature: HMAC-SHA256(raw body) with the webhook secret, sent as X-Razorpay-Signature. */
export function verifyWebhookSignature(rawBody: string, signature: string, webhookSecret: string): boolean {
  return !!signature && !!webhookSecret && safeEqualHex(hmacHex(webhookSecret, rawBody), signature);
}

const today = () => new Date().toISOString().split('T')[0];

/**
 * Mark the invoice Paid from a Razorpay payment that has ALREADY been authenticated (signature) and confirmed
 * captured by the caller. Idempotent: replaying the same payment id (webhook after browser verify, retries) is a no-op.
 * The amount must equal the invoice total — there are no part payments on this path.
 */
export async function settleInvoiceFromRazorpay(invoiceId: string, rp: RazorpayPayment): Promise<{ invoice: InvoiceItem; income?: ReturnType<typeof buildIncomeFromInvoice>; alreadySettled: boolean }> {
  if (rp.status !== 'captured') throw new SettleRejected(`Payment ${rp.id} is ${rp.status}, not captured.`);
  let result: { invoice: InvoiceItem; income?: ReturnType<typeof buildIncomeFromInvoice>; alreadySettled: boolean } | undefined;

  await mutateCollection<InvoiceItem>('invoices', (cur) => {
    const idx = cur.findIndex(i => i.id === invoiceId);
    if (idx === -1) throw new SettleRejected('Invoice not found.');
    const inv = cur[idx];
    if (inv.status === 'Paid') {
      if (inv.payment?.gateway?.paymentId === rp.id) { result = { invoice: inv, alreadySettled: true }; return cur; }
      throw new SettleRejected(`Invoice ${inv.invoiceNumber} is already paid by another payment — refund ${rp.id} in Razorpay.`);
    }
    if (inv.status === 'Cancelled') throw new SettleRejected(`Invoice ${inv.invoiceNumber} was cancelled — refund ${rp.id} in Razorpay.`);
    const paid = rp.amount / 100;
    if (Math.abs(paid - inv.totalAmount) > 0.005) {
      throw new SettleRejected(`Razorpay captured ₹${paid} but invoice ${inv.invoiceNumber} is ₹${inv.totalAmount}. Reconcile ${rp.id} manually.`);
    }
    const now = today();
    const superseded = inv.status === 'Payment Recorded' && inv.payment
      ? [...(inv.rejectedPayments || []), { ...inv.payment, rejectionNote: `Superseded by online payment ${rp.id}.` }]
      : inv.rejectedPayments;
    const next: InvoiceItem = {
      ...inv,
      status: 'Paid',
      payment: {
        amount: inv.totalAmount, mode: 'Razorpay', reference: rp.id, paidOn: now, proofFiles: [],
        recordedBy: 'Razorpay', recordedByEmail: '', recordedAt: now,
        gateway: { provider: 'razorpay', paymentId: rp.id, orderId: rp.order_id || '', method: rp.method, email: rp.email, contact: rp.contact },
      },
      rejectedPayments: superseded,
      verifiedBy: 'Razorpay (auto-verified)',
      verifiedAt: now,
    };
    const income = buildIncomeFromInvoice(next, 'Razorpay');
    next.incomeId = income.id;
    result = { invoice: next, income, alreadySettled: false };
    const out = [...cur];
    out[idx] = next;
    return out;
  });

  if (result?.income) {
    const entry = result.income;
    await mutateCollection<any>('incomeSources', (cur) => [entry, ...cur.filter(i => i.id !== entry.id)]);
  }
  return result!;
}
