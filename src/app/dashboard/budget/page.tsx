'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Wallet, Plus, X, CheckCircle2, TrendingDown, TrendingUp, PiggyBank, Landmark, Calendar as CalendarIcon,
  Paperclip, Trash2, Edit2, FileText, Download, AlertCircle, Receipt, ExternalLink,
} from 'lucide-react';
import {
  getAnnualBudget, saveAnnualBudget, getExpenses, addExpense, deleteExpense,
  getIncomeSources, addIncomeSource, updateIncomeSource, deleteIncomeSource,
  getEvents, getCurrentFinancialYear, refreshFinanceFromServer, filesToReceiptFiles,
  EventItem, ExpenseItem, IncomeSourceItem,
} from '@/lib/local-data';
import { EXPENSE_HEADS, ExpenseHeadKey, getExpenseHeadLabel } from '@/lib/finance';
import { canManageAnnualBudget, canAddExpense, canDeleteExpense, canManageIncome } from '@/lib/permissions';
import { toCsvRow, downloadCsv } from '@/lib/csv';
import { FileDropzone, FilePreviewRow, createProgressTracker } from '@/components/ui/file-dropzone';
import { EmptyState } from '@/components/ui/empty-state';

const CURRENT_FY = getCurrentFinancialYear();
const CURRENT_FY_START = parseInt(CURRENT_FY.split('-')[0], 10);
const FINANCIAL_YEARS = [-5, -4, -3, -2, -1, 0, 1, 2, 3].map(o => `${CURRENT_FY_START + o}-${CURRENT_FY_START + o + 1}`);
const MAX_BILLS = 5;

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const todayIso = () => new Date().toISOString().split('T')[0];

type Tab = 'overview' | 'expenses' | 'income';

const INCOME_TYPE_LABEL: Record<string, string> = { sponsor: 'Sponsorship', grant: 'Grant', donation: 'Donation', other: 'Other Income' };
const inputCls = 'w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent';

function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-theme-card border border-theme-card-border rounded-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl relative`}>
        <button onClick={onClose} className="absolute top-4 right-4 text-theme-text-secondary hover:text-theme-text-primary cursor-pointer" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-base font-bold text-theme-text-primary pr-8">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default function FinancePage() {
  const [user, setUser] = useState<any>(null);
  const [, setTick] = useState(0);
  const [fy, setFy] = useState(CURRENT_FY);
  const [tab, setTab] = useState<Tab>('overview');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [toast, setToast] = useState('');

  // Annual budget modal
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetTotal, setBudgetTotal] = useState('');
  const [budgetAlloc, setBudgetAlloc] = useState<Record<string, string>>({});
  const [budgetNotes, setBudgetNotes] = useState('');
  const [budgetError, setBudgetError] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);

  // Expense modal
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expHead, setExpHead] = useState<ExpenseHeadKey | ''>('');
  const [expAmount, setExpAmount] = useState('');
  const [expDesc, setExpDesc] = useState('');
  const [expDate, setExpDate] = useState(todayIso());
  const [expVendor, setExpVendor] = useState('');
  const [expEventId, setExpEventId] = useState('');
  const [expFiles, setExpFiles] = useState<File[]>([]);
  const [expError, setExpError] = useState('');
  const [expSaving, setExpSaving] = useState(false);
  const [expProgress, setExpProgress] = useState(0);
  const [expHeadFilter, setExpHeadFilter] = useState<'all' | ExpenseHeadKey>('all');

  // Income modal (manual entries only)
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<IncomeSourceItem | null>(null);
  const [incName, setIncName] = useState('');
  const [incAmount, setIncAmount] = useState('');
  const [incType, setIncType] = useState<'sponsor' | 'grant' | 'donation' | 'other'>('sponsor');
  const [incDate, setIncDate] = useState(todayIso());
  const [incNotes, setIncNotes] = useState('');
  const [incError, setIncError] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('user');
      if (saved) setUser(JSON.parse(saved));
    } catch { /* ignore */ }
    const refresh = () => { setEvents(getEvents()); setTick(t => t + 1); };
    refresh();
    refreshFinanceFromServer();
    window.addEventListener('leads-data-sync', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('leads-data-sync', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const budget = getAnnualBudget(fy);
  const expenses = getExpenses().filter(e => e.financialYear === fy);
  const income = getIncomeSources().filter(i => i.financialYear === fy);

  const spentByHead: Record<string, number> = {};
  expenses.forEach(e => { spentByHead[e.head] = (spentByHead[e.head] || 0) + e.amount; });
  const summary = {
    spentByHead,
    totalSpent: expenses.reduce((s, e) => s + e.amount, 0),
    totalIncome: income.reduce((s, i) => s + (Number(i.amount) || 0), 0),
    invoiceIncome: income.filter(i => i.source === 'invoice').reduce((s, i) => s + (Number(i.amount) || 0), 0),
    allocated: EXPENSE_HEADS.reduce((s, h) => s + (budget?.allocations?.[h.key] || 0), 0),
  };

  const canSetBudget = canManageAnnualBudget(user);
  const canBook = canAddExpense(user);
  const canEditIncome = canManageIncome(user);

  // ---- Annual budget ----
  const openBudget = () => {
    setBudgetTotal(budget ? String(budget.totalAmount) : '');
    setBudgetAlloc(Object.fromEntries(EXPENSE_HEADS.map(h => [h.key, budget?.allocations?.[h.key] ? String(budget.allocations[h.key]) : ''])));
    setBudgetNotes(budget?.notes || '');
    setBudgetError('');
    setBudgetOpen(true);
  };
  const allocSum = EXPENSE_HEADS.reduce((s, h) => s + (parseFloat(budgetAlloc[h.key]) || 0), 0);
  const budgetTotalNum = parseFloat(budgetTotal) || 0;

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setBudgetError('');
    if (budgetTotalNum <= 0) return setBudgetError('Enter the annual budget amount.');
    if (allocSum > budgetTotalNum + 0.005) return setBudgetError(`The breakup (${inr(allocSum)}) is more than the annual budget (${inr(budgetTotalNum)}).`);
    setBudgetSaving(true);
    try {
      await saveAnnualBudget({
        financialYear: fy,
        totalAmount: budgetTotalNum,
        allocations: Object.fromEntries(EXPENSE_HEADS.map(h => [h.key, parseFloat(budgetAlloc[h.key]) || 0])),
        notes: budgetNotes.trim() || undefined,
      }, user?.name || 'Admin');
      setBudgetOpen(false);
      flash(`Annual budget for FY ${fy} saved.`);
    } catch (err: any) {
      setBudgetError(err.message || 'Could not save the budget.');
    } finally {
      setBudgetSaving(false);
    }
  };

  // ---- Expenses ----
  const openExpense = () => {
    setExpHead(''); setExpAmount(''); setExpDesc(''); setExpDate(todayIso()); setExpVendor(''); setExpEventId('');
    setExpFiles([]); setExpError(''); setExpProgress(0);
    setExpenseOpen(true);
  };

  const headRemaining = (head: ExpenseHeadKey) => (budget?.allocations?.[head] || 0) - (summary.spentByHead[head] || 0);
  const expAmountNum = parseFloat(expAmount) || 0;
  const overBudgetWarning = expHead && expAmountNum > 0 && budget && expAmountNum > headRemaining(expHead as ExpenseHeadKey)
    ? `This is ${inr(expAmountNum - Math.max(headRemaining(expHead as ExpenseHeadKey), 0))} more than what is left in ${getExpenseHeadLabel(expHead)} (${inr(Math.max(headRemaining(expHead as ExpenseHeadKey), 0))} left). It will still be recorded, but the head will show as over budget.`
    : '';

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setExpError('');
    if (!expHead) return setExpError('Select the head this expense falls under.');
    if (expAmountNum <= 0) return setExpError('Enter a valid expense amount.');
    if (!expDesc.trim()) return setExpError('Describe what the expense was for.');
    if (!expDate) return setExpError('Enter the date on the bill.');
    if (expFiles.length === 0) return setExpError('Attach the bill for this expense.');
    if (!user) return;

    setExpSaving(true);
    setExpProgress(0);
    try {
      const billFiles = await filesToReceiptFiles(expFiles);
      const ev = events.find(x => x.id === expEventId);
      const tracker = createProgressTracker(pct => setExpProgress(pct));
      await addExpense({
        head: expHead, amount: expAmountNum, description: expDesc.trim(), expenseDate: expDate, billFiles,
        vendor: expVendor.trim() || undefined, eventId: ev?.id, eventName: ev?.title,
        submittedBy: user.name, submittedByEmail: user.email,
      }, tracker);
      setExpenseOpen(false);
      setTick(t => t + 1);
      flash('Expense recorded under ' + getExpenseHeadLabel(expHead) + '.');
    } catch (err: any) {
      setExpError(err.message || 'Could not record the expense.');
    } finally {
      setExpSaving(false);
    }
  };

  const handleDeleteExpense = (exp: ExpenseItem) => {
    if (!confirm(`Delete this ${inr(exp.amount)} expense (${exp.description})? This also removes its bill.`)) return;
    deleteExpense(exp.id, user?.name || 'User');
    setTick(t => t + 1);
  };

  // ---- Income ----
  const openIncome = (item?: IncomeSourceItem) => {
    setEditingIncome(item || null);
    setIncName(item?.name || ''); setIncAmount(item ? String(item.amount) : ''); setIncType(item?.type || 'sponsor');
    setIncDate(item?.receivedDate || todayIso()); setIncNotes(item?.notes || ''); setIncError('');
    setIncomeOpen(true);
  };

  const handleSaveIncome = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(incAmount);
    if (!incName.trim()) return setIncError('Enter a title for this income.');
    if (!(amt > 0)) return setIncError('Enter a valid amount.');
    const base = { name: incName.trim(), amount: amt, type: incType, receivedDate: incDate, notes: incNotes.trim() || undefined };
    if (editingIncome) {
      updateIncomeSource(editingIncome.id, base, user?.name || 'Admin');
    } else {
      addIncomeSource({ ...base, source: 'manual', financialYear: fy, submittedBy: user?.name || 'Admin' });
    }
    setIncomeOpen(false);
    setTick(t => t + 1);
    flash('Income saved.');
  };

  const exportExpensesCsv = () => {
    const rows = [toCsvRow(['Date', 'Head', 'Description', 'Vendor', 'Amount', 'Event', 'Booked by', 'Bills'])];
    expenses.forEach(x => rows.push(toCsvRow([x.expenseDate, getExpenseHeadLabel(x.head), x.description, x.vendor, x.amount, x.eventName, x.submittedBy, x.billFiles.map(f => f.name).join('; ')])));
    downloadCsv(`expenses-FY${fy}.csv`, rows.join('\n'));
  };

  const visibleExpenses = expenses
    .filter(x => expHeadFilter === 'all' || x.head === expHeadFilter)
    .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
  const sortedIncome = [...income].sort((a, b) => (b.receivedDate || b.createdAt).localeCompare(a.receivedDate || a.createdAt));

  const balance = summary.totalIncome - summary.totalSpent;
  const budgetRemaining = (budget?.totalAmount || 0) - summary.totalSpent;

  return (
    <div className="p-6 md:p-8 space-y-6 pb-12">
      {toast && (
        <div className="fixed top-20 right-6 z-50 bg-emerald-500 text-white font-semibold px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs">
          <CheckCircle2 className="h-4 w-4" /><span>{toast}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-theme-text-primary tracking-tight">Finance</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30 text-[10px] font-extrabold uppercase tracking-wider">{fy}</span>
          </div>
          <p className="text-xs text-theme-text-secondary mt-1">Annual budget by overhead head, bill-backed expenses, and income — including verified invoice payments.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-theme-card border border-theme-card-border px-3 py-1.5 rounded-xl">
            <CalendarIcon className="h-4 w-4 text-accent shrink-0" />
            <select value={fy} onChange={e => setFy(e.target.value)} className="bg-transparent font-semibold text-xs text-theme-text-primary focus:outline-none cursor-pointer">
              {FINANCIAL_YEARS.map(y => <option key={y} value={y} className="bg-theme-card text-theme-text-primary">Financial Year {y}</option>)}
            </select>
          </div>
          <Link href="/dashboard/invoices" className="px-3.5 py-2 bg-theme-card border border-theme-card-border hover:border-accent text-theme-text-primary font-semibold rounded-xl text-xs flex items-center gap-1.5 transition-all">
            <FileText className="h-4 w-4 text-accent" /> Invoices
          </Link>
          {canBook && (
            <button onClick={openExpense} className="px-3.5 py-2 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl text-xs flex items-center gap-1.5 shadow-md cursor-pointer">
              <Plus className="h-4 w-4" /> Add Expense
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Annual Budget', value: budget ? inr(budget.totalAmount) : 'Not set', sub: budget ? `${inr(summary.allocated)} allocated to heads` : 'Set one to begin tracking', icon: Landmark, tone: 'text-accent' },
          { label: 'Spent', value: inr(summary.totalSpent), sub: budget ? `${inr(budgetRemaining)} ${budgetRemaining >= 0 ? 'remaining' : 'over budget'}` : `${expenses.length} expense(s)`, icon: TrendingDown, tone: budgetRemaining < 0 && budget ? 'text-danger' : 'text-amber-500' },
          { label: 'Income', value: inr(summary.totalIncome), sub: `${inr(summary.invoiceIncome)} from verified invoices`, icon: TrendingUp, tone: 'text-emerald-500' },
          { label: 'Net (Income − Spent)', value: inr(balance), sub: balance >= 0 ? 'Surplus' : 'Deficit', icon: PiggyBank, tone: balance >= 0 ? 'text-emerald-500' : 'text-danger' },
        ].map(k => (
          <div key={k.label} className="glass-panel rounded-2xl p-4 border border-theme-card-border">
            <div className="flex items-center justify-between text-theme-text-secondary text-[11px] font-semibold uppercase tracking-wider">
              {k.label}<k.icon className={`h-4 w-4 ${k.tone}`} />
            </div>
            <div className={`mt-2 text-lg font-bold font-mono ${k.tone}`}>{k.value}</div>
            <div className="text-[11px] text-theme-text-secondary mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-theme-border/40">
        {([['overview', 'Budget by Head'], ['expenses', `Expenses (${expenses.length})`], ['income', `Income (${income.length})`]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px cursor-pointer ${tab === k ? 'border-accent text-accent' : 'border-transparent text-theme-text-secondary hover:text-theme-text-primary'}`}>{label}</button>
        ))}
      </div>

      {/* Overview: annual budget + head-wise breakup */}
      {tab === 'overview' && (
        <div className="glass-panel rounded-2xl border border-theme-card-border p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold text-theme-text-primary">Annual budget breakup — FY {fy}</h2>
              {budget && <p className="text-[11px] text-theme-text-secondary">Last set by {budget.updatedBy} on {budget.updatedAt}{budget.notes ? ` · ${budget.notes}` : ''}</p>}
            </div>
            {canSetBudget && (
              <button onClick={openBudget} className="px-3.5 py-2 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer">
                <Edit2 className="h-3.5 w-3.5" /> {budget ? 'Edit Annual Budget' : 'Set Annual Budget'}
              </button>
            )}
          </div>

          {!budget ? (
            <EmptyState icon={Wallet} title="No annual budget set for this year" description={canSetBudget ? 'Set the annual budget and split it across the eight overhead heads.' : 'The Super User or CEO sets the annual budget. Expenses can still be recorded meanwhile.'} />
          ) : (
            <div className="space-y-3">
              {EXPENSE_HEADS.map(h => {
                const alloc = budget.allocations?.[h.key] || 0;
                const spent = summary.spentByHead[h.key] || 0;
                const pct = alloc > 0 ? (spent / alloc) * 100 : spent > 0 ? 100 : 0;
                const over = spent > alloc;
                return (
                  <div key={h.key} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs gap-3">
                      <span className="font-semibold text-theme-text-primary">{h.label}</span>
                      <span className="font-mono text-theme-text-secondary text-right">
                        <span className={over ? 'text-danger font-bold' : 'text-theme-text-primary'}>{inr(spent)}</span> of {inr(alloc)}
                        <span className={`ml-2 ${over ? 'text-danger' : 'text-emerald-500'}`}>{over ? `${inr(spent - alloc)} over` : `${inr(alloc - spent)} left`}</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-theme-border/30 overflow-hidden">
                      <div className={`h-full rounded-full ${over ? 'bg-danger' : pct > 85 ? 'bg-amber-500' : 'bg-accent'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between text-xs pt-3 border-t border-theme-border/30 font-semibold">
                <span className="text-theme-text-secondary">Unallocated</span>
                <span className="font-mono text-theme-text-primary">{inr(budget.totalAmount - summary.allocated)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Expenses */}
      {tab === 'expenses' && (
        <div className="glass-panel rounded-2xl border border-theme-card-border p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <select value={expHeadFilter} onChange={e => setExpHeadFilter(e.target.value as any)} className="px-3 py-2 bg-theme-background/40 border border-theme-card-border rounded-xl text-xs text-theme-text-primary focus:outline-none focus:border-accent">
              <option value="all">All heads</option>
              {EXPENSE_HEADS.map(h => <option key={h.key} value={h.key}>{h.label}</option>)}
            </select>
            <button onClick={exportExpensesCsv} disabled={!expenses.length} className="px-3 py-2 border border-theme-card-border rounded-xl text-xs font-semibold text-theme-text-primary flex items-center gap-1.5 hover:border-accent disabled:opacity-40 cursor-pointer">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </div>
          {visibleExpenses.length === 0 ? (
            <EmptyState icon={Receipt} title="No expenses recorded" description="Add an expense with its bill, a description and the head it belongs to." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-theme-text-secondary border-b border-theme-border/40">
                    <th className="py-2 pr-3 font-semibold">Date</th><th className="pr-3 font-semibold">Head</th><th className="pr-3 font-semibold">Description</th>
                    <th className="pr-3 font-semibold">Booked by</th><th className="pr-3 font-semibold">Bill</th><th className="pr-3 font-semibold text-right">Amount</th><th />
                  </tr>
                </thead>
                <tbody>
                  {visibleExpenses.map(x => (
                    <tr key={x.id} className="border-b border-theme-border/20 align-top">
                      <td className="py-2.5 pr-3 whitespace-nowrap text-theme-text-secondary">{x.expenseDate}</td>
                      <td className="pr-3"><span className="px-2 py-0.5 rounded-md bg-accent/10 text-accent border border-accent/20 text-[10px] font-semibold">{getExpenseHeadLabel(x.head)}</span></td>
                      <td className="pr-3 text-theme-text-primary max-w-xs">
                        {x.description}
                        {(x.vendor || x.eventName) && <div className="text-[10px] text-theme-text-secondary">{[x.vendor, x.eventName && `Event: ${x.eventName}`].filter(Boolean).join(' · ')}</div>}
                      </td>
                      <td className="pr-3 text-theme-text-secondary">{x.submittedBy}</td>
                      <td className="pr-3">
                        <div className="flex flex-col gap-0.5">
                          {x.billFiles.map((f, i) => (
                            <a key={i} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline"><Paperclip className="h-3 w-3" />{f.name || `Bill ${i + 1}`}</a>
                          ))}
                        </div>
                      </td>
                      <td className="pr-3 text-right font-mono font-semibold text-theme-text-primary">{inr(x.amount)}</td>
                      <td className="text-right">{canDeleteExpense(user, x) && <button onClick={() => handleDeleteExpense(x)} className="text-theme-text-secondary hover:text-danger cursor-pointer" aria-label="Delete expense"><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Income */}
      {tab === 'income' && (
        <div className="glass-panel rounded-2xl border border-theme-card-border p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-theme-text-secondary max-w-xl">Payments on invoices appear here automatically as <strong>Other Income</strong> once a verifier confirms them, with a link back to the invoice they came from.</p>
            {canEditIncome && <button onClick={() => openIncome()} className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer"><Plus className="h-4 w-4" /> Add Income</button>}
          </div>
          {sortedIncome.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No income recorded" description="Sponsorships, grants, donations and verified invoice payments show up here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-theme-text-secondary border-b border-theme-border/40">
                    <th className="py-2 pr-3 font-semibold">Received</th><th className="pr-3 font-semibold">Head</th><th className="pr-3 font-semibold">Source</th><th className="pr-3 font-semibold text-right">Amount</th><th />
                  </tr>
                </thead>
                <tbody>
                  {sortedIncome.map(i => (
                    <tr key={i.id} className="border-b border-theme-border/20 align-top">
                      <td className="py-2.5 pr-3 whitespace-nowrap text-theme-text-secondary">{i.receivedDate || i.createdAt}</td>
                      <td className="pr-3"><span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 text-[10px] font-semibold">{INCOME_TYPE_LABEL[i.type || 'other']}</span></td>
                      <td className="pr-3 text-theme-text-primary">
                        {i.source === 'invoice' ? (
                          <>
                            <Link href={`/dashboard/invoices?open=${i.invoiceId}`} className="inline-flex items-center gap-1 text-accent hover:underline font-semibold">Invoice {i.invoiceNumber} <ExternalLink className="h-3 w-3" /></Link>
                            <div className="text-[10px] text-theme-text-secondary">{i.clientName} · {i.paymentMode} · Ref {i.paymentReference}</div>
                          </>
                        ) : (
                          <>{i.name}{i.notes && <div className="text-[10px] text-theme-text-secondary">{i.notes}</div>}</>
                        )}
                      </td>
                      <td className="pr-3 text-right font-mono font-semibold text-emerald-600">{inr(i.amount)}</td>
                      <td className="text-right whitespace-nowrap">
                        {canEditIncome && i.source !== 'invoice' && (
                          <>
                            <button onClick={() => openIncome(i)} className="text-theme-text-secondary hover:text-accent mr-2 cursor-pointer" aria-label="Edit income"><Edit2 className="h-3.5 w-3.5" /></button>
                            <button onClick={() => { if (confirm(`Delete "${i.name}"?`)) { deleteIncomeSource(i.id, user?.name || 'Admin'); setTick(t => t + 1); } }} className="text-theme-text-secondary hover:text-danger cursor-pointer" aria-label="Delete income"><Trash2 className="h-3.5 w-3.5" /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Annual budget modal */}
      {budgetOpen && (
        <ModalShell title={`Annual Budget — FY ${fy}`} onClose={() => setBudgetOpen(false)} wide>
          <form onSubmit={handleSaveBudget} className="space-y-4 text-xs">
            {budgetError && <div className="p-3 bg-danger/10 border border-danger/25 text-danger rounded-xl">{budgetError}</div>}
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Total Annual Budget (₹) *</label>
              <input type="number" min={1} value={budgetTotal} onChange={e => setBudgetTotal(e.target.value)} className={`${inputCls} font-mono`} placeholder="e.g. 5000000" />
            </div>
            <div className="space-y-2">
              <label className="block font-medium text-theme-text-secondary">Breakup by overhead head</label>
              <div className="grid sm:grid-cols-2 gap-3">
                {EXPENSE_HEADS.map((h, idx) => (
                  <div key={h.key} className="space-y-1">
                    <label className="block text-[11px] text-theme-text-secondary">{idx + 1}. {h.label}</label>
                    <input type="number" min={0} value={budgetAlloc[h.key] || ''} onChange={e => setBudgetAlloc({ ...budgetAlloc, [h.key]: e.target.value })} className={`${inputCls} font-mono`} placeholder="0" />
                  </div>
                ))}
              </div>
              <div className={`flex justify-between rounded-xl px-3 py-2 border ${allocSum > budgetTotalNum + 0.005 ? 'border-danger/40 bg-danger/10 text-danger' : 'border-theme-card-border text-theme-text-secondary'}`}>
                <span>Allocated {inr(allocSum)} of {inr(budgetTotalNum)}</span>
                <span className="font-semibold">{allocSum > budgetTotalNum + 0.005 ? `${inr(allocSum - budgetTotalNum)} over` : `${inr(budgetTotalNum - allocSum)} unallocated`}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Notes</label>
              <textarea rows={2} value={budgetNotes} onChange={e => setBudgetNotes(e.target.value)} className={inputCls} />
            </div>
            <button type="submit" disabled={budgetSaving} className="w-full py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl disabled:opacity-60 cursor-pointer">{budgetSaving ? 'Saving…' : 'Save Annual Budget'}</button>
          </form>
        </ModalShell>
      )}

      {/* Expense modal */}
      {expenseOpen && (
        <ModalShell title="Add Expense" onClose={() => !expSaving && setExpenseOpen(false)}>
          <form onSubmit={handleSaveExpense} className="space-y-4 text-xs">
            {expError && <div className="p-3 bg-danger/10 border border-danger/25 text-danger rounded-xl flex gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{expError}</div>}
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Head *</label>
              <select value={expHead} onChange={e => setExpHead(e.target.value as any)} className={inputCls}>
                <option value="">Select the head this expense falls under…</option>
                {EXPENSE_HEADS.map(h => <option key={h.key} value={h.key}>{h.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Amount (₹) *</label>
                <input type="number" min={0} step="0.01" value={expAmount} onChange={e => setExpAmount(e.target.value)} className={`${inputCls} font-mono`} />
              </div>
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Date on bill *</label>
                <input type="date" value={expDate} max={todayIso()} onChange={e => setExpDate(e.target.value)} className={inputCls} />
              </div>
            </div>
            {overBudgetWarning && <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-600 rounded-xl">{overBudgetWarning}</div>}
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">What is the expense for? *</label>
              <textarea rows={3} value={expDesc} onChange={e => setExpDesc(e.target.value)} className={inputCls} placeholder="e.g. Cab fare to Hyderabad for the investor meet, 12 Nov" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Vendor / payee</label>
                <input type="text" value={expVendor} onChange={e => setExpVendor(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Related event</label>
                <select value={expEventId} onChange={e => setExpEventId(e.target.value)} className={inputCls}>
                  <option value="">None</option>
                  {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block font-medium text-theme-text-secondary flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5 text-accent" />Bill * (image or PDF)</label>
                <span className="text-[10px] text-theme-text-secondary">{expFiles.length}/{MAX_BILLS}</span>
              </div>
              {expFiles.length < MAX_BILLS && (
                <FileDropzone onFilesSelected={fs => setExpFiles(prev => [...prev, ...fs].slice(0, MAX_BILLS))} accept="image/*,.pdf" multiple disabled={expSaving} label="Upload the bill or receipt" hint="Drag and drop, or click to browse" compact />
              )}
              {expFiles.map((f, i) => <FilePreviewRow key={`${f.name}-${i}`} file={f} onRemove={!expSaving ? () => setExpFiles(expFiles.filter((_, j) => j !== i)) : undefined} />)}
            </div>
            {expSaving && <div className="h-1.5 rounded-full bg-theme-border/30 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${expProgress}%` }} /></div>}
            <button type="submit" disabled={expSaving} className="w-full py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl disabled:opacity-60 cursor-pointer">{expSaving ? 'Recording…' : 'Record Expense'}</button>
          </form>
        </ModalShell>
      )}

      {/* Income modal */}
      {incomeOpen && (
        <ModalShell title={editingIncome ? 'Edit Income' : 'Add Income'} onClose={() => setIncomeOpen(false)}>
          <form onSubmit={handleSaveIncome} className="space-y-4 text-xs">
            {incError && <div className="p-3 bg-danger/10 border border-danger/25 text-danger rounded-xl">{incError}</div>}
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Title *</label>
              <input type="text" value={incName} onChange={e => setIncName(e.target.value)} className={inputCls} placeholder="e.g. TCS Innovation Grant" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Amount (₹) *</label>
                <input type="number" min={0} value={incAmount} onChange={e => setIncAmount(e.target.value)} className={`${inputCls} font-mono`} />
              </div>
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Head</label>
                <select value={incType} onChange={e => setIncType(e.target.value as any)} className={inputCls}>
                  {Object.entries(INCOME_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Date received</label>
              <input type="date" value={incDate} onChange={e => setIncDate(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Notes</label>
              <textarea rows={2} value={incNotes} onChange={e => setIncNotes(e.target.value)} className={inputCls} />
            </div>
            <button type="submit" className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl cursor-pointer">Save Income</button>
          </form>
        </ModalShell>
      )}
    </div>
  );
}
