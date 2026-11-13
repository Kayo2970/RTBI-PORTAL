'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Plus, Download, Receipt, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import { api, readStoredUser } from '@/lib/billing-client';
import { canManageBilling } from '@/lib/permissions';
import { downloadInvoicePdf } from '@/lib/invoice-pdf';
import {
  Invoice, Payment, BillingSettings, InvoiceLine, PAYMENT_METHODS, DEFAULT_BILLING_SETTINGS,
  computeTotals, amountPaid, amountCommitted, deriveInvoiceStatus, formatINR, upiLink,
} from '@/lib/billing';
import { Field, Modal, Badge, Banner, Panel, inputCls, btnPrimary, btnGhost, btnDanger, fmtDate, fmtDateTime } from '@/components/billing-ui';

type Tab = 'invoices' | 'payments' | 'setup';
const today = () => new Date().toISOString().slice(0, 10);

function invoiceTone(status: string, overdue: boolean): 'green' | 'amber' | 'red' | 'grey' | 'blue' {
  if (status === 'Paid') return 'green';
  if (status === 'Void') return 'grey';
  if (overdue) return 'red';
  if (status === 'Partially Paid') return 'blue';
  return 'amber';
}

export default function InvoicesPage() {
  const [user, setUser] = useState<any>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>('invoices');
  const [filter, setFilter] = useState<'all' | 'open' | 'paid'>('all');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const staff = canManageBilling(user);

  const load = useCallback(async () => {
    try {
      const [i, p, s] = await Promise.all([api<Invoice[]>('/api/invoices'), api<Payment[]>('/api/payments'), api<BillingSettings>('/api/billing-settings')]);
      setInvoices(i); setPayments(p); setSettings(s);
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setUser(readStoredUser()); load(); }, [load]);

  const rows = useMemo(() => invoices.map(inv => {
    const total = computeTotals(inv.lines, inv.discount).total;
    const paid = amountPaid(inv.id, payments);
    const status = deriveInvoiceStatus(inv, payments);
    const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
    const overdue = (status === 'Unpaid' || status === 'Partially Paid') && inv.dueDate < today();
    return { inv, total, paid, status, balance, overdue };
  }), [invoices, payments]);

  const visible = rows.filter(r => filter === 'all' ? true : filter === 'paid' ? r.status === 'Paid' : r.status === 'Unpaid' || r.status === 'Partially Paid');
  const outstanding = rows.filter(r => r.status !== 'Void').reduce((s, r) => s + r.balance, 0);
  const collected = rows.reduce((s, r) => s + r.paid, 0);
  const overdueAmt = rows.filter(r => r.overdue).reduce((s, r) => s + r.balance, 0);
  const pendingPayments = payments.filter(p => p.status === 'Pending Verification');
  const open = rows.find(r => r.inv.id === openId) || null;

  async function review(p: Payment, action: 'verify' | 'reject') {
    let reason = '';
    if (action === 'reject') {
      reason = prompt('Reason for rejecting this payment (shown to the payer):') || '';
      if (!reason.trim()) return;
    }
    try {
      await api(`/api/payments/${p.id}`, 'PATCH', { action, reason });
      setMsg({ kind: 'ok', text: action === 'verify' ? `Payment verified — ${p.invoiceNumber} updated.` : 'Payment rejected.' });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary">Invoices &amp; Payments</h1>
          <p className="text-xs text-theme-text-secondary">{staff ? 'Raise invoices with a full breakup, track dues and verify payments.' : 'Your invoices and payments.'}</p>
        </div>
        {staff && <button className={btnPrimary} onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New invoice</button>}
      </div>

      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Panel><p className="text-[11px] text-theme-text-secondary">Outstanding</p><p className="text-lg font-bold text-theme-text-primary">{formatINR(outstanding)}</p></Panel>
        <Panel><p className="text-[11px] text-theme-text-secondary">Overdue</p><p className="text-lg font-bold text-red-500">{formatINR(overdueAmt)}</p></Panel>
        <Panel><p className="text-[11px] text-theme-text-secondary">Collected</p><p className="text-lg font-bold text-emerald-500">{formatINR(collected)}</p></Panel>
        <Panel><p className="text-[11px] text-theme-text-secondary">{staff ? 'Awaiting verification' : 'Awaiting review'}</p><p className="text-lg font-bold text-theme-text-primary">{pendingPayments.length}</p></Panel>
      </div>

      <div role="tablist" className="flex gap-2">
        {(['invoices', 'payments', ...(staff ? ['setup'] : [])] as Tab[]).map(t => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer border ${tab === t ? 'bg-accent text-white border-accent' : 'border-theme-card-border text-theme-text-secondary'}`}>
            {t === 'invoices' ? 'Invoices' : t === 'payments' ? `Payments${staff && pendingPayments.length ? ` (${pendingPayments.length})` : ''}` : 'Payment setup'}
          </button>
        ))}
      </div>

      {tab === 'invoices' && (
        <section className="space-y-3">
          <div className="flex gap-2">
            {(['all', 'open', 'paid'] as const).map(f => (
              <button key={f} className={btnGhost} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'open' ? 'Due' : 'Paid'}</button>
            ))}
          </div>
          <Panel className="!p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-theme-text-secondary border-b border-theme-card-border">
                  <th className="p-3 font-semibold">Invoice</th>
                  {staff && <th className="p-3 font-semibold">Customer</th>}
                  <th className="p-3 font-semibold">Due</th>
                  <th className="p-3 font-semibold text-right">Total</th>
                  <th className="p-3 font-semibold text-right">Balance</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="p-6 text-center text-theme-text-secondary">Loading…</td></tr>}
                {!loading && visible.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-theme-text-secondary">No invoices to show.</td></tr>}
                {visible.map(r => (
                  <tr key={r.inv.id} className="border-b border-theme-card-border/50 text-theme-text-primary">
                    <td className="p-3 font-semibold whitespace-nowrap">{r.inv.number}<span className="block font-normal text-theme-text-secondary">{r.inv.source === 'Booking' ? 'Room booking' : 'Manual'}</span></td>
                    {staff && <td className="p-3">{r.inv.customerName}{r.inv.customerOrganisation ? <span className="block text-theme-text-secondary">{r.inv.customerOrganisation}</span> : null}</td>}
                    <td className="p-3 whitespace-nowrap">{fmtDate(r.inv.dueDate)}</td>
                    <td className="p-3 text-right whitespace-nowrap">{formatINR(r.total)}</td>
                    <td className="p-3 text-right whitespace-nowrap font-semibold">{r.status === 'Void' ? '—' : formatINR(r.balance)}</td>
                    <td className="p-3"><Badge tone={invoiceTone(r.status, r.overdue)}>{r.overdue ? 'Overdue' : r.status}</Badge></td>
                    <td className="p-3 text-right"><button className={btnGhost} onClick={() => setOpenId(r.inv.id)}>{r.balance > 0 && r.status !== 'Void' ? (staff ? 'Open' : 'View / Pay') : 'View'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </section>
      )}

      {tab === 'payments' && (
        <Panel className="!p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-theme-text-secondary border-b border-theme-card-border">
                <th className="p-3 font-semibold">Submitted</th><th className="p-3 font-semibold">Invoice</th>
                {staff && <th className="p-3 font-semibold">By</th>}
                <th className="p-3 font-semibold">Method / reference</th><th className="p-3 font-semibold text-right">Amount</th>
                <th className="p-3 font-semibold">Status</th>{staff && <th className="p-3" />}
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-theme-text-secondary">No payments yet.</td></tr>}
              {payments.map(p => (
                <tr key={p.id} className="border-b border-theme-card-border/50 text-theme-text-primary">
                  <td className="p-3 whitespace-nowrap">{fmtDateTime(p.createdAt)}</td>
                  <td className="p-3 whitespace-nowrap">{p.invoiceNumber}</td>
                  {staff && <td className="p-3">{p.submittedByName}</td>}
                  <td className="p-3">{p.method}{p.reference ? <span className="block text-theme-text-secondary">{p.reference}</span> : null}</td>
                  <td className="p-3 text-right whitespace-nowrap">{formatINR(p.amount)}</td>
                  <td className="p-3">
                    <Badge tone={p.status === 'Verified' ? 'green' : p.status === 'Rejected' ? 'red' : 'amber'}>{p.status}</Badge>
                    {p.rejectReason && <span className="block text-theme-text-secondary mt-1">{p.rejectReason}</span>}
                  </td>
                  {staff && (
                    <td className="p-3 text-right whitespace-nowrap">
                      {p.status === 'Pending Verification' && (
                        <span className="inline-flex gap-2">
                          <button className={btnPrimary} onClick={() => review(p, 'verify')}><CheckCircle2 className="h-4 w-4" /> Verify</button>
                          <button className={btnDanger} onClick={() => review(p, 'reject')}><XCircle className="h-4 w-4" /> Reject</button>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === 'setup' && staff && <SetupForm settings={settings} onSaved={(s) => { setSettings(s); setMsg({ kind: 'ok', text: 'Payment settings saved.' }); }} onError={(t) => setMsg({ kind: 'error', text: t })} />}

      {creating && <CreateInvoice settings={settings} onClose={() => setCreating(false)} onDone={async (n) => { setCreating(false); setMsg({ kind: 'ok', text: `Invoice ${n} created.` }); await load(); }} />}

      {open && (
        <InvoiceDetail
          row={open} payments={payments.filter(p => p.invoiceId === open.inv.id)} settings={settings} staff={staff}
          onClose={() => setOpenId(null)}
          onChanged={async (text) => { if (text) setMsg({ kind: 'ok', text }); await load(); }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ setup

function SetupForm({ settings, onSaved, onError }: { settings: BillingSettings; onSaved: (s: BillingSettings) => void; onError: (t: string) => void }) {
  const [v, setV] = useState<any>({ ...settings });
  useEffect(() => setV({ ...settings }), [settings]);
  const set = (k: string) => (e: React.ChangeEvent<any>) => setV({ ...v, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { onSaved(await api<BillingSettings>('/api/billing-settings', 'PUT', { ...v, defaultDueDays: Number(v.defaultDueDays) })); } catch (err: any) { onError(err.message); }
  }
  return (
    <Panel>
      <form onSubmit={save} className="space-y-4 max-w-2xl">
        <p className="text-xs text-theme-text-secondary">Shown on every invoice and in the “pay now” screen. Customers pay to these details, then submit the reference for you to verify.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Business name *"><input required className={inputCls} value={v.businessName || ''} onChange={set('businessName')} /></Field>
          <Field label="GSTIN"><input className={inputCls} value={v.gstin || ''} onChange={set('gstin')} /></Field>
          <Field label="UPI ID" hint="Enables a scannable QR with the exact amount"><input className={inputCls} placeholder="rtbi@bank" value={v.upiId || ''} onChange={set('upiId')} /></Field>
          <Field label="Default due (days after issue)"><input type="number" min="0" className={inputCls} value={v.defaultDueDays ?? 7} onChange={set('defaultDueDays')} /></Field>
          <Field label="Bank name"><input className={inputCls} value={v.bankName || ''} onChange={set('bankName')} /></Field>
          <Field label="Account holder"><input className={inputCls} value={v.accountName || ''} onChange={set('accountName')} /></Field>
          <Field label="Account number"><input className={inputCls} value={v.accountNumber || ''} onChange={set('accountNumber')} /></Field>
          <Field label="IFSC"><input className={inputCls} value={v.ifsc || ''} onChange={set('ifsc')} /></Field>
        </div>
        <Field label="Address (printed on invoice)"><textarea rows={2} className={inputCls} value={v.address || ''} onChange={set('address')} /></Field>
        <Field label="Payment terms (printed on invoice)"><textarea rows={2} className={inputCls} value={v.terms || ''} onChange={set('terms')} /></Field>
        <button className={btnPrimary} type="submit">Save settings</button>
      </form>
    </Panel>
  );
}

// ---------------------------------------------------------------- create

function CreateInvoice({ settings, onClose, onDone }: { settings: BillingSettings; onClose: () => void; onDone: (number: string) => void }) {
  const [members, setMembers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + settings.defaultDueDays); return d.toISOString().slice(0, 10); });
  const [lines, setLines] = useState<InvoiceLine[]>([{ description: '', quantity: 1, unitPrice: 0, taxPercent: 18 }]);
  const [discount, setDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<any[]>('/api/members').then(m => setMembers(m.filter(x => x.status !== 'Terminated'))).catch(() => {}); }, []);
  const totals = computeTotals(lines, Number(discount) || 0);
  const setLine = (i: number, patch: Partial<InvoiceLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const inv = await api<Invoice>('/api/invoices', 'POST', { customerId: customerId || undefined, customerName, issueDate, dueDate, lines, discount: Number(discount) || 0, notes });
      onDone(inv.number);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="New invoice" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Member (startup / employee)">
            <select className={inputCls} value={customerId} onChange={e => setCustomerId(e.target.value)}>
              <option value="">— Not a portal member —</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name} ({m.division})</option>)}
            </select>
          </Field>
          {!customerId && <Field label="Customer name *"><input required className={inputCls} value={customerName} onChange={e => setCustomerName(e.target.value)} /></Field>}
          <Field label="Issue date"><input type="date" className={inputCls} value={issueDate} onChange={e => setIssueDate(e.target.value)} /></Field>
          <Field label="Due date"><input type="date" min={issueDate} className={inputCls} value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field>
        </div>
        <p className="text-[11px] text-theme-text-secondary">The invoice number is assigned automatically when you save.</p>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-theme-text-primary">Breakup of what is due</p>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-12 sm:col-span-5"><input aria-label={`Line ${i + 1} description`} required placeholder="Description (e.g. Incubation fee — Q3)" className={inputCls} value={l.description} onChange={e => setLine(i, { description: e.target.value })} /></div>
              <div className="col-span-3 sm:col-span-1"><input aria-label="Quantity" type="number" min="0" step="any" className={inputCls} value={l.quantity} onChange={e => setLine(i, { quantity: Number(e.target.value) })} /></div>
              <div className="col-span-4 sm:col-span-2"><input aria-label="Unit price" type="number" min="0" step="any" className={inputCls} value={l.unitPrice} onChange={e => setLine(i, { unitPrice: Number(e.target.value) })} /></div>
              <div className="col-span-3 sm:col-span-2"><input aria-label="Tax percent" type="number" min="0" max="100" step="any" className={inputCls} value={l.taxPercent} onChange={e => setLine(i, { taxPercent: Number(e.target.value) })} /></div>
              <div className="col-span-2 sm:col-span-2 flex items-center justify-end gap-2 text-xs text-theme-text-primary">
                <span>{formatINR(totals.lines[i]?.gross || 0)}</span>
                {lines.length > 1 && <button type="button" aria-label="Remove line" className="text-red-500 cursor-pointer" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-theme-text-secondary">Columns: description · qty · unit price (₹) · tax % · amount</p>
          <button type="button" className={btnGhost} onClick={() => setLines([...lines, { description: '', quantity: 1, unitPrice: 0, taxPercent: 18 }])}><Plus className="h-3.5 w-3.5" /> Add line</button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Notes"><textarea rows={3} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
          <div className="text-xs space-y-1 text-theme-text-primary self-end">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatINR(totals.subtotal)}</span></div>
            <div className="flex justify-between items-center"><span>Discount (₹)</span><input aria-label="Discount" type="number" min="0" step="any" className={inputCls + ' !w-28 !py-1 text-right'} value={discount} onChange={e => setDiscount(e.target.value)} /></div>
            <div className="flex justify-between"><span>Tax</span><span>{formatINR(totals.tax)}</span></div>
            <div className="flex justify-between font-bold text-sm border-t border-theme-card-border pt-1"><span>Total due</span><span>{formatINR(totals.total)}</span></div>
          </div>
        </div>
        {error && <Banner kind="error">{error}</Banner>}
        <button className={btnPrimary + ' w-full'} disabled={busy} type="submit">{busy ? 'Creating…' : 'Create invoice'}</button>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- detail

function InvoiceDetail({ row, payments, settings, staff, onClose, onChanged }: {
  row: { inv: Invoice; total: number; paid: number; status: string; balance: number; overdue: boolean };
  payments: Payment[]; settings: BillingSettings; staff: boolean; onClose: () => void; onChanged: (text?: string) => void;
}) {
  const { inv } = row;
  const t = computeTotals(inv.lines, inv.discount);
  const committed = amountCommitted(inv.id, payments);
  const payable = Math.max(0, Math.round((row.total - committed) * 100) / 100);
  const canPay = inv.status !== 'Void' && row.status !== 'Paid' && payable > 0;
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  async function voidInvoice() {
    if (!confirm(`Void ${inv.number}? This cannot be undone.`)) return;
    try { await api(`/api/invoices/${inv.id}`, 'PATCH', { action: 'void' }); onChanged(`${inv.number} voided.`); onClose(); } catch (e: any) { setError(e.message); }
  }

  return (
    <Modal title={`Invoice ${inv.number}`} onClose={onClose} wide>
      <div className="space-y-4 text-xs text-theme-text-primary">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <p className="font-bold text-sm">{inv.customerName}</p>
            {inv.customerOrganisation && <p className="text-theme-text-secondary">{inv.customerOrganisation}</p>}
            {inv.customerEmail && <p className="text-theme-text-secondary">{inv.customerEmail}</p>}
          </div>
          <div className="text-right text-theme-text-secondary">
            <p>Issued {fmtDate(inv.issueDate)}</p><p>Due {fmtDate(inv.dueDate)}</p>
            <Badge tone={invoiceTone(row.status, row.overdue)}>{row.overdue ? 'Overdue' : row.status}</Badge>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-theme-card-border">
          <table className="w-full">
            <thead><tr className="text-left text-theme-text-secondary border-b border-theme-card-border">
              <th className="p-2">Description</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">Tax</th><th className="p-2 text-right">Amount</th>
            </tr></thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i} className="border-b border-theme-card-border/50">
                  <td className="p-2">{l.description}</td><td className="p-2 text-right">{l.quantity}</td>
                  <td className="p-2 text-right">{formatINR(l.unitPrice)}</td>
                  <td className="p-2 text-right">{l.taxPercent}% · {formatINR(t.lines[i].tax)}</td>
                  <td className="p-2 text-right">{formatINR(t.lines[i].gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto max-w-xs space-y-1">
          <div className="flex justify-between"><span>Subtotal</span><span>{formatINR(t.subtotal)}</span></div>
          {t.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>− {formatINR(t.discount)}</span></div>}
          <div className="flex justify-between"><span>Tax</span><span>{formatINR(t.tax)}</span></div>
          <div className="flex justify-between font-bold border-t border-theme-card-border pt-1"><span>Total</span><span>{formatINR(t.total)}</span></div>
          <div className="flex justify-between"><span>Paid</span><span>{formatINR(row.paid)}</span></div>
          <div className="flex justify-between font-bold"><span>Balance</span><span>{inv.status === 'Void' ? '—' : formatINR(row.balance)}</span></div>
        </div>
        {inv.notes && <p className="text-theme-text-secondary">Notes: {inv.notes}</p>}

        {payments.length > 0 && (
          <div>
            <p className="font-semibold mb-1">Payments</p>
            {payments.map(p => (
              <p key={p.id} className="flex flex-wrap justify-between gap-2 py-1 border-b border-theme-card-border/40">
                <span>{fmtDate(p.paidOn)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                <span>{formatINR(p.amount)} <Badge tone={p.status === 'Verified' ? 'green' : p.status === 'Rejected' ? 'red' : 'amber'}>{p.status}</Badge></span>
              </p>
            ))}
          </div>
        )}

        {error && <Banner kind="error">{error}</Banner>}

        {paying ? (
          <PayForm inv={inv} payable={payable} settings={settings} staff={staff} onCancel={() => setPaying(false)}
            onDone={(text) => { setPaying(false); onChanged(text); onClose(); }} />
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {canPay && <button className={btnPrimary} onClick={() => setPaying(true)}><Receipt className="h-4 w-4" /> {staff ? 'Record payment' : 'Pay now'}</button>}
            <button className={btnGhost} onClick={() => downloadInvoicePdf(inv, payments, settings)}><Download className="h-4 w-4" /> Download PDF</button>
            {staff && inv.status !== 'Void' && payments.filter(p => p.status !== 'Rejected').length === 0 && <button className={btnDanger} onClick={voidInvoice}>Void invoice</button>}
          </div>
        )}
        {!canPay && row.status !== 'Paid' && inv.status !== 'Void' && !paying && <p className="text-theme-text-secondary">The remaining balance is already covered by payments awaiting verification.</p>}
      </div>
    </Modal>
  );
}

function PayForm({ inv, payable, settings, staff, onCancel, onDone }: { inv: Invoice; payable: number; settings: BillingSettings; staff: boolean; onCancel: () => void; onDone: (text: string) => void }) {
  const [amount, setAmount] = useState(String(payable));
  const [method, setMethod] = useState<string>(settings.upiId ? 'UPI' : 'Bank Transfer');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');

  const link = upiLink(settings, Number(amount) || payable, inv.number);
  useEffect(() => {
    if (!link) { setQr(''); return; }
    QRCode.toDataURL(link, { margin: 1, width: 200 }).then(setQr).catch(() => setQr(''));
  }, [link]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/api/payments', 'POST', { invoiceId: inv.id, amount: Number(amount), method, reference, paidOn, note });
      onDone(staff ? 'Payment recorded.' : 'Payment submitted. It will show as paid once staff verify it.');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  const noDetails = !settings.upiId && !settings.accountNumber;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-theme-card-border p-4">
      {!staff && (
        <div className="flex flex-wrap gap-4 items-start">
          {qr && <div className="space-y-1 text-center"><img src={qr} alt={`UPI QR for ${formatINR(Number(amount) || payable)}`} className="h-32 w-32 rounded-lg bg-white p-1" /><p className="text-[11px] text-theme-text-secondary">Scan with any UPI app</p></div>}
          <div className="space-y-0.5 text-theme-text-secondary">
            <p className="font-semibold text-theme-text-primary">Pay to</p>
            {settings.upiId && <p>UPI: <span className="text-theme-text-primary">{settings.upiId}</span></p>}
            {settings.accountNumber && <>
              <p>{[settings.accountName, settings.bankName].filter(Boolean).join(' · ')}</p>
              <p>A/c <span className="text-theme-text-primary">{settings.accountNumber}</span> · IFSC <span className="text-theme-text-primary">{settings.ifsc || '—'}</span></p>
            </>}
            {noDetails && <p>Payment details haven’t been set up yet. Please contact the RTBI team.</p>}
            <p>Use <strong className="text-theme-text-primary">{inv.number}</strong> as the payment note.</p>
          </div>
        </div>
      )}
      <p className="text-xs font-semibold text-theme-text-primary">{staff ? 'Record a payment received' : 'After paying, enter the details so we can match it'}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Amount (₹) *" hint={`Up to ${formatINR(payable)}`}><input required type="number" min="0.01" max={payable} step="0.01" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label="Method *"><select className={inputCls} value={method} onChange={e => setMethod(e.target.value)}>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
        <Field label={method === 'Cash' ? 'Receipt no. (optional)' : 'UTR / transaction / cheque no. *'}><input required={method !== 'Cash'} className={inputCls} value={reference} onChange={e => setReference(e.target.value)} /></Field>
        <Field label="Paid on"><input type="date" max={today()} className={inputCls} value={paidOn} onChange={e => setPaidOn(e.target.value)} /></Field>
      </div>
      <Field label="Note"><input className={inputCls} value={note} onChange={e => setNote(e.target.value)} /></Field>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy} type="submit">{busy ? 'Saving…' : staff ? 'Record payment' : 'Submit payment'}</button>
        <button className={btnGhost} type="button" onClick={onCancel}>Back</button>
      </div>
    </form>
  );
}
