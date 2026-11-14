'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  FileText, Plus, X, CheckCircle2, AlertCircle, Paperclip, Printer, BadgeCheck,
  Undo2, Ban, Banknote, Trash2, ExternalLink, Building2, Rocket, Search, Check,
  BookOpen, ChevronRight, User, Phone, MapPin, Mail, Hash, Sparkles, Filter,
} from 'lucide-react';
import {
  getInvoices, createInvoice, recordInvoicePayment, verifyInvoicePayment, rejectInvoicePayment, cancelInvoice,
  refreshFinanceFromServer, filesToReceiptFiles, getClientRegister, createOrUpdateClient,
  InvoiceStatus, InvoiceItem, InvoiceLine,
} from '@/lib/local-data';
import { computeInvoiceTotals, type ClientRecord } from '@/lib/finance';
import { canManageInvoices, canVerifyInvoicePayment } from '@/lib/permissions';
import { FileDropzone, FilePreviewRow, createProgressTracker } from '@/components/ui/file-dropzone';
import { EmptyState } from '@/components/ui/empty-state';

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const todayIso = () => new Date().toISOString().split('T')[0];
const inputCls = 'w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent';
const PAYMENT_MODES = ['Bank Transfer', 'UPI', 'Cheque', 'Cash', 'Other'] as const;

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  Issued: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  'Payment Recorded': 'bg-sky-500/10 text-sky-600 border-sky-500/30',
  Paid: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  Cancelled: 'bg-theme-border/20 text-theme-text-secondary border-theme-border/40',
};

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function printInvoice(inv: InvoiceItem) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return;
  const rows = inv.lineItems.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description)}</td><td class="r">${l.quantity}</td><td class="r">${inr(l.rate)}</td><td class="r">${inr(l.quantity * l.rate)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><title>${esc(inv.invoiceNumber)}</title><style>
    body{font-family:Arial,sans-serif;color:#1d1d1f;padding:40px;max-width:760px;margin:auto;font-size:13px}
    h1{margin:0;font-size:22px;color:#361C6A} .muted{color:#666} table{width:100%;border-collapse:collapse;margin-top:24px}
    th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left} th{background:#f4f1fa} .r{text-align:right}
    .tot td{border:none;padding:4px 8px} .stamp{display:inline-block;border:2px solid #10b981;color:#10b981;padding:2px 10px;border-radius:6px;font-weight:bold;transform:rotate(-4deg)}
  </style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><h1>INVOICE</h1><div class="muted">${esc(inv.invoiceNumber)}</div></div>
      <div style="text-align:right"><strong>RTBI</strong><div class="muted">Issued ${esc(inv.issueDate)}${inv.dueDate ? `<br/>Due ${esc(inv.dueDate)}` : ''}</div>${inv.status === 'Paid' ? '<div class="stamp" style="margin-top:8px">PAID</div>' : ''}</div>
    </div>
    <p style="margin-top:28px"><strong>Billed to</strong><br/>${esc(inv.clientName)}${inv.isStartup ? ' <span style="color:#7c3aed;font-size:11px">[Incubated Startup]</span>' : ''}${inv.clientAddress ? `<br/>${esc(inv.clientAddress).replace(/\n/g, '<br/>')}` : ''}${inv.clientGstin ? `<br/>GSTIN: ${esc(inv.clientGstin)}` : ''}${inv.clientEmail ? `<br/>${esc(inv.clientEmail)}` : ''}</p>
    <table><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <table class="tot" style="width:280px;margin-left:auto"><tr><td>Subtotal</td><td class="r">${inr(inv.subtotal)}</td></tr><tr><td>Tax (${inv.taxPercent}%)</td><td class="r">${inr(inv.taxAmount)}</td></tr><tr><td><strong>Total</strong></td><td class="r"><strong>${inr(inv.totalAmount)}</strong></td></tr></table>
    ${inv.notes ? `<p class="muted" style="margin-top:24px">${esc(inv.notes)}</p>` : ''}
    <script>window.onload=function(){window.print()}</script></body></html>`);
  w.document.close();
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-theme-card border border-theme-card-border rounded-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl relative`}>
        <button onClick={onClose} className="absolute top-4 right-4 text-theme-text-secondary hover:text-theme-text-primary cursor-pointer" aria-label="Close"><X className="h-5 w-5" /></button>
        <h2 className="text-base font-bold text-theme-text-primary pr-8">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default function InvoicesPage() {
  const [user, setUser] = useState<any>(null);
  const [, setTick] = useState(0);
  const [toast, setToast] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  // Client Register Drawer / Modal
  const [registerOpen, setRegisterOpen] = useState(false);
  const [regSearch, setRegSearch] = useState('');
  const [regTab, setRegTab] = useState<'all' | 'startups' | 'clients'>('all');

  // New invoice state
  const [createOpen, setCreateOpen] = useState(false);
  const [isRegisteredClient, setIsRegisteredClient] = useState(false); // The toggle
  const [selectedClient, setSelectedClient] = useState<ClientRecord | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [clientTab, setClientTab] = useState<'all' | 'startups' | 'clients'>('all');
  const [cSaveToRegister, setCSaveToRegister] = useState(true);

  const [cClient, setCClient] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cAddress, setCAddress] = useState('');
  const [cGstin, setCGstin] = useState('');
  const [cIsStartup, setCIsStartup] = useState(false);
  const [cStartupName, setCStartupName] = useState('');
  const [cIssue, setCIssue] = useState(todayIso());
  const [cDue, setCDue] = useState('');
  const [cTax, setCTax] = useState('18');
  const [cNotes, setCNotes] = useState('');
  const [cLines, setCLines] = useState<{ description: string; quantity: string; rate: string }[]>([{ description: '', quantity: '1', rate: '' }]);
  const [cError, setCError] = useState('');
  const [cSaving, setCSaving] = useState(false);

  // Record payment / reject
  const [payOpen, setPayOpen] = useState(false);
  const [pAmount, setPAmount] = useState('');
  const [pMode, setPMode] = useState<(typeof PAYMENT_MODES)[number]>('Bank Transfer');
  const [pRef, setPRef] = useState('');
  const [pDate, setPDate] = useState(todayIso());
  const [pFiles, setPFiles] = useState<File[]>([]);
  const [pError, setPError] = useState('');
  const [pSaving, setPSaving] = useState(false);
  const [pProgress, setPProgress] = useState(0);
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('user');
      if (saved) setUser(JSON.parse(saved));
    } catch { /* ignore */ }
    const refresh = () => setTick(t => t + 1);
    refreshFinanceFromServer();
    const want = new URLSearchParams(window.location.search).get('open');
    if (want) setOpenId(want);
    window.addEventListener('leads-data-sync', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('leads-data-sync', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000); };
  const invoices = getInvoices().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.invoiceNumber.localeCompare(a.invoiceNumber));
  const register = useMemo(() => getClientRegister(), [invoices]);

  const visible = invoices.filter(i => {
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    if (invoiceSearch.trim()) {
      const q = invoiceSearch.toLowerCase();
      const matchNum = i.invoiceNumber.toLowerCase().includes(q);
      const matchClient = i.clientName.toLowerCase().includes(q);
      const matchEmail = i.clientEmail?.toLowerCase().includes(q);
      const matchGstin = i.clientGstin?.toLowerCase().includes(q);
      if (!matchNum && !matchClient && !matchEmail && !matchGstin) return false;
    }
    return true;
  });

  const open = invoices.find(i => i.id === openId) || null;
  const canIssue = canManageInvoices(user);
  const canVerify = canVerifyInvoicePayment(user);

  const outstanding = invoices.filter(i => i.status === 'Issued' || i.status === 'Payment Recorded').reduce((s, i) => s + i.totalAmount, 0);
  const awaiting = invoices.filter(i => i.status === 'Payment Recorded').length;
  const received = invoices.filter(i => i.status === 'Paid').reduce((s, i) => s + (i.payment?.amount || 0), 0);

  // Client Selection for Invoicing
  const handleSelectClient = (c: ClientRecord) => {
    setSelectedClient(c);
    setCClient(c.name);
    setCEmail(c.email || '');
    setCAddress(c.address || '');
    setCGstin(c.gstin || '');
    setCIsStartup(Boolean(c.isStartup));
    setCStartupName(c.startupName || (c.isStartup ? c.name : ''));
    if (c.defaultTaxPercent) setCTax(String(c.defaultTaxPercent));
    if (c.notes && !cNotes) setCNotes(c.notes);
  };

  const handleClearSelectedClient = () => {
    setSelectedClient(null);
    setCClient('');
    setCEmail('');
    setCAddress('');
    setCGstin('');
    setCIsStartup(false);
    setCStartupName('');
  };

  // ---- create invoice ----
  const openCreate = (prefillClient?: ClientRecord) => {
    setCClient(''); setCEmail(''); setCAddress(''); setCGstin(''); setCIssue(todayIso()); setCDue(''); setCTax('18'); setCNotes('');
    setCIsStartup(false); setCStartupName(''); setSelectedClient(null); setClientSearch(''); setCSaveToRegister(true);
    setCLines([{ description: '', quantity: '1', rate: '' }]); setCError('');

    if (prefillClient) {
      setIsRegisteredClient(true);
      handleSelectClient(prefillClient);
    } else {
      setIsRegisteredClient(false);
    }
    setCreateOpen(true);
  };

  const parsedLines: InvoiceLine[] = cLines.map(l => ({ description: l.description.trim(), quantity: parseFloat(l.quantity) || 0, rate: parseFloat(l.rate) || 0 })).filter(l => l.description);
  const totals = computeInvoiceTotals(parsedLines, parseFloat(cTax) || 0);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCError('');
    if (!cClient.trim()) return setCError('Enter the client name.');
    if (parsedLines.length === 0) return setCError('Add at least one line item with a description.');
    if (parsedLines.some(l => l.quantity <= 0 || l.rate < 0)) return setCError('Each line item needs a positive quantity and a valid rate.');
    if (totals.totalAmount <= 0) return setCError('The invoice total must be greater than zero.');
    if (!user) return;
    setCSaving(true);
    try {
      const inv = await createInvoice({
        clientName: cClient.trim(),
        clientEmail: cEmail.trim() || undefined,
        clientAddress: cAddress.trim() || undefined,
        clientGstin: cGstin.trim() || undefined,
        isStartup: cIsStartup,
        startupName: cStartupName.trim() || (cIsStartup ? cClient.trim() : undefined),
        clientId: selectedClient?.id,
        saveToRegister: cSaveToRegister,
        issueDate: cIssue,
        dueDate: cDue || undefined,
        lineItems: parsedLines,
        taxPercent: parseFloat(cTax) || 0,
        notes: cNotes.trim() || undefined,
      }, { name: user.name, email: user.email });

      setCreateOpen(false);
      setOpenId(inv.id);
      flash(`Invoice ${inv.invoiceNumber} generated.`);
    } catch (err: any) {
      setCError(err.message || 'Could not generate the invoice.');
    } finally {
      setCSaving(false);
    }
  };

  // Filtered clients for the modal combobox
  const filteredModalClients = useMemo(() => {
    return register.filter(c => {
      if (clientTab === 'startups' && !c.isStartup) return false;
      if (clientTab === 'clients' && c.isStartup) return false;
      if (clientSearch.trim()) {
        const q = clientSearch.toLowerCase();
        const matchName = c.name.toLowerCase().includes(q);
        const matchStartup = c.startupName?.toLowerCase().includes(q);
        const matchFounder = c.founderName?.toLowerCase().includes(q);
        const matchEmail = c.email?.toLowerCase().includes(q);
        const matchGstin = c.gstin?.toLowerCase().includes(q);
        if (!matchName && !matchStartup && !matchFounder && !matchEmail && !matchGstin) return false;
      }
      return true;
    });
  }, [register, clientSearch, clientTab]);

  // Filtered clients for the standalone Register drawer
  const filteredRegisterList = useMemo(() => {
    return register.filter(c => {
      if (regTab === 'startups' && !c.isStartup) return false;
      if (regTab === 'clients' && c.isStartup) return false;
      if (regSearch.trim()) {
        const q = regSearch.toLowerCase();
        const matchName = c.name.toLowerCase().includes(q);
        const matchStartup = c.startupName?.toLowerCase().includes(q);
        const matchFounder = c.founderName?.toLowerCase().includes(q);
        const matchEmail = c.email?.toLowerCase().includes(q);
        const matchGstin = c.gstin?.toLowerCase().includes(q);
        if (!matchName && !matchStartup && !matchFounder && !matchEmail && !matchGstin) return false;
      }
      return true;
    });
  }, [register, regSearch, regTab]);

  // ---- payment ----
  const openPay = () => {
    if (!open) return;
    setPAmount(String(open.totalAmount)); setPMode('Bank Transfer'); setPRef(''); setPDate(todayIso()); setPFiles([]); setPError(''); setPProgress(0);
    setPayOpen(true);
  };
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!open || !user) return;
    setPError('');
    const amount = parseFloat(pAmount);
    if (!(amount > 0)) return setPError('Enter the amount received.');
    if (!pRef.trim()) return setPError('Enter the transaction / cheque / receipt reference.');
    setPSaving(true);
    try {
      const proofFiles = await filesToReceiptFiles(pFiles);
      const tracker = createProgressTracker(pct => setPProgress(pct));
      await recordInvoicePayment(open.id, { amount, mode: pMode, reference: pRef.trim(), paidOn: pDate, proofFiles }, user.name, tracker);
      setPayOpen(false);
      flash('Payment recorded — it will count as income once verified.');
    } catch (err: any) {
      setPError(err.message || 'Could not record the payment.');
    } finally {
      setPSaving(false);
    }
  };

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setActionError(''); setBusy(true);
    try { await fn(); flash(okMsg); } catch (err: any) { setActionError(err.message || 'That did not work.'); } finally { setBusy(false); setTick(t => t + 1); }
  };

  const recorderIsMe = !!open?.payment && open.payment.recordedByEmail?.toLowerCase() === String(user?.email || '').toLowerCase();

  return (
    <div className="p-6 md:p-8 space-y-6 pb-12">
      {toast && <div className="fixed top-20 right-6 z-50 bg-emerald-500 text-white font-semibold px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs"><CheckCircle2 className="h-4 w-4" />{toast}</div>}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary tracking-tight">Invoices</h1>
          <p className="text-xs text-theme-text-secondary mt-1">Generate invoices, bill incubated startups or saved clients, and record verified payments directly into Finance.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/budget" className="px-3.5 py-2 bg-theme-card border border-theme-card-border hover:border-accent text-theme-text-primary font-semibold rounded-xl text-xs flex items-center gap-1.5">
            Finance <ExternalLink className="h-3.5 w-3.5 text-accent" />
          </Link>
          <button
            onClick={() => setRegisterOpen(true)}
            className="px-3.5 py-2 bg-theme-card border border-theme-card-border hover:border-accent text-theme-text-primary font-semibold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <BookOpen className="h-4 w-4 text-accent" />
            Client Register
            <span className="px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[10px] font-bold">
              {register.length}
            </span>
          </button>
          {canIssue && (
            <button
              onClick={() => openCreate()}
              className="px-3.5 py-2 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl text-xs flex items-center gap-1.5 shadow-md cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              New Invoice
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { l: 'Outstanding', v: inr(outstanding), s: 'Issued, not yet verified as paid' },
          { l: 'Awaiting verification', v: String(awaiting), s: 'Payments recorded, pending a verifier' },
          { l: 'Received & verified', v: inr(received), s: 'Booked to income' },
        ].map(k => (
          <div key={k.l} className="glass-panel rounded-2xl p-4 border border-theme-card-border">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-theme-text-secondary">{k.l}</div>
            <div className="mt-2 text-lg font-bold font-mono text-theme-text-primary">{k.v}</div>
            <div className="text-[11px] text-theme-text-secondary">{k.s}</div>
          </div>
        ))}
      </div>

      <div className="glass-panel rounded-2xl border border-theme-card-border p-5 space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex gap-2 flex-wrap">
            {(['all', 'Issued', 'Payment Recorded', 'Paid', 'Cancelled'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer ${statusFilter === s ? 'bg-accent text-white border-accent' : 'border-theme-card-border text-theme-text-secondary hover:border-accent'}`}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-theme-text-secondary" />
            <input
              type="text"
              placeholder="Search invoices..."
              value={invoiceSearch}
              onChange={e => setInvoiceSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-theme-background/50 border border-theme-card-border rounded-lg text-theme-text-primary focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState icon={FileText} title="No invoices found" description={invoiceSearch ? "Try adjusting your search query." : "Generate an invoice to start tracking receivables."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-theme-text-secondary border-b border-theme-border/40">
                  <th className="py-2 pr-3 font-semibold">Invoice</th>
                  <th className="pr-3 font-semibold">Client / Startup</th>
                  <th className="pr-3 font-semibold">Issued</th>
                  <th className="pr-3 font-semibold">Status</th>
                  <th className="pr-3 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(i => (
                  <tr key={i.id} onClick={() => { setActionError(''); setRejecting(false); setOpenId(i.id); }} className="border-b border-theme-border/20 cursor-pointer hover:bg-accent/5">
                    <td className="py-2.5 pr-3 font-semibold text-accent">{i.invoiceNumber}</td>
                    <td className="pr-3 text-theme-text-primary">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{i.clientName}</span>
                        {i.isStartup && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/10 text-purple-600 border border-purple-500/25">
                            <Rocket className="h-2.5 w-2.5" /> Startup
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="pr-3 text-theme-text-secondary">{i.issueDate}</td>
                    <td className="pr-3"><span className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${STATUS_STYLE[i.status]}`}>{i.status}</span></td>
                    <td className="pr-3 text-right font-mono font-semibold text-theme-text-primary">{inr(i.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {open && !payOpen && (
        <Modal title={`Invoice ${open.invoiceNumber}`} onClose={() => { setOpenId(null); setRejecting(false); }} wide>
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold ${STATUS_STYLE[open.status]}`}>{open.status}</span>
                {open.isStartup && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-500/10 text-purple-600 border border-purple-500/25">
                    <Rocket className="h-3 w-3" /> Incubated Startup
                  </span>
                )}
              </div>
              <button onClick={() => printInvoice(open)} className="px-3 py-1.5 border border-theme-card-border rounded-lg text-[11px] font-semibold text-theme-text-primary flex items-center gap-1.5 hover:border-accent cursor-pointer"><Printer className="h-3.5 w-3.5" />Print / Save PDF</button>
            </div>
            {actionError && <div className="p-3 bg-danger/10 border border-danger/25 text-danger rounded-xl flex gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{actionError}</div>}

            <div className="grid sm:grid-cols-2 gap-3 text-theme-text-secondary bg-theme-background/30 p-3.5 rounded-xl border border-theme-card-border">
              <div>
                <div className="font-semibold text-theme-text-primary text-sm flex items-center gap-1.5">
                  {open.clientName}
                </div>
                {open.clientAddress && <div className="whitespace-pre-line mt-1">{open.clientAddress}</div>}
                {open.clientGstin && <div className="mt-0.5 font-mono text-[11px]">GSTIN: {open.clientGstin}</div>}
                {open.clientEmail && <div className="mt-0.5">{open.clientEmail}</div>}
              </div>
              <div className="sm:text-right">
                Issued {open.issueDate}
                {open.dueDate && <><br />Due {open.dueDate}</>}
                <br />By {open.createdBy}
              </div>
            </div>

            <table className="w-full">
              <thead><tr className="text-left text-theme-text-secondary border-b border-theme-border/40"><th className="py-1.5 font-semibold">Item</th><th className="text-right font-semibold">Qty</th><th className="text-right font-semibold">Rate</th><th className="text-right font-semibold">Amount</th></tr></thead>
              <tbody>{open.lineItems.map((l, i) => <tr key={i} className="border-b border-theme-border/20"><td className="py-1.5 text-theme-text-primary">{l.description}</td><td className="text-right">{l.quantity}</td><td className="text-right font-mono">{inr(l.rate)}</td><td className="text-right font-mono">{inr(l.quantity * l.rate)}</td></tr>)}</tbody>
            </table>
            <div className="ml-auto w-56 space-y-1 font-mono">
              <div className="flex justify-between text-theme-text-secondary"><span>Subtotal</span><span>{inr(open.subtotal)}</span></div>
              <div className="flex justify-between text-theme-text-secondary"><span>Tax {open.taxPercent}%</span><span>{inr(open.taxAmount)}</span></div>
              <div className="flex justify-between font-bold text-theme-text-primary border-t border-theme-border/40 pt-1"><span>Total</span><span>{inr(open.totalAmount)}</span></div>
            </div>
            {open.notes && <p className="text-theme-text-secondary bg-theme-background/30 p-2.5 rounded-lg border border-theme-card-border">{open.notes}</p>}

            {open.payment && (
              <div className="rounded-xl border border-theme-card-border p-3 space-y-1 bg-accent/5">
                <div className="font-semibold text-theme-text-primary flex items-center gap-1.5"><Banknote className="h-4 w-4 text-accent" />Payment {open.status === 'Paid' ? 'verified' : 'awaiting verification'}</div>
                <div className="text-theme-text-secondary">{inr(open.payment.amount)} via {open.payment.mode} on {open.payment.paidOn} · Ref <span className="font-mono">{open.payment.reference}</span></div>
                <div className="text-theme-text-secondary">Recorded by {open.payment.recordedBy}{open.verifiedBy && ` · Verified by ${open.verifiedBy} on ${open.verifiedAt}`}</div>
                {open.payment.proofFiles.map((f, i) => <a key={i} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline mr-3"><Paperclip className="h-3 w-3" />{f.name}</a>)}
                {open.status === 'Paid' && <div className="pt-1"><Link href="/dashboard/budget" className="text-emerald-600 font-semibold hover:underline">Booked to Finance as Other Income →</Link></div>}
              </div>
            )}
            {open.rejectedPayments?.map((p, i) => (
              <div key={i} className="rounded-xl border border-danger/25 bg-danger/5 p-3 text-theme-text-secondary">
                Earlier payment of {inr(p.amount)} (ref {p.reference}) by {p.recordedBy} was sent back: <span className="text-danger">{p.rejectionNote}</span>
              </div>
            ))}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              {open.status === 'Issued' && canIssue && <button onClick={openPay} className="px-3.5 py-2 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"><Banknote className="h-4 w-4" />Record Payment</button>}
              {open.status === 'Payment Recorded' && canVerify && !rejecting && (
                <>
                  <button disabled={busy} onClick={() => run(() => verifyInvoicePayment(open.id, user.name), 'Payment verified and added to income.')} className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"><BadgeCheck className="h-4 w-4" />Verify Payment</button>
                  <button disabled={busy} onClick={() => setRejecting(true)} className="px-3.5 py-2 border border-theme-card-border text-theme-text-primary font-semibold rounded-xl flex items-center gap-1.5 hover:border-danger cursor-pointer"><Undo2 className="h-4 w-4" />Send Back</button>
                </>
              )}
              {open.status === 'Payment Recorded' && !canVerify && <span className="text-theme-text-secondary">Waiting for the Super User or CEO to verify this payment.</span>}
              {(open.status === 'Issued' || open.status === 'Payment Recorded') && (
                <button disabled={busy} onClick={() => { if (confirm(`Cancel invoice ${open.invoiceNumber}?`)) run(() => cancelInvoice(open.id, user.name), 'Invoice cancelled.'); }} className="px-3.5 py-2 border border-theme-card-border text-theme-text-secondary font-semibold rounded-xl flex items-center gap-1.5 hover:border-danger hover:text-danger cursor-pointer"><Ban className="h-4 w-4" />Cancel Invoice</button>
              )}
            </div>
            {open.status === 'Payment Recorded' && canVerify && recorderIsMe && user?.tier !== 1 && <p className="text-amber-600">You recorded this payment, so a different person has to verify it.</p>}
            {rejecting && (
              <div className="space-y-2">
                <textarea rows={2} value={rejectNote} onChange={e => setRejectNote(e.target.value)} placeholder="Why is this payment being sent back? (e.g. UTR not found in bank statement)" className={inputCls} />
                <div className="flex gap-2">
                  <button disabled={busy || !rejectNote.trim()} onClick={() => run(async () => { await rejectInvoicePayment(open.id, rejectNote.trim(), user.name); setRejecting(false); setRejectNote(''); }, 'Payment sent back.')} className="px-3.5 py-2 bg-danger text-white font-semibold rounded-xl disabled:opacity-60 cursor-pointer">Send Back</button>
                  <button onClick={() => setRejecting(false)} className="px-3.5 py-2 border border-theme-card-border rounded-xl text-theme-text-secondary cursor-pointer">Never mind</button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Record payment Modal */}
      {open && payOpen && (
        <Modal title={`Record payment — ${open.invoiceNumber}`} onClose={() => !pSaving && setPayOpen(false)}>
          <form onSubmit={handleRecordPayment} className="space-y-4 text-xs">
            {pError && <div className="p-3 bg-danger/10 border border-danger/25 text-danger rounded-xl flex gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{pError}</div>}
            <p className="text-theme-text-secondary">Invoice total {inr(open.totalAmount)}. The payment will be added to income only after a Super User or CEO verifies it.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><label className="block font-medium text-theme-text-secondary">Amount received (₹) *</label><input type="number" min={0} step="0.01" value={pAmount} onChange={e => setPAmount(e.target.value)} className={`${inputCls} font-mono`} /></div>
              <div className="space-y-1.5"><label className="block font-medium text-theme-text-secondary">Date received *</label><input type="date" value={pDate} max={todayIso()} onChange={e => setPDate(e.target.value)} className={inputCls} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><label className="block font-medium text-theme-text-secondary">Mode *</label><select value={pMode} onChange={e => setPMode(e.target.value as any)} className={inputCls}>{PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}</select></div>
              <div className="space-y-1.5"><label className="block font-medium text-theme-text-secondary">Reference (UTR / cheque no.) *</label><input type="text" value={pRef} onChange={e => setPRef(e.target.value)} className={inputCls} /></div>
            </div>
            <div className="space-y-2">
              <label className="block font-medium text-theme-text-secondary flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5 text-accent" />Proof of payment (bank statement / screenshot)</label>
              {pFiles.length < 3 && <FileDropzone onFilesSelected={fs => setPFiles(prev => [...prev, ...fs].slice(0, 3))} accept="image/*,.pdf" multiple disabled={pSaving} label="Upload proof" hint="Up to 3 files" compact />}
              {pFiles.map((f, i) => <FilePreviewRow key={`${f.name}-${i}`} file={f} onRemove={!pSaving ? () => setPFiles(pFiles.filter((_, j) => j !== i)) : undefined} />)}
            </div>
            {pSaving && <div className="h-1.5 rounded-full bg-theme-border/30 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${pProgress}%` }} /></div>}
            <button type="submit" disabled={pSaving} className="w-full py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl disabled:opacity-60 cursor-pointer">{pSaving ? 'Saving…' : 'Submit for Verification'}</button>
          </form>
        </Modal>
      )}

      {/* New Invoice Modal with Registered Startup / Client Toggle */}
      {createOpen && (
        <Modal title="Generate Invoice" onClose={() => !cSaving && setCreateOpen(false)} wide>
          <form onSubmit={handleCreate} className="space-y-4 text-xs">
            {cError && <div className="p-3 bg-danger/10 border border-danger/25 text-danger rounded-xl flex gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{cError}</div>}

            {/* Toggle Card */}
            <div className="p-3.5 rounded-xl bg-theme-background/60 border border-theme-card-border space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`p-2 rounded-lg transition-colors ${isRegisteredClient ? 'bg-accent text-white' : 'bg-theme-card border border-theme-card-border text-theme-text-secondary'}`}>
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-theme-text-primary text-xs flex items-center gap-1.5">
                      Bill to Incubated Startup or Registered Client
                      {isRegisteredClient && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent/15 text-accent font-bold">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-theme-text-secondary">
                      Turn this toggle ON to auto-fill details from your startup register or previous clients
                    </div>
                  </div>
                </div>

                {/* Switch Button */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={isRegisteredClient}
                  onClick={() => {
                    const next = !isRegisteredClient;
                    setIsRegisteredClient(next);
                    if (!next) {
                      handleClearSelectedClient();
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isRegisteredClient ? 'bg-accent' : 'bg-theme-border/60'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      isRegisteredClient ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Selector when toggle is ON */}
              {isRegisteredClient && (
                <div className="pt-2 border-t border-theme-card-border space-y-2.5">
                  {selectedClient ? (
                    <div className="p-3 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className={`p-2 rounded-lg ${selectedClient.isStartup ? 'bg-purple-500/20 text-purple-600' : 'bg-accent/20 text-accent'}`}>
                          {selectedClient.isStartup ? <Rocket className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                        </div>
                        <div>
                          <div className="font-bold text-theme-text-primary flex items-center gap-1.5">
                            {selectedClient.name}
                            {selectedClient.isStartup && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-600">
                                Startup
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-theme-text-secondary">
                            {selectedClient.email && <span>{selectedClient.email} · </span>}
                            {selectedClient.gstin ? <span>GSTIN: {selectedClient.gstin}</span> : <span>Registered in directory</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearSelectedClient}
                        className="px-2.5 py-1 text-[11px] font-semibold border border-accent/40 rounded-lg text-accent hover:bg-accent hover:text-white transition-colors cursor-pointer"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2 items-center">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-theme-text-secondary" />
                          <input
                            type="text"
                            placeholder="Search startup or client by name, founder, or GSTIN..."
                            value={clientSearch}
                            onChange={e => setClientSearch(e.target.value)}
                            className="w-full pl-9 pr-3 py-1.5 text-xs bg-theme-background border border-theme-card-border rounded-lg text-theme-text-primary focus:outline-none focus:border-accent"
                          />
                        </div>
                        <div className="flex gap-1">
                          {(['all', 'startups', 'clients'] as const).map(tab => (
                            <button
                              key={tab}
                              type="button"
                              onClick={() => setClientTab(tab)}
                              className={`px-2 py-1 rounded-md text-[10px] font-semibold border cursor-pointer ${
                                clientTab === tab ? 'bg-accent text-white border-accent' : 'border-theme-card-border text-theme-text-secondary'
                              }`}
                            >
                              {tab === 'all' ? 'All' : tab === 'startups' ? 'Startups' : 'Clients'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Results list */}
                      <div className="max-h-44 overflow-y-auto space-y-1 rounded-xl border border-theme-card-border p-1 bg-theme-background/30">
                        {filteredModalClients.length === 0 ? (
                          <div className="p-3 text-center text-theme-text-secondary text-xs">
                            No matching startups or saved clients found. You can fill out details below and they will be saved.
                          </div>
                        ) : (
                          filteredModalClients.map(c => (
                            <div
                              key={c.id}
                              onClick={() => handleSelectClient(c)}
                              className="p-2 rounded-lg hover:bg-accent/10 cursor-pointer flex items-center justify-between border border-transparent hover:border-accent/25 transition-all"
                            >
                              <div className="flex items-center gap-2">
                                <div className={`p-1.5 rounded-md ${c.isStartup ? 'bg-purple-500/10 text-purple-600' : 'bg-accent/10 text-accent'}`}>
                                  {c.isStartup ? <Rocket className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
                                </div>
                                <div>
                                  <div className="font-semibold text-theme-text-primary text-xs flex items-center gap-1.5">
                                    {c.name}
                                    {c.isStartup && (
                                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-500/15 text-purple-600">
                                        Startup
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-theme-text-secondary flex gap-2">
                                    {c.founderName && <span>Founder: {c.founderName}</span>}
                                    {c.email && <span>{c.email}</span>}
                                    {c.gstin && <span>GSTIN: {c.gstin}</span>}
                                    {c.lastBilledAt && <span>Last billed: {c.lastBilledAt}</span>}
                                  </div>
                                </div>
                              </div>
                              <span className="text-accent text-[11px] font-semibold flex items-center gap-0.5">
                                Select <ChevronRight className="h-3 w-3" />
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Client input fields */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary flex items-center gap-1">
                  Client / Startup Name *
                  {cIsStartup && (
                    <span className="text-[10px] font-bold text-purple-600 bg-purple-500/10 px-1.5 py-0.2 rounded">
                      Startup
                    </span>
                  )}
                </label>
                <input
                  value={cClient}
                  onChange={e => setCClient(e.target.value)}
                  placeholder="e.g. Acme Innovations Pvt Ltd"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Client Email</label>
                <input
                  type="email"
                  value={cEmail}
                  onChange={e => setCEmail(e.target.value)}
                  placeholder="billing@client.com"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Client GSTIN</label>
                <input
                  value={cGstin}
                  onChange={e => setCGstin(e.target.value)}
                  placeholder="e.g. 29ABCDE1234F1Z5"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Tax % (GST)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={cTax}
                  onChange={e => setCTax(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Invoice Date *</label>
                <input
                  type="date"
                  value={cIssue}
                  onChange={e => setCIssue(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Due Date</label>
                <input
                  type="date"
                  value={cDue}
                  onChange={e => setCDue(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Client Address</label>
              <textarea
                rows={2}
                value={cAddress}
                onChange={e => setCAddress(e.target.value)}
                placeholder="Billing address..."
                className={inputCls}
              />
            </div>

            {/* Save to Register Checkbox */}
            <label className="flex items-center gap-2 text-theme-text-secondary cursor-pointer select-none py-1">
              <input
                type="checkbox"
                checked={cSaveToRegister}
                onChange={e => setCSaveToRegister(e.target.checked)}
                className="rounded border-theme-card-border text-accent focus:ring-accent"
              />
              <span className="text-[11px] font-medium text-theme-text-primary">
                Save / update client in register for future billing
              </span>
            </label>

            {/* Line Items */}
            <div className="space-y-2">
              <label className="block font-medium text-theme-text-secondary">Line items *</label>
              {cLines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_70px_100px_auto] gap-2 items-center">
                  <input
                    placeholder="Description (e.g. Incubation Fee / Cloud Credits)"
                    value={l.description}
                    onChange={e => setCLines(cLines.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                    className={inputCls}
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="Qty"
                    value={l.quantity}
                    onChange={e => setCLines(cLines.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                    className={inputCls}
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="Rate ₹"
                    value={l.rate}
                    onChange={e => setCLines(cLines.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))}
                    className={`${inputCls} font-mono`}
                  />
                  <button
                    type="button"
                    disabled={cLines.length === 1}
                    onClick={() => setCLines(cLines.filter((_, j) => j !== i))}
                    className="text-theme-text-secondary hover:text-danger disabled:opacity-30 cursor-pointer"
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setCLines([...cLines, { description: '', quantity: '1', rate: '' }])}
                className="text-accent font-semibold hover:underline cursor-pointer flex items-center gap-1"
              >
                + Add line item
              </button>
            </div>

            {/* Totals */}
            <div className="ml-auto w-64 space-y-1 font-mono bg-theme-background/40 p-3 rounded-xl border border-theme-card-border">
              <div className="flex justify-between text-theme-text-secondary">
                <span>Subtotal</span>
                <span>{inr(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between text-theme-text-secondary">
                <span>Tax ({cTax || 0}%)</span>
                <span>{inr(totals.taxAmount)}</span>
              </div>
              <div className="flex justify-between font-bold text-theme-text-primary border-t border-theme-border/40 pt-1 text-sm">
                <span>Total</span>
                <span>{inr(totals.totalAmount)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Notes / Payment Terms</label>
              <textarea
                rows={2}
                value={cNotes}
                onChange={e => setCNotes(e.target.value)}
                placeholder="e.g. Bank details, payment due in 15 days, etc."
                className={inputCls}
              />
            </div>

            <button
              type="submit"
              disabled={cSaving}
              className="w-full py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl disabled:opacity-60 cursor-pointer text-sm shadow-md"
            >
              {cSaving ? 'Generating Invoice…' : 'Generate Invoice'}
            </button>
          </form>
        </Modal>
      )}

      {/* Standalone Client & Startup Register Drawer / Modal */}
      {registerOpen && (
        <Modal title="Client & Startup Register" onClose={() => setRegisterOpen(false)} wide>
          <div className="space-y-4 text-xs">
            <p className="text-theme-text-secondary">
              A comprehensive directory of incubated startups and previously billed clients with saved contact and tax details.
            </p>

            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-theme-text-secondary" />
                <input
                  type="text"
                  placeholder="Search register by name, founder, email, or GSTIN..."
                  value={regSearch}
                  onChange={e => setRegSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-theme-background border border-theme-card-border rounded-lg text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex gap-1">
                {(['all', 'startups', 'clients'] as const).map(tab => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setRegTab(tab)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer ${
                      regTab === tab ? 'bg-accent text-white border-accent' : 'border-theme-card-border text-theme-text-secondary hover:border-accent'
                    }`}
                  >
                    {tab === 'all' ? `All (${register.length})` : tab === 'startups' ? `Startups (${register.filter(r => r.isStartup).length})` : `Clients (${register.filter(r => !r.isStartup).length})`}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-1">
              {filteredRegisterList.length === 0 ? (
                <EmptyState icon={BookOpen} title="No register entries found" description="As you issue invoices or incubate startups, their billing information is preserved here." />
              ) : (
                filteredRegisterList.map(c => (
                  <div
                    key={c.id}
                    className="glass-panel p-3.5 rounded-xl border border-theme-card-border hover:border-accent/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-theme-text-primary">{c.name}</span>
                        {c.isStartup && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-600 border border-purple-500/25">
                            <Rocket className="h-3 w-3" /> Incubated Startup
                          </span>
                        )}
                      </div>
                      <div className="text-theme-text-secondary text-[11px] flex flex-wrap gap-x-4 gap-y-0.5">
                        {c.founderName && <span>Founder: <strong>{c.founderName}</strong></span>}
                        {c.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3 text-accent" />{c.email}</span>}
                        {c.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3 text-accent" />{c.phone}</span>}
                        {c.gstin && <span className="flex items-center gap-1 font-mono"><Hash className="h-3 w-3 text-accent" />GSTIN: {c.gstin}</span>}
                        {c.address && <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-accent" />{c.address}</span>}
                      </div>
                      {(c.invoiceCount || c.totalBilled) ? (
                        <div className="text-[10px] text-theme-text-secondary pt-0.5 font-mono">
                          Billed {c.invoiceCount || 0} time(s) · Total: {inr(c.totalBilled || 0)} {c.lastBilledAt ? `· Last: ${c.lastBilledAt}` : ''}
                        </div>
                      ) : null}
                    </div>

                    {canIssue && (
                      <button
                        onClick={() => {
                          setRegisterOpen(false);
                          openCreate(c);
                        }}
                        className="px-3 py-1.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-lg text-xs flex items-center gap-1 cursor-pointer whitespace-nowrap self-start sm:self-center shadow-sm"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Bill Client
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
