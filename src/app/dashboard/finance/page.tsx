'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ReceiptText,
  Plus,
  Search,
  Filter,
  Download,
  Trash2,
  Eye,
  ExternalLink,
  Calendar,
  Store,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  TrendingDown,
  PiggyBank,
  Wallet,
  Users,
  Plane,
  Zap,
  Megaphone,
  Network,
  Building2,
  Rocket,
  Layers,
  ArrowUpRight,
  FileText,
  TrendingUp,
  Edit2,
  Landmark,
} from 'lucide-react';
import {
  getAnnualBudget,
  saveAnnualBudget,
  getIncomeSources,
  addIncomeSource,
  updateIncomeSource,
  deleteIncomeSource,
  getExpenses,
  addExpense,
  deleteExpense,
  getEvents,
  getCurrentFinancialYear,
  refreshFinanceFromServer,
  filesToReceiptFiles,
  type EventItem,
  type ExpenseItem,
  type IncomeSourceItem,
  type ReceiptFile,
} from '@/lib/local-data';
import { EXPENSE_HEADS, ExpenseHeadKey, getExpenseHeadLabel } from '@/lib/finance';
import { canAddExpense, canDeleteExpense, canManageAnnualBudget, canManageIncome } from '@/lib/permissions';
import { downloadCsv, toCsvRow } from '@/lib/csv';
import { FileDropzone, FilePreviewRow, createProgressTracker } from '@/components/ui/file-dropzone';
import { IdnDrafter } from '@/components/expenses/idn-drafter';
import { EmptyState } from '@/components/ui/empty-state';
import { askConfirm } from '@/components/ui/confirm-dialog';

const CURRENT_FY = getCurrentFinancialYear();
const CURRENT_FY_START = parseInt(CURRENT_FY.split('-')[0], 10);
const FINANCIAL_YEARS = [-5, -4, -3, -2, -1, 0, 1, 2, 3].map(o => `${CURRENT_FY_START + o}-${CURRENT_FY_START + o + 1}`);
const MAX_BILLS = 5;

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const todayIso = () => new Date().toISOString().split('T')[0];

const HEAD_METADATA: Record<
  ExpenseHeadKey,
  {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    bgColor: string;
    borderColor: string;
    shortDesc: string;
  }
> = {
  manpower: {
    icon: Users,
    color: 'text-blue-700 dark:text-blue-300',
    bgColor: 'bg-blue-500/15',
    borderColor: 'border-blue-500/30',
    shortDesc: 'Staff salaries, stipends, and honorarium',
  },
  travel: {
    icon: Plane,
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-500/15',
    borderColor: 'border-amber-500/30',
    shortDesc: 'Flights, conveyance, daily allowances & stay',
  },
  utilities: {
    icon: Zap,
    color: 'text-emerald-700 dark:text-emerald-300',
    bgColor: 'bg-emerald-500/15',
    borderColor: 'border-emerald-500/30',
    shortDesc: 'Electricity, internet, facility upkeep & repairs',
  },
  marketing: {
    icon: Megaphone,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/15',
    borderColor: 'border-purple-500/30',
    shortDesc: 'Branding, PR, website hosting & promotional collateral',
  },
  networking: {
    icon: Network,
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/15',
    borderColor: 'border-pink-500/30',
    shortDesc: 'Seminars, workshops, training & partner meets',
  },
  admin: {
    icon: Building2,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/15',
    borderColor: 'border-cyan-500/30',
    shortDesc: 'Printing, stationery, software subscriptions & office tools',
  },
  startups: {
    icon: Rocket,
    color: 'text-rose-700 dark:text-rose-300',
    bgColor: 'bg-rose-500/15',
    borderColor: 'border-rose-500/30',
    shortDesc: 'Incubatee micro-grants, prototyping & seed assistance',
  },
  misc: {
    icon: Layers,
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/15',
    borderColor: 'border-indigo-500/30',
    shortDesc: 'Contingency & non-standard operational overheads',
  },
};

const INCOME_TYPE_LABEL: Record<string, string> = { sponsor: 'Sponsorship', grant: 'Grant', donation: 'Donation', other: 'Other Income' };
type Tab = 'expenses' | 'income';

const modalInputCls = 'w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent';

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

const inputCls =
  'w-full px-3.5 py-2.5 bg-theme-sidebar/60 border border-theme-border/40 rounded-xl text-xs text-theme-text-primary outline-none focus:border-accent transition-all';

export default function FinancePage() {
  const [user, setUser] = useState<any>(null);
  const [, setTick] = useState(0);
  const [fy, setFy] = useState(CURRENT_FY);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState<Tab>('expenses');

  // Annual budget modal
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetTotal, setBudgetTotal] = useState('');
  const [budgetAlloc, setBudgetAlloc] = useState<Record<string, string>>({});
  const [budgetNotes, setBudgetNotes] = useState('');
  const [budgetError, setBudgetError] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);

  // Income modal (manual entries only; verified invoice payments arrive automatically)
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<IncomeSourceItem | null>(null);
  const [incName, setIncName] = useState('');
  const [incAmount, setIncAmount] = useState('');
  const [incType, setIncType] = useState<'sponsor' | 'grant' | 'donation' | 'other'>('sponsor');
  const [incDate, setIncDate] = useState(todayIso());
  const [incNotes, setIncNotes] = useState('');
  const [incError, setIncError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedHeadFilter, setSelectedHeadFilter] = useState<'all' | ExpenseHeadKey>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'highest' | 'lowest'>('newest');

  // Add Expense Modal
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [expHead, setExpHead] = useState<ExpenseHeadKey | ''>('');
  const [expAmount, setExpAmount] = useState('');
  const [expDesc, setExpDesc] = useState('');
  const [expDate, setExpDate] = useState(todayIso());
  const [expVendor, setExpVendor] = useState('');
  const [expEventId, setExpEventId] = useState('');
  const [expFiles, setExpFiles] = useState<File[]>([]);
  const [expIdnFiles, setExpIdnFiles] = useState<File[]>([]);
  const [idnOpen, setIdnOpen] = useState(false);
  const [expError, setExpError] = useState('');
  const [expSaving, setExpSaving] = useState(false);
  const [expProgress, setExpProgress] = useState(0);

  // Bill Viewer Modal
  const [viewingReceipt, setViewingReceipt] = useState<{ name: string; url: string; type?: string } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('user');
      if (saved) setUser(JSON.parse(saved));
    } catch { /* ignore */ }

    const refresh = () => {
      setEvents(getEvents());
      setTick(t => t + 1);
    };

    refresh();
    refreshFinanceFromServer();

    window.addEventListener('leads-data-sync', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('leads-data-sync', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4500);
  };

  const budget = getAnnualBudget(fy);
  const allExpenses = getExpenses().filter(e => e.financialYear === fy);
  const canAdd = canAddExpense(user);

  // Group expenses by head
  const spentByHead: Record<string, number> = useMemo(() => {
    const map: Record<string, number> = {};
    allExpenses.forEach(e => {
      map[e.head] = (map[e.head] || 0) + e.amount;
    });
    return map;
  }, [allExpenses]);

  const countByHead: Record<string, number> = useMemo(() => {
    const map: Record<string, number> = {};
    allExpenses.forEach(e => {
      map[e.head] = (map[e.head] || 0) + 1;
    });
    return map;
  }, [allExpenses]);

  const totalSpent = useMemo(() => allExpenses.reduce((sum, e) => sum + e.amount, 0), [allExpenses]);
  const totalAllocated = useMemo(() => {
    return EXPENSE_HEADS.reduce((sum, h) => sum + (budget?.allocations?.[h.key] || 0), 0);
  }, [budget]);

  // Determine highest spend head
  const highestSpendHead = useMemo(() => {
    let topKey: ExpenseHeadKey | null = null;
    let topAmount = 0;
    for (const h of EXPENSE_HEADS) {
      const amt = spentByHead[h.key] || 0;
      if (amt > topAmount) {
        topAmount = amt;
        topKey = h.key;
      }
    }
    return topKey ? { head: topKey, amount: topAmount } : null;
  }, [spentByHead]);

  // Filtered expenses list
  const filteredExpenses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allExpenses
      .filter(e => selectedHeadFilter === 'all' || e.head === selectedHeadFilter)
      .filter(e => {
        if (!q) return true;
        return (
          e.description.toLowerCase().includes(q) ||
          (e.vendor || '').toLowerCase().includes(q) ||
          (e.submittedBy || '').toLowerCase().includes(q) ||
          (e.submittedByEmail || '').toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q) ||
          (e.eventName || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortBy === 'newest') return b.expenseDate.localeCompare(a.expenseDate) || b.id.localeCompare(a.id);
        if (sortBy === 'oldest') return a.expenseDate.localeCompare(b.expenseDate) || a.id.localeCompare(b.id);
        if (sortBy === 'highest') return b.amount - a.amount;
        if (sortBy === 'lowest') return a.amount - b.amount;
        return 0;
      });
  }, [allExpenses, selectedHeadFilter, searchQuery, sortBy]);

  const income = getIncomeSources().filter(i => i.financialYear === fy);
  const sortedIncome = [...income].sort((a, b) => (b.receivedDate || b.createdAt).localeCompare(a.receivedDate || a.createdAt));
  const totalIncome = income.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const invoiceIncome = income.filter(i => i.source === 'invoice').reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const netBalance = totalIncome - totalSpent;
  const budgetTotalSet = budget?.totalAmount || 0;
  const budgetRemaining = budgetTotalSet - totalSpent;
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
      setTick(t => t + 1);
      flash(`Annual budget for FY ${fy} saved.`);
    } catch (err: any) {
      setBudgetError(err.message || 'Could not save the budget.');
    } finally {
      setBudgetSaving(false);
    }
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

  const openAddExpenseModal = (preselectedHead?: ExpenseHeadKey) => {
    setExpHead(preselectedHead || '');
    setExpAmount('');
    setExpDesc('');
    setExpDate(todayIso());
    setExpVendor('');
    setExpEventId('');
    setExpFiles([]);
    setExpIdnFiles([]);
    setExpError('');
    setExpProgress(0);
    setExpenseModalOpen(true);
  };

  const headRemaining = (head: ExpenseHeadKey) =>
    (budget?.allocations?.[head] || 0) - (spentByHead[head] || 0);

  const expAmountNum = parseFloat(expAmount) || 0;
  const isOverBudget =
    expHead &&
    expAmountNum > 0 &&
    budget?.allocations?.[expHead] &&
    expAmountNum > headRemaining(expHead as ExpenseHeadKey);

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setExpError('');
    if (!expHead) return setExpError('Please select the overhead head this expense falls under.');
    if (expAmountNum <= 0) return setExpError('Enter a valid expense amount in INR.');
    if (!expDesc.trim()) return setExpError('Please provide a description of the expense.');
    if (!expDate) return setExpError('Enter the date on the bill.');
    if (expFiles.length === 0) return setExpError('Attach the bill/invoice receipt file (PDF or image).');
    if (!user) return setExpError('You must be signed in to book an expense.');

    setExpSaving(true);
    setExpProgress(0);
    try {
      const billFiles = await filesToReceiptFiles(expFiles);
      const idnFiles = await filesToReceiptFiles(expIdnFiles);
      const ev = events.find(x => x.id === expEventId);
      const tracker = createProgressTracker(pct => setExpProgress(pct));

      await addExpense(
        {
          head: expHead,
          amount: expAmountNum,
          description: expDesc.trim(),
          expenseDate: expDate,
          billFiles,
          idnFiles,
          vendor: expVendor.trim() || undefined,
          eventId: ev?.id,
          eventName: ev?.title,
          submittedBy: user.name || 'Staff',
          submittedByEmail: user.email || '',
        },
        tracker
      );

      setExpenseModalOpen(false);
      setTick(t => t + 1);
      flash(`Expense of ${inr(expAmountNum)} recorded under ${getExpenseHeadLabel(expHead)}. Finance module updated.`);
    } catch (err: any) {
      setExpError(err.message || 'Could not record the expense.');
    } finally {
      setExpSaving(false);
    }
  };

  const handleDeleteExpense = async (exp: ExpenseItem) => {
    if (!await askConfirm(`Are you sure you want to delete this expense of ${inr(exp.amount)} under ${getExpenseHeadLabel(exp.head)}?`)) {
      return;
    }
    const success = deleteExpense(exp.id, user?.name || 'Staff');
    if (success) {
      setTick(t => t + 1);
      flash(`Expense ${exp.id} deleted. Finance module updated.`);
    } else {
      flash('Could not delete expense.');
    }
  };

  const handleExportCsv = () => {
    if (filteredExpenses.length === 0) {
      flash('No expenses to export.');
      return;
    }
    const headers = ['Voucher ID', 'Date', 'Financial Year', 'Expense Head', 'Description', 'Amount (INR)', 'Vendor', 'Event', 'Submitted By', 'Bills Count', 'IDN Count'];
    const rows = filteredExpenses.map(e => [
      e.id,
      e.expenseDate,
      e.financialYear,
      getExpenseHeadLabel(e.head),
      e.description,
      e.amount,
      e.vendor || '',
      e.eventName || '',
      `${e.submittedBy} (${e.submittedByEmail})`,
      e.billFiles?.length || 0,
      e.idnFiles?.length || 0,
    ]);
    const csvContent = [toCsvRow(headers), ...rows.map(r => toCsvRow(r))].join('\n');
    downloadCsv(`RTBI_Expenses_${fy}_${new Date().toISOString().split('T')[0]}.csv`, csvContent);
    flash('Expenses exported to CSV.');
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary flex items-center gap-2">
            <Wallet className="h-6 w-6 text-accent-strong dark:text-accent-soft" />
            Finance
          </h1>
          <p className="text-xs text-theme-text-secondary mt-0.5">
            Annual budget by overhead head, bill-backed expenses with IDN, and income — including verified invoice payments.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* FY selector */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-theme-sidebar/60 border border-theme-border/40 text-xs">
            <span className="text-xs font-bold text-theme-text-secondary uppercase">FY</span>
            <select
              value={fy}
              onChange={e => setFy(e.target.value)}
              className="bg-transparent font-bold text-theme-text-primary outline-none cursor-pointer"
            >
              {FINANCIAL_YEARS.map(y => (
                <option key={y} value={y} className="bg-theme-card text-theme-text-primary">
                  {y} {y === CURRENT_FY ? '(Current)' : ''}
                </option>
              ))}
            </select>
          </div>

          {canSetBudget && (
            <button
              onClick={openBudget}
              className="flex items-center gap-1 px-3 py-2 rounded-xl border border-theme-border/40 hover:bg-white/5 text-xs text-theme-text-secondary hover:text-theme-text-primary font-semibold transition-all cursor-pointer"
            >
              <Edit2 className="h-3.5 w-3.5" /> {budget ? 'Edit Annual Budget' : 'Set Annual Budget'}
            </button>
          )}

          <Link
            href="/dashboard/invoices"
            className="flex items-center gap-1 px-3 py-2 rounded-xl border border-theme-border/40 hover:bg-white/5 text-xs text-theme-text-secondary hover:text-theme-text-primary font-semibold transition-all"
          >
            <FileText className="h-3.5 w-3.5" /> Invoices <ExternalLink className="h-3 w-3 opacity-60" />
          </Link>

          {canBook && (
            <button
              onClick={() => openAddExpenseModal()}
              className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl shadow-md shadow-accent/20 transition-all cursor-pointer"
            >
              <Plus className="h-4 w-4" /> Record Expense
            </button>
          )}
        </div>
      </div>

      {/* Toast Notice */}
      {toast && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-xs text-accent-strong dark:text-accent-soft flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>{toast}</span>
          </div>
          <button onClick={() => setToast('')} className="p-1 hover:bg-white/10 rounded cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: 'Annual Budget',
            value: budget ? inr(budgetTotalSet) : 'Not set',
            sub: budget ? `${inr(totalAllocated)} allocated · ${inr(budgetTotalSet - totalAllocated)} unallocated` : 'Set one to begin tracking',
            icon: Landmark, chip: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
          },
          {
            label: 'Total Incurred Spend',
            value: inr(totalSpent),
            sub: budget ? `${inr(Math.abs(budgetRemaining))} ${budgetRemaining >= 0 ? 'remaining' : 'over budget'} · ${allExpenses.length} voucher${allExpenses.length === 1 ? '' : 's'}` : `${allExpenses.length} voucher${allExpenses.length === 1 ? '' : 's'}${highestSpendHead ? ` · top: ${getExpenseHeadLabel(highestSpendHead.head)}` : ''}`,
            icon: TrendingDown, chip: budget && budgetRemaining < 0 ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-accent/15 text-accent-strong dark:text-accent-soft',
          },
          {
            label: 'Income',
            value: inr(totalIncome),
            sub: `${inr(invoiceIncome)} from verified invoices`,
            icon: TrendingUp, chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
          },
          {
            label: 'Net (Income − Spent)',
            value: inr(netBalance),
            sub: netBalance >= 0 ? 'Surplus' : 'Deficit',
            icon: PiggyBank, chip: netBalance >= 0 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
          },
        ].map(k => (
          <div key={k.label} className="glass-panel rounded-2xl p-4 border border-white/10">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-theme-text-secondary">{k.label}</span>
              <div className={`p-2 rounded-xl ${k.chip}`}><k.icon className="h-4 w-4" /></div>
            </div>
            <div className="mt-2 text-2xl font-bold text-theme-text-primary">{k.value}</div>
            <div className="text-xs text-theme-text-secondary mt-1">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-theme-border/40" role="tablist">
        {([['expenses', `Expenses (${allExpenses.length})`], ['income', `Income (${income.length})`]] as [Tab, string][]).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px cursor-pointer ${tab === k ? 'border-accent text-accent-strong dark:text-accent-soft' : 'border-transparent text-theme-text-secondary hover:text-theme-text-primary'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'expenses' && (
      <>
      {/* Head-wise Expense Incurred Section */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-theme-text-primary flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-accent-strong dark:text-accent-soft" />
              Incurred Expenses by Individual Head
            </h2>
            <p className="text-xs text-theme-text-secondary">
              Review what has been incurred under each budget line. Click "+ Add" on any head to record a bill directly.
            </p>
          </div>
          {selectedHeadFilter !== 'all' && (
            <button
              onClick={() => setSelectedHeadFilter('all')}
              className="text-xs text-accent-strong dark:text-accent-soft hover:underline font-semibold flex items-center gap-1 cursor-pointer"
            >
              Reset filter to Show All Heads
            </button>
          )}
        </div>

        {/* 8 Heads Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {EXPENSE_HEADS.map(head => {
            const meta = HEAD_METADATA[head.key];
            const HeadIcon = meta.icon;
            const spent = spentByHead[head.key] || 0;
            const count = countByHead[head.key] || 0;
            const allocation = budget?.allocations?.[head.key] || 0;
            const hasCap = allocation > 0;
            const remaining = allocation - spent;
            const isExceeded = hasCap && spent > allocation;
            const pctUsed = hasCap ? Math.min(100, Math.round((spent / allocation) * 100)) : 0;
            const isSelected = selectedHeadFilter === head.key;

            return (
              <div
                key={head.key}
                className={`glass-panel rounded-2xl p-4 border transition-all flex flex-col justify-between ${
                  isSelected ? 'border-accent bg-accent/5 shadow-md' : 'border-white/10 hover:border-white/20'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`p-2 rounded-xl ${meta.bgColor} ${meta.color} border ${meta.borderColor}`}>
                        <HeadIcon className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-xs text-theme-text-primary line-clamp-1" title={head.label}>
                          {head.label}
                        </h3>
                        <span className="text-xs text-theme-text-secondary">{count} claim{count === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="text-xl font-bold text-theme-text-primary">{inr(spent)}</div>
                    <div className="flex items-center justify-between text-xs text-theme-text-secondary mt-0.5">
                      <span>{hasCap ? `Cap: ${inr(allocation)}` : 'Discretionary'}</span>
                      {hasCap && (
                        <span className={isExceeded ? 'text-danger dark:text-danger-soft font-bold' : 'text-emerald-700 dark:text-emerald-300 font-semibold'}>
                          {isExceeded ? `Over by ${inr(spent - allocation)}` : `${inr(remaining)} left`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  {hasCap && (
                    <div className="w-full bg-white/5 rounded-full h-1.5 mt-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isExceeded ? 'bg-danger' : pctUsed > 80 ? 'bg-amber-400' : 'bg-emerald-400'
                        }`}
                        style={{ width: `${pctUsed}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-theme-border/20">
                  <button
                    onClick={() => setSelectedHeadFilter(selectedHeadFilter === head.key ? 'all' : head.key)}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold text-center transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-accent/20 text-accent-strong dark:text-accent-soft border border-accent/30'
                        : 'bg-theme-sidebar/50 text-theme-text-secondary hover:text-theme-text-primary hover:bg-white/5'
                    }`}
                  >
                    {isSelected ? 'Viewing' : 'Filter'}
                  </button>
                  <button
                    onClick={() => openAddExpenseModal(head.key)}
                    className="py-1.5 px-2.5 rounded-lg bg-accent/15 text-accent-strong dark:text-accent-soft hover:bg-accent/25 text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                    title={`Record expense under ${head.label}`}
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expenses Register Table Section */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-theme-text-primary">Expense Claims Register</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-theme-text-secondary font-mono">
              {filteredExpenses.length} entries
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-secondary" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search vendor, desc, submitter..."
                className="pl-8 pr-3 py-1.5 rounded-xl bg-theme-sidebar/60 border border-theme-border/40 text-xs text-theme-text-primary outline-none focus:border-accent w-48 sm:w-60"
              />
            </div>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-xl bg-theme-sidebar/60 border border-theme-border/40 text-xs text-theme-text-primary outline-none focus:border-accent cursor-pointer"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="highest">Highest Amount</option>
              <option value="lowest">Lowest Amount</option>
            </select>

            {/* Export CSV */}
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-theme-border/40 hover:bg-white/5 text-xs text-theme-text-secondary hover:text-theme-text-primary font-semibold transition-all cursor-pointer"
              title="Download CSV"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <button
            onClick={() => setSelectedHeadFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              selectedHeadFilter === 'all'
                ? 'bg-accent text-white shadow-sm'
                : 'bg-theme-sidebar/60 text-theme-text-secondary hover:text-theme-text-primary hover:bg-white/5 border border-theme-border/30'
            }`}
          >
            All Heads ({allExpenses.length})
          </button>
          {EXPENSE_HEADS.map(h => {
            const isSelected = selectedHeadFilter === h.key;
            const count = countByHead[h.key] || 0;
            return (
              <button
                key={h.key}
                onClick={() => setSelectedHeadFilter(isSelected ? 'all' : h.key)}
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-accent text-white shadow-sm'
                    : 'bg-theme-sidebar/60 text-theme-text-secondary hover:text-theme-text-primary hover:bg-white/5 border border-theme-border/30'
                }`}
              >
                <span>{h.label}</span>
                <span className={`text-xs px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-white/20' : 'bg-white/10'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Expenses Table */}
        <div className="glass-panel rounded-2xl border border-white/10 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-theme-text-secondary border-b border-theme-border/20 bg-theme-sidebar/30">
                <th className="px-4 py-3">Expense &amp; Submitter</th>
                <th className="px-4 py-3">Head Line</th>
                <th className="px-4 py-3">Bill Date &amp; FY</th>
                <th className="px-4 py-3">Vendor / Context</th>
                <th className="px-4 py-3 text-right">Incurred Amount</th>
                <th className="px-4 py-3 text-center">IDN &amp; Bill</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-theme-text-secondary">
                    <EmptyState
                      icon={ReceiptText}
                      title="No Expenses Incurred Yet"
                      description={
                        searchQuery || selectedHeadFilter !== 'all'
                          ? 'No expenses matched your filter criteria.'
                          : `No expenses have been recorded for FY ${fy} yet. Click "Record Expense" to book your first bill.`
                      }
                      actionLabel={canAdd ? 'Record First Expense' : undefined}
                      onAction={canAdd ? () => openAddExpenseModal() : undefined}
                    />
                  </td>
                </tr>
              ) : (
                filteredExpenses.map(e => {
                  const meta = HEAD_METADATA[e.head] || HEAD_METADATA.misc;
                  const canDelete = canDeleteExpense(user, e);
                  const billsCount = e.billFiles?.length || 0;

                  return (
                    <tr key={e.id} className="border-b border-theme-border/10 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 max-w-xs">
                        <div className="font-semibold text-theme-text-primary text-xs line-clamp-1" title={e.description}>
                          {e.description}
                        </div>
                        <div className="text-xs text-theme-text-secondary flex items-center gap-1.5 mt-0.5">
                          <span>{e.submittedBy}</span>
                          <span className="opacity-40">·</span>
                          <span className="font-mono text-xs opacity-75">{e.id}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${meta.bgColor} ${meta.color} ${meta.borderColor}`}>
                          {getExpenseHeadLabel(e.head)}
                        </span>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium text-theme-text-primary text-xs">{e.expenseDate}</div>
                        <div className="text-xs text-theme-text-secondary font-mono">FY {e.financialYear}</div>
                      </td>

                      <td className="px-4 py-3 max-w-xs">
                        {e.vendor && (
                          <div className="flex items-center gap-1 text-xs text-theme-text-primary">
                            <Store className="h-3 w-3 text-accent-strong dark:text-accent-soft" />
                            <span className="truncate">{e.vendor}</span>
                          </div>
                        )}
                        {e.eventName && (
                          <div className="flex items-center gap-1 text-xs text-theme-text-secondary mt-0.5">
                            <Calendar className="h-3 w-3 text-primary-light" />
                            <span className="truncate">{e.eventName}</span>
                          </div>
                        )}
                        {!e.vendor && !e.eventName && <span className="text-xs text-theme-text-secondary italic">—</span>}
                      </td>

                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="font-bold text-sm text-theme-text-primary">{inr(e.amount)}</span>
                      </td>

                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {(e.idnFiles || []).map((b, idx) => (
                            <button
                              key={`idn${idx}`}
                              onClick={() => { if (b.url) setViewingReceipt({ name: b.name, url: b.url, type: b.type }); }}
                              className="px-2 py-1 rounded-lg bg-white/5 hover:bg-accent/20 border border-theme-border/30 text-xs text-accent-strong dark:text-accent-soft font-semibold transition-all cursor-pointer flex items-center gap-1"
                              title={`View ${b.name}`}
                            >
                              <FileText className="h-3 w-3" />
                              <span>IDN {idx + 1}</span>
                            </button>
                          ))}
                          {billsCount > 0 ? e.billFiles.map((b, idx) => (
                            <button
                              key={idx}
                              onClick={() => {
                                if (b.url) {
                                  setViewingReceipt({ name: b.name, url: b.url, type: b.type });
                                }
                              }}
                              className="px-2 py-1 rounded-lg bg-white/5 hover:bg-accent/20 border border-theme-border/30 text-xs text-accent-strong dark:text-accent-soft font-semibold transition-all cursor-pointer flex items-center gap-1"
                              title={`View ${b.name}`}
                            >
                              <FileText className="h-3 w-3" />
                              <span>Bill {idx + 1}</span>
                            </button>
                          )) : (
                            <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">No bill</span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {canDelete && (
                            <button
                              onClick={() => handleDeleteExpense(e)}
                              className="p-1.5 rounded-lg text-theme-text-secondary hover:text-danger hover:bg-danger/10 transition-all cursor-pointer"
                              title="Delete expense"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {tab === 'income' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-theme-text-secondary max-w-xl">Payments on invoices appear here automatically as <strong>Other Income</strong> once a verifier confirms them, with a link back to the invoice they came from.</p>
            {canEditIncome && (
              <button onClick={() => openIncome()} className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer">
                <Plus className="h-4 w-4" /> Add Income
              </button>
            )}
          </div>
          <div className="glass-panel rounded-2xl border border-white/10 overflow-x-auto">
            {sortedIncome.length === 0 ? (
              <div className="px-4 py-12">
                <EmptyState icon={TrendingUp} title="No income recorded" description="Sponsorships, grants, donations and verified invoice payments show up here." />
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-theme-text-secondary border-b border-theme-border/20 bg-theme-sidebar/30">
                    <th className="px-4 py-3">Received</th>
                    <th className="px-4 py-3">Head</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedIncome.map(i => (
                    <tr key={i.id} className="border-b border-theme-border/10 hover:bg-white/[0.02] align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-theme-text-secondary">{i.receivedDate || i.createdAt}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-xs font-bold">{INCOME_TYPE_LABEL[i.type || 'other']}</span>
                      </td>
                      <td className="px-4 py-3 text-theme-text-primary">
                        {i.source === 'invoice' ? (
                          <>
                            <Link href={`/dashboard/invoices?open=${i.invoiceId}`} className="inline-flex items-center gap-1 text-accent-strong dark:text-accent-soft hover:underline font-semibold">
                              Invoice {i.invoiceNumber} <ExternalLink className="h-3 w-3" />
                            </Link>
                            <div className="text-xs text-theme-text-secondary">{i.clientName} · {i.paymentMode} · Ref {i.paymentReference}</div>
                          </>
                        ) : (
                          <>{i.name}{i.notes && <div className="text-xs text-theme-text-secondary">{i.notes}</div>}</>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap font-bold text-sm text-emerald-700 dark:text-emerald-300">{inr(i.amount)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {canEditIncome && i.source !== 'invoice' && (
                          <>
                            <button onClick={() => openIncome(i)} className="p-1.5 rounded-lg text-theme-text-secondary hover:text-accent cursor-pointer" aria-label="Edit income"><Edit2 className="h-3.5 w-3.5" /></button>
                            <button
                              onClick={async () => { if (await askConfirm(`Delete "${i.name}"?`)) { deleteIncomeSource(i.id, user?.name || 'Admin'); setTick(t => t + 1); } }}
                              className="p-1.5 rounded-lg text-theme-text-secondary hover:text-danger cursor-pointer"
                              aria-label="Delete income"
                            ><Trash2 className="h-3.5 w-3.5" /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Record Expense Modal */}
      {expenseModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setExpenseModalOpen(false)}
        >
          <form
            onSubmit={handleSaveExpense}
            onClick={e => e.stopPropagation()}
            className="bg-theme-card border border-theme-card-border rounded-3xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl relative"
          >
            <div className="flex items-center justify-between border-b border-theme-border/20 pb-3">
              <div>
                <h2 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                  <ReceiptText className="h-5 w-5 text-accent-strong dark:text-accent-soft" />
                  Record Incurred Expense
                </h2>
                <p className="text-xs text-theme-text-secondary">
                  Add an expense incurred under any designated head. Syncs immediately with the central Finance module.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpenseModalOpen(false)}
                className="p-1.5 hover:bg-white/10 rounded-lg text-theme-text-secondary hover:text-theme-text-primary cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3.5">
              {/* Head Selection */}
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-theme-text-secondary">Overhead Head *</span>
                <select
                  required
                  value={expHead}
                  onChange={e => setExpHead(e.target.value as ExpenseHeadKey)}
                  className={inputCls}
                >
                  <option value="">— Select an Overhead Head —</option>
                  {EXPENSE_HEADS.map(h => (
                    <option key={h.key} value={h.key}>
                      {h.label} {budget?.allocations?.[h.key] ? `(Allocated: ${inr(budget.allocations[h.key]!)})` : ''}
                    </option>
                  ))}
                </select>
                {expHead && (
                  <p className="text-xs text-theme-text-secondary">
                    {HEAD_METADATA[expHead as ExpenseHeadKey]?.shortDesc}
                  </p>
                )}
              </label>

              {/* Amount and Date Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-theme-text-secondary">Amount (₹) *</span>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="1"
                    value={expAmount}
                    onChange={e => setExpAmount(e.target.value)}
                    placeholder="e.g. 4500"
                    className={inputCls}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-theme-text-secondary">Bill Date *</span>
                  <input
                    required
                    type="date"
                    value={expDate}
                    onChange={e => setExpDate(e.target.value)}
                    className={inputCls}
                  />
                </label>
              </div>

              {/* Over budget warning */}
              {isOverBudget && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Over Budget Warning: </span>
                    This expense of {inr(expAmountNum)} exceeds the remaining allocation for{' '}
                    <b>{getExpenseHeadLabel(expHead)}</b> ({inr(Math.max(0, headRemaining(expHead as ExpenseHeadKey)))} left).
                    It will still be recorded and flagged in the Finance module.
                  </div>
                </div>
              )}

              {/* Description */}
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-theme-text-secondary">Expense Description *</span>
                <textarea
                  required
                  rows={2}
                  value={expDesc}
                  onChange={e => setExpDesc(e.target.value)}
                  placeholder="Detail what the expense was incurred for (e.g., IndiGo flight to Delhi conference)..."
                  className={inputCls}
                />
              </label>

              {/* Vendor & Event Linkage */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-theme-text-secondary">Vendor / Payee</span>
                  <input
                    value={expVendor}
                    onChange={e => setExpVendor(e.target.value)}
                    placeholder="e.g. IndiGo Airlines, Reliance Digital"
                    className={inputCls}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-theme-text-secondary">Linked Event (optional)</span>
                  <select
                    value={expEventId}
                    onChange={e => setExpEventId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">— No Event Linked —</option>
                    {events.map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {ev.title} ({ev.startDate || 'TBD'})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Document uploads: ① IDN / delivery note, ② Bill */}
              <div className="space-y-4 pt-2 border-t border-theme-border/20">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-theme-text-secondary">
                      ① IDN / Delivery Note (PDF / Images)
                    </span>
                    <span className="text-xs text-theme-text-secondary">Optional · max {MAX_BILLS} files (10MB each)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIdnOpen(true)}
                    disabled={expSaving}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-accent/40 bg-accent/10 text-xs font-semibold text-accent-strong dark:text-accent-soft hover:bg-accent/20 cursor-pointer disabled:opacity-60"
                  >
                    <FileText className="h-4 w-4" /> Draft IDN automatically from these details
                  </button>
                  <FileDropzone
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    multiple
                    onFilesSelected={files => setExpIdnFiles(prev => [...prev, ...files].slice(0, MAX_BILLS))}
                    disabled={expSaving}
                  />
                  {expIdnFiles.length > 0 && (
                    <div className="space-y-1.5 mt-2">
                      {expIdnFiles.map((f, i) => (
                        <FilePreviewRow
                          key={i}
                          file={f}
                          onRemove={expSaving ? undefined : () => setExpIdnFiles(prev => prev.filter((_, idx) => idx !== i))}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-theme-text-secondary">
                    ② Bill (PDF / Images) *
                  </span>
                  <span className="text-xs text-theme-text-secondary">Max {MAX_BILLS} files (10MB each)</span>
                </div>

                <FileDropzone
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  multiple
                  onFilesSelected={files => setExpFiles(prev => [...prev, ...files].slice(0, MAX_BILLS))}
                  disabled={expSaving}
                />

                {expFiles.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    {expFiles.map((f, i) => (
                      <FilePreviewRow
                        key={i}
                        file={f}
                        onRemove={expSaving ? undefined : () => setExpFiles(prev => prev.filter((_, idx) => idx !== i))}
                      />
                    ))}
                  </div>
                )}
                </div>

                {expSaving && expProgress > 0 && (
                  <div className="space-y-1 mt-2">
                    <div className="flex justify-between text-xs text-theme-text-secondary">
                      <span>Uploading receipt files…</span>
                      <span>{expProgress}%</span>
                    </div>
                    <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                      <div className="h-full bg-accent transition-all duration-150" style={{ width: `${expProgress}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {expError && <p className="text-xs text-danger dark:text-danger-soft">{expError}</p>}

            <div className="flex items-center justify-between pt-3 border-t border-theme-border/20">
              <span className="text-xs text-theme-text-secondary">
                Submitted by <b>{user?.name || 'Staff'}</b>
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setExpenseModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-theme-text-secondary hover:text-theme-text-primary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={expSaving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl shadow-md shadow-accent/20 cursor-pointer disabled:opacity-60"
                >
                  {expSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save &amp; Book Expense
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {idnOpen && (
        <IdnDrafter
          seed={{
            vendor: expVendor,
            amount: expAmountNum,
            billDate: expDate,
            description: expDesc,
            headLabel: expHead ? getExpenseHeadLabel(expHead) : '',
          }}
          onClose={() => setIdnOpen(false)}
          onAttach={(file, total) => {
            setExpIdnFiles(prev => [...prev, file].slice(0, MAX_BILLS));
            if (total > 0) setExpAmount(String(total));
            flash(`IDN attached as ① IDN and Amount set to ${inr(total)}. Download the DOCX from the drafter if you need to edit it.`);
          }}
        />
      )}

      {/* Annual budget modal */}
      {budgetOpen && (
        <ModalShell title={`Annual Budget — FY ${fy}`} onClose={() => setBudgetOpen(false)} wide>
          <form onSubmit={handleSaveBudget} className="space-y-4 text-xs">
            {budgetError && <div className="p-3 bg-danger/10 border border-danger/25 text-danger dark:text-danger-soft rounded-xl">{budgetError}</div>}
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Total Annual Budget (₹) *</label>
              <input type="number" min={1} value={budgetTotal} onChange={e => setBudgetTotal(e.target.value)} className={`${modalInputCls} font-mono`} placeholder="e.g. 5000000" />
            </div>
            <div className="space-y-2">
              <label className="block font-medium text-theme-text-secondary">Breakup by overhead head</label>
              <div className="grid sm:grid-cols-2 gap-3">
                {EXPENSE_HEADS.map((h, idx) => (
                  <div key={h.key} className="space-y-1">
                    <label className="block text-xs text-theme-text-secondary">{idx + 1}. {h.label}</label>
                    <input type="number" min={0} value={budgetAlloc[h.key] || ''} onChange={e => setBudgetAlloc({ ...budgetAlloc, [h.key]: e.target.value })} className={`${modalInputCls} font-mono`} placeholder="0" />
                  </div>
                ))}
              </div>
              <div className={`flex justify-between rounded-xl px-3 py-2 border ${allocSum > budgetTotalNum + 0.005 ? 'border-danger/40 bg-danger/10 text-danger dark:text-danger-soft' : 'border-theme-card-border text-theme-text-secondary'}`}>
                <span>Allocated {inr(allocSum)} of {inr(budgetTotalNum)}</span>
                <span className="font-semibold">{allocSum > budgetTotalNum + 0.005 ? `${inr(allocSum - budgetTotalNum)} over` : `${inr(budgetTotalNum - allocSum)} unallocated`}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Notes</label>
              <textarea rows={2} value={budgetNotes} onChange={e => setBudgetNotes(e.target.value)} className={modalInputCls} />
            </div>
            <button type="submit" disabled={budgetSaving} className="w-full py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl disabled:opacity-60 cursor-pointer">{budgetSaving ? 'Saving…' : 'Save Annual Budget'}</button>
          </form>
        </ModalShell>
      )}

      {/* Income modal */}
      {incomeOpen && (
        <ModalShell title={editingIncome ? 'Edit Income' : 'Add Income'} onClose={() => setIncomeOpen(false)}>
          <form onSubmit={handleSaveIncome} className="space-y-4 text-xs">
            {incError && <div className="p-3 bg-danger/10 border border-danger/25 text-danger dark:text-danger-soft rounded-xl">{incError}</div>}
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Title *</label>
              <input type="text" value={incName} onChange={e => setIncName(e.target.value)} className={modalInputCls} placeholder="e.g. TCS Innovation Grant" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Amount (₹) *</label>
                <input type="number" min={0} value={incAmount} onChange={e => setIncAmount(e.target.value)} className={`${modalInputCls} font-mono`} />
              </div>
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Head</label>
                <select value={incType} onChange={e => setIncType(e.target.value as any)} className={modalInputCls}>
                  {Object.entries(INCOME_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Date received</label>
              <input type="date" value={incDate} onChange={e => setIncDate(e.target.value)} className={modalInputCls} />
            </div>
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Notes</label>
              <textarea rows={2} value={incNotes} onChange={e => setIncNotes(e.target.value)} className={modalInputCls} />
            </div>
            <button type="submit" className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl cursor-pointer">Save Income</button>
          </form>
        </ModalShell>
      )}

      {/* Bill Viewer Modal */}
      {viewingReceipt && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setViewingReceipt(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-theme-card border border-theme-card-border rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between p-4 border-b border-theme-border/20 bg-theme-sidebar/50">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-5 w-5 text-accent-strong dark:text-accent-soft shrink-0" />
                <h3 className="font-bold text-xs text-theme-text-primary truncate">{viewingReceipt.name}</h3>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={viewingReceipt.url}
                  download={viewingReceipt.name}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
                <button
                  onClick={() => setViewingReceipt(null)}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-theme-text-secondary hover:text-theme-text-primary cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/40 min-h-[300px]">
              {viewingReceipt.url.endsWith('.pdf') || viewingReceipt.type?.includes('pdf') ? (
                <iframe src={viewingReceipt.url} className="w-full h-[65vh] rounded-xl border border-theme-border/20" title={viewingReceipt.name} />
              ) : (
                <img
                  src={viewingReceipt.url}
                  alt={viewingReceipt.name}
                  className="max-h-[65vh] max-w-full rounded-xl object-contain shadow-lg"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
