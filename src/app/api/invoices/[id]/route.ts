import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { saveBase64File } from '@/lib/file-storage';
import { requireSession, requirePermission } from '@/lib/session';
import { canVerifyInvoicePayment } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { buildIncomeFromInvoice, type InvoiceItem, type InvoicePayment } from '@/lib/finance';

export const maxDuration = 60;

const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const MAX_PROOF_FILES = 3;
const PAYMENT_MODES = ['Bank Transfer', 'UPI', 'Cheque', 'Cash', 'Other'];
const today = () => new Date().toISOString().split('T')[0];

/**
 * Invoice lifecycle — every transition is validated here, not trusted from the client:
 *   Issued ──record-payment──▶ Payment Recorded ──verify-payment──▶ Paid (+ income entry)
 *      ▲                              │
 *      └──────reject-payment──────────┘        cancel: Issued / Payment Recorded → Cancelled
 * Verifying books the received amount into `incomeSources` (Other Income, sourced to the invoice).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const body = await request.json();

    const existing = (await readCollection<InvoiceItem>('invoices')).find(i => i.id === id);
    if (!existing) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });

    let next: InvoiceItem;
    let income: ReturnType<typeof buildIncomeFromInvoice> | undefined;

    switch (body.action) {
      case 'record-payment': {
        if (existing.status !== 'Issued') throw new Error('A payment can only be recorded against an issued, unpaid invoice.');
        const p = body.payment || {};
        const amount = Number(p.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter the amount received.');
        if (amount > existing.totalAmount + 0.005) throw new Error(`The amount received cannot exceed the invoice total (₹${existing.totalAmount.toLocaleString('en-IN')}).`);
        if (!PAYMENT_MODES.includes(p.mode)) throw new Error('Select how the payment was made.');
        const reference = typeof p.reference === 'string' ? p.reference.trim() : '';
        if (!reference) throw new Error('Enter the transaction / cheque / receipt reference so the payment can be verified.');
        if (!p.paidOn || Number.isNaN(new Date(p.paidOn).getTime())) throw new Error('Enter the date the payment was received.');

        const files = Array.isArray(p.proofFiles) ? p.proofFiles : [];
        if (files.length > MAX_PROOF_FILES) throw new Error(`Maximum ${MAX_PROOF_FILES} proof files allowed.`);
        const attempt = (existing.rejectedPayments?.length || 0) + 1;
        const proofFiles = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (typeof f?.dataUrl !== 'string' || !f.dataUrl.startsWith('data:')) throw new Error('A proof file could not be read. Please re-attach it.');
          if (Math.floor((f.dataUrl.length * 3) / 4) > MAX_PROOF_BYTES) throw new Error(`"${f.name || 'File'}" exceeds the 10 MB per-file limit.`);
          const stored = await saveBase64File('invoices', id, attempt * 10 + i, f.name || 'proof', f.dataUrl);
          proofFiles.push({ name: f.name, url: stored.url, storageKey: stored.storageKey, type: f.type });
        }
        const payment: InvoicePayment = {
          amount, mode: p.mode, reference, paidOn: p.paidOn, proofFiles,
          recordedBy: actor.name, recordedByEmail: actor.email, recordedAt: today(),
        };
        next = { ...existing, status: 'Payment Recorded', payment };
        break;
      }

      case 'verify-payment': {
        requirePermission(canVerifyInvoicePayment(actor), 'Only the Super User or CEO can verify a payment.');
        if (existing.status !== 'Payment Recorded' || !existing.payment) throw new Error('There is no recorded payment awaiting verification on this invoice.');
        // Four eyes: whoever recorded the payment cannot also be the one to confirm it (root Super User excepted).
        const sameAsRecorder = existing.payment.recordedByEmail?.toLowerCase() === String(actor.email || '').toLowerCase();
        if (sameAsRecorder && actor.tier !== 1) throw new Error('A different person must verify a payment you recorded yourself.');
        next = { ...existing, status: 'Paid', verifiedBy: actor.name, verifiedAt: today() };
        income = buildIncomeFromInvoice(next, actor.name);
        next.incomeId = income.id;
        break;
      }

      case 'reject-payment': {
        requirePermission(canVerifyInvoicePayment(actor), 'Only the Super User or CEO can send a payment back.');
        if (existing.status !== 'Payment Recorded' || !existing.payment) throw new Error('There is no recorded payment awaiting verification on this invoice.');
        const note = typeof body.note === 'string' ? body.note.trim() : '';
        if (!note) throw new Error('Say why the payment is being sent back.');
        next = {
          ...existing,
          status: 'Issued',
          payment: undefined,
          rejectedPayments: [...(existing.rejectedPayments || []), { ...existing.payment, rejectionNote: note }],
        };
        break;
      }

      case 'cancel': {
        if (existing.status === 'Paid') throw new Error('A paid invoice cannot be cancelled.');
        if (existing.status === 'Cancelled') throw new Error('This invoice is already cancelled.');
        const isCreator = existing.createdByEmail?.toLowerCase() === String(actor.email || '').toLowerCase();
        requirePermission(isCreator || (typeof actor.tier === 'number' && actor.tier <= 2), 'Only the person who issued the invoice, the CEO or Super User can cancel it.');
        next = { ...existing, status: 'Cancelled', cancelledBy: actor.name, cancelledAt: today() };
        break;
      }

      default:
        throw new Error('Unknown invoice action.');
    }

    // Persist the invoice first; only then book the income, so a failure can never leave income without a Paid invoice.
    await mutateCollection('invoices', (current: any[]) => current.map(i => (i.id === id ? next : i)));
    if (income) {
      const entry = income;
      await mutateCollection('incomeSources', (current: any[]) => [entry, ...current.filter(i => i.id !== entry.id)]);
    }
    return NextResponse.json({ invoice: next, income });
  } catch (err: any) {
    return apiError(err, 'invoices-id-api-patch', 400);
  }
}
