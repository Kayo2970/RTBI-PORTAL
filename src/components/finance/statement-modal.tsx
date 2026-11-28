'use client';

import React, { useMemo, useState } from 'react';
import { X, FileText, FileSpreadsheet, Archive, Loader2, FileBarChart } from 'lucide-react';
import { getAnnualBudget, getExpenses, getIncomeSources, getInvoices } from '@/lib/local-data';
import { getFinancialYearForDate } from '@/lib/finance';
import {
  buildStatement, currentMonth, downloadBlob, statementCsv, statementPdf, statementZip,
} from '@/lib/finance-statement';

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Monthly Statement of Income & Expenditure: preview, PDF, CSV, and a ZIP that bundles the linked bills / IDNs / payment proofs. */
export function StatementModal({ preparedBy, initialMonth, onClose }: { preparedBy: string; initialMonth?: string; onClose: () => void }) {
  const [month, setMonth] = useState(initialMonth || currentMonth());
  const [busy, setBusy] = useState<'' | 'pdf' | 'csv' | 'zip'>('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');

  const statement = useMemo(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    const budget = getAnnualBudget(getFinancialYearForDate(`${month}-01`));
    return buildStatement(month, getExpenses(), getIncomeSources(), getInvoices(), budget?.allocations, budget?.totalAmount || 0);
  }, [month]);

  const run = async (kind: 'pdf' | 'csv' | 'zip') => {
    if (!statement) return;
    setBusy(kind); setError(''); setProgress(null);
    try {
      const base = `RTBI_Statement_${statement.month}`;
      if (kind === 'pdf') downloadBlob(await statementPdf(statement, preparedBy), `${base}.pdf`);
      else if (kind === 'csv') downloadBlob(new Blob(['﻿' + statementCsv(statement)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`);
      else downloadBlob(await statementZip(statement, preparedBy, (done, total) => setProgress({ done, total })), `${base}_with_documents.zip`);
    } catch (e: any) {
      setError(e?.message || 'Could not build the statement.');
    } finally {
      setBusy(''); setProgress(null);
    }
  };

  const empty = !!statement && statement.income.length === 0 && statement.expenses.length === 0;
  const btn = 'flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Monthly statement" className="bg-theme-card border border-theme-card-border rounded-3xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl">
        <div className="flex items-start justify-between border-b border-theme-border/20 pb-3">
          <div>
            <h2 className="text-base font-bold text-theme-text-primary flex items-center gap-2"><FileBarChart className="h-5 w-5 text-accent-strong dark:text-accent-soft" /> Monthly Statement</h2>
            <p className="text-xs text-theme-text-secondary">Income &amp; expenditure for a month, with every linked document.</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => !busy && onClose()} className="p-1.5 hover:bg-white/10 rounded-lg text-theme-text-secondary cursor-pointer"><X className="h-5 w-5" /></button>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-semibold text-theme-text-secondary">Month</span>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-full px-3.5 py-2.5 bg-theme-sidebar/60 border border-theme-border/40 rounded-xl text-xs text-theme-text-primary outline-none focus:border-accent" />
        </label>

        {statement && (
          <div className="space-y-3" aria-live="polite">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-xl border border-theme-border/30 p-3"><div className="text-theme-text-secondary">Income ({statement.income.length})</div><div className="mt-1 font-bold text-sm text-emerald-700 dark:text-emerald-300">{inr(statement.totalIncome)}</div></div>
              <div className="rounded-xl border border-theme-border/30 p-3"><div className="text-theme-text-secondary">Expenditure ({statement.expenses.length})</div><div className="mt-1 font-bold text-sm text-theme-text-primary">{inr(statement.totalExpense)}</div></div>
              <div className="rounded-xl border border-theme-border/30 p-3"><div className="text-theme-text-secondary">{statement.net >= 0 ? 'Surplus' : 'Deficit'}</div><div className={`mt-1 font-bold text-sm ${statement.net >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-danger dark:text-danger-soft'}`}>{inr(Math.abs(statement.net))}</div></div>
            </div>
            <p className="text-xs text-theme-text-secondary">
              {statement.monthLabel} · FY {statement.financialYear} · FY-to-date: income {inr(statement.fytdIncome)}, expenditure {inr(statement.fytdExpense)}.
              {' '}{statement.files.length} linked document{statement.files.length === 1 ? '' : 's'} (IDNs, bills, payment proofs).
            </p>
            {empty && <p className="text-xs text-amber-700 dark:text-amber-300">Nothing was recorded in {statement.monthLabel}.</p>}
          </div>
        )}

        {progress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-theme-text-secondary"><span>Collecting linked files…</span><span>{progress.done}/{progress.total}</span></div>
            <div className="h-1.5 rounded-full bg-theme-border/30 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} /></div>
          </div>
        )}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}

        <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
          <button type="button" disabled={!statement || !!busy} onClick={() => run('pdf')} className={`${btn} border border-theme-border/40 text-theme-text-primary hover:bg-white/5`}>
            {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Statement PDF
          </button>
          <button type="button" disabled={!statement || !!busy} onClick={() => run('csv')} className={`${btn} border border-theme-border/40 text-theme-text-primary hover:bg-white/5`}>
            {busy === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Statement CSV
          </button>
          <button type="button" disabled={!statement || !!busy || empty} onClick={() => run('zip')} className={`${btn} sm:col-span-2 bg-accent hover:bg-primary-light text-white shadow-md shadow-accent/20`}>
            {busy === 'zip' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />} Download ZIP — statement + linked files
          </button>
        </div>
      </div>
    </div>
  );
}
