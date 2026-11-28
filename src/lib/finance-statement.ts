/**
 * finance-statement.ts — monthly Statement of Income & Expenditure for the Finance module.
 *
 * `buildStatement` is pure: it picks the month's expenses (by bill date) and income (by received date), totals them,
 * summarises by head against the annual allocation, and lists every linked document (bills, IDNs, invoice payment proofs).
 * The exporters (CSV, PDF, ZIP with the linked files) are client-only.
 */
import { EXPENSE_HEADS, getExpenseHeadLabel, getFinancialYearForDate, type ExpenseItem, type InvoiceItem } from './finance';
import type { IncomeSourceItem, ReceiptFile } from './local-data';
import { toCsvRow } from './csv';

export interface LinkedFile {
  /** Folder inside the ZIP, e.g. "Expenses/EXP-…" */
  group: string;
  /** Label shown in the statement, e.g. "IDN 1", "Bill 2", "Payment proof 1" */
  label: string;
  file: ReceiptFile;
}

export interface StatementExpense {
  id: string;
  date: string;
  headKey: string;
  head: string;
  description: string;
  vendor: string;
  event: string;
  submittedBy: string;
  amount: number;
  files: LinkedFile[];
}

export interface StatementIncome {
  id: string;
  date: string;
  type: string;
  title: string;
  reference: string;
  amount: number;
  files: LinkedFile[];
}

export interface StatementHeadRow {
  head: string;
  month: number;
  fytd: number;
  allocation: number;
}

export interface Statement {
  month: string; // YYYY-MM
  monthLabel: string; // "November 2026"
  financialYear: string;
  income: StatementIncome[];
  expenses: StatementExpense[];
  heads: StatementHeadRow[];
  totalIncome: number;
  totalExpense: number;
  net: number;
  /** Financial-year-to-date totals up to the end of the month. */
  fytdIncome: number;
  fytdExpense: number;
  annualBudget: number;
  files: LinkedFile[];
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const INCOME_TYPE_LABEL: Record<string, string> = { sponsor: 'Sponsorship', grant: 'Grant', donation: 'Donation', other: 'Other Income' };

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const safe = (s: string, max = 40) => (s || '').replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, max) || 'item';
const incomeDate = (i: IncomeSourceItem) => (i.receivedDate || i.createdAt || '').slice(0, 10);

export function buildStatement(
  month: string,
  expenses: ExpenseItem[],
  income: IncomeSourceItem[],
  invoices: InvoiceItem[],
  allocations: Partial<Record<string, number>> | undefined,
  annualBudget: number,
): Statement {
  const fy = getFinancialYearForDate(`${month}-01`);
  const fyStart = `${fy.split('-')[0]}-04-01`;
  const monthEnd = `${month}-31`; // lexicographic upper bound for any day of the month
  const inMonth = (d: string) => d.startsWith(month);
  const inFyToMonthEnd = (d: string) => d >= fyStart && d <= monthEnd;

  const exp = expenses.filter(e => inMonth(e.expenseDate)).sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.id.localeCompare(b.id));
  const inc = income.filter(i => inMonth(incomeDate(i))).sort((a, b) => incomeDate(a).localeCompare(incomeDate(b)));

  const expenseRows: StatementExpense[] = exp.map(e => {
    const group = `Expenses/${e.expenseDate}_${safe(e.id, 24)}_${safe(e.description, 28)}`;
    const files: LinkedFile[] = [
      ...(e.idnFiles || []).map((file, i) => ({ group, label: `IDN ${i + 1}`, file })),
      ...(e.billFiles || []).map((file, i) => ({ group, label: `Bill ${i + 1}`, file })),
    ];
    return {
      id: e.id, date: e.expenseDate, headKey: e.head, head: getExpenseHeadLabel(e.head), description: e.description,
      vendor: e.vendor || '', event: e.eventName || '', submittedBy: e.submittedBy, amount: e.amount, files,
    };
  });

  const incomeRows: StatementIncome[] = inc.map(i => {
    const inv = i.invoiceId ? invoices.find(x => x.id === i.invoiceId) : undefined;
    const group = `Income/${incomeDate(i)}_${safe(i.invoiceNumber || i.name, 32)}`;
    const files: LinkedFile[] = (inv?.payment?.proofFiles || []).map((file, idx) => ({ group, label: `Payment proof ${idx + 1}`, file }));
    return {
      id: i.id,
      date: incomeDate(i),
      type: INCOME_TYPE_LABEL[i.type || 'other'] || 'Other Income',
      title: i.source === 'invoice' ? `Invoice ${i.invoiceNumber} — ${i.clientName}` : i.name,
      reference: i.source === 'invoice' ? [i.paymentMode, i.paymentReference].filter(Boolean).join(' · ') : (i.notes || ''),
      amount: i.amount,
      files,
    };
  });

  const fytdExp = expenses.filter(e => inFyToMonthEnd(e.expenseDate));
  const heads: StatementHeadRow[] = EXPENSE_HEADS.map(h => ({
    head: h.label,
    month: r2(exp.filter(e => e.head === h.key).reduce((s, e) => s + e.amount, 0)),
    fytd: r2(fytdExp.filter(e => e.head === h.key).reduce((s, e) => s + e.amount, 0)),
    allocation: Number(allocations?.[h.key]) || 0,
  }));

  const totalIncome = r2(incomeRows.reduce((s, i) => s + i.amount, 0));
  const totalExpense = r2(expenseRows.reduce((s, e) => s + e.amount, 0));
  return {
    month, monthLabel: monthLabel(month), financialYear: fy,
    income: incomeRows, expenses: expenseRows, heads,
    totalIncome, totalExpense, net: r2(totalIncome - totalExpense),
    fytdIncome: r2(income.filter(i => inFyToMonthEnd(incomeDate(i))).reduce((s, i) => s + i.amount, 0)),
    fytdExpense: r2(fytdExp.reduce((s, e) => s + e.amount, 0)),
    annualBudget,
    files: [...expenseRows.flatMap(e => e.files), ...incomeRows.flatMap(i => i.files)],
  };
}

// ---------------------------------------------------------------- CSV

export function statementCsv(s: Statement): string {
  const rows: (string | number)[][] = [
    ['RTBI — Statement of Income & Expenditure'],
    ['Month', s.monthLabel],
    ['Financial Year', s.financialYear],
    [],
    ['SUMMARY'],
    ['Total income', s.totalIncome],
    ['Total expenditure', s.totalExpense],
    ['Net (income - expenditure)', s.net],
    ['FY-to-date income', s.fytdIncome],
    ['FY-to-date expenditure', s.fytdExpense],
    [],
    ['INCOME'],
    ['Date', 'Type', 'Particulars', 'Reference / notes', 'Amount (INR)', 'Linked documents'],
    ...s.income.map(i => [i.date, i.type, i.title, i.reference, i.amount, i.files.map(f => `${f.label}: ${f.file.name}`).join('; ')]),
    ['', '', '', 'Total income', s.totalIncome, ''],
    [],
    ['EXPENDITURE'],
    ['Date', 'Voucher', 'Head', 'Description', 'Vendor', 'Event', 'Booked by', 'Amount (INR)', 'Linked documents'],
    ...s.expenses.map(e => [e.date, e.id, e.head, e.description, e.vendor, e.event, e.submittedBy, e.amount, e.files.map(f => `${f.label}: ${f.file.name}`).join('; ')]),
    ['', '', '', '', '', '', 'Total expenditure', s.totalExpense, ''],
    [],
    ['HEAD-WISE SUMMARY'],
    ['Head', 'This month (INR)', 'FY to date (INR)', 'Annual allocation (INR)'],
    ...s.heads.map(h => [h.head, h.month, h.fytd, h.allocation || '']),
  ];
  return rows.map(r => toCsvRow(r)).join('\n');
}

// ---------------------------------------------------------------- PDF

/** jsPDF's built-in fonts have no ₹ glyph, so amounts are written "Rs. 1,23,456.00". */
const rs = (n: number) => 'Rs. ' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const pdfText = (s: string) => (s || '').replace(/₹\s?/g, 'Rs. ').replace(/[–—]/g, '-').replace(/[^\x20-\x7E -ÿ]/g, '');

export async function statementPdf(s: Statement, preparedBy: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297, M = 12;
  let y = 14;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('RTBI - Statement of Income & Expenditure', M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`Month: ${s.monthLabel}     Financial Year: ${s.financialYear}`, M, y + 6);
  doc.text(`Generated ${new Date().toLocaleDateString('en-IN')} by ${pdfText(preparedBy)}`, W - M, y + 6, { align: 'right' });
  y += 12;

  // Summary strip
  const boxes: [string, string][] = [
    ['Total income', rs(s.totalIncome)],
    ['Total expenditure', rs(s.totalExpense)],
    [s.net >= 0 ? 'Net surplus' : 'Net deficit', rs(Math.abs(s.net))],
    ['FY-to-date net', rs(s.fytdIncome - s.fytdExpense)],
  ];
  const bw = (W - 2 * M - 9) / 4;
  boxes.forEach(([label, value], i) => {
    const x = M + i * (bw + 3);
    doc.setDrawColor(190); doc.setFillColor(246, 244, 250); doc.roundedRect(x, y, bw, 14, 2, 2, 'FD');
    doc.setFontSize(8); doc.setTextColor(90); doc.text(label, x + 3, y + 5);
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(20); doc.text(value, x + 3, y + 11);
    doc.setFont('helvetica', 'normal');
  });
  y += 20;

  const head = { fillColor: [54, 28, 106] as [number, number, number], textColor: 255 as const, fontSize: 8.5 };
  const section = (title: string) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text(title, M, y); doc.setFont('helvetica', 'normal');
    y += 2;
  };
  const after = () => { y = ((doc as any).lastAutoTable?.finalY ?? y) + 8; };
  const docsCell = (files: LinkedFile[]) => files.map(f => `${f.label}: ${pdfText(f.file.name)}`).join('\n');

  section(`A. Income (${s.income.length})`);
  autoTable(doc, {
    startY: y + 1, margin: { left: M, right: M }, theme: 'grid', headStyles: head, styles: { fontSize: 8, cellPadding: 1.6 },
    head: [['Date', 'Type', 'Particulars', 'Reference / notes', 'Linked documents', 'Amount']],
    body: s.income.length ? s.income.map(i => [i.date, i.type, pdfText(i.title), pdfText(i.reference), docsCell(i.files) || '-', rs(i.amount)]) : [[{ content: 'No income recorded this month.', colSpan: 6, styles: { halign: 'center', textColor: 120 } }]],
    foot: [[{ content: 'Total income', colSpan: 5, styles: { halign: 'right' } }, rs(s.totalIncome)]],
    footStyles: { fillColor: [236, 253, 245], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 5: { halign: 'right', cellWidth: 32 }, 0: { cellWidth: 22 }, 1: { cellWidth: 26 } },
  } as any);
  after();

  section(`B. Expenditure (${s.expenses.length})`);
  autoTable(doc, {
    startY: y + 1, margin: { left: M, right: M }, theme: 'grid', headStyles: head, styles: { fontSize: 8, cellPadding: 1.6 },
    head: [['Date', 'Voucher', 'Head', 'Description', 'Vendor / event', 'Linked documents', 'Amount']],
    body: s.expenses.length
      ? s.expenses.map(e => [e.date, e.id, pdfText(e.head), pdfText(e.description), pdfText([e.vendor, e.event && `Event: ${e.event}`].filter(Boolean).join('\n')) || '-', docsCell(e.files) || 'No documents', rs(e.amount)])
      : [[{ content: 'No expenses recorded this month.', colSpan: 7, styles: { halign: 'center', textColor: 120 } }]],
    foot: [[{ content: 'Total expenditure', colSpan: 6, styles: { halign: 'right' } }, rs(s.totalExpense)]],
    footStyles: { fillColor: [254, 242, 242], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 6: { halign: 'right', cellWidth: 30 }, 0: { cellWidth: 21 }, 1: { cellWidth: 30 }, 2: { cellWidth: 34 } },
  } as any);
  after();

  section('C. Head-wise summary');
  autoTable(doc, {
    startY: y + 1, margin: { left: M, right: M }, theme: 'grid', headStyles: head, styles: { fontSize: 8, cellPadding: 1.6 },
    head: [['Head', 'This month', 'FY to date', 'Annual allocation', 'Balance']],
    body: s.heads.map(h => [pdfText(h.head), rs(h.month), rs(h.fytd), h.allocation ? rs(h.allocation) : '-', h.allocation ? rs(h.allocation - h.fytd) : '-']),
    foot: [['Total', rs(s.totalExpense), rs(s.fytdExpense), s.annualBudget ? rs(s.annualBudget) : '-', s.annualBudget ? rs(s.annualBudget - s.fytdExpense) : '-']],
    footStyles: { fillColor: [244, 241, 250], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  } as any);
  after();

  // Reconciliation line + sign-off
  if (y > 175) { doc.addPage(); y = 20; }
  doc.setFontSize(9); doc.setTextColor(40);
  doc.text(`Net for ${s.monthLabel}: income ${rs(s.totalIncome)} less expenditure ${rs(s.totalExpense)} = ${s.net >= 0 ? 'surplus' : 'deficit'} of ${rs(Math.abs(s.net))}.`, M, y);
  y += 18;
  doc.setDrawColor(120);
  ['Prepared by', 'Checked by (Finance)', 'Approved by (CEO)'].forEach((t, i) => {
    const x = M + i * 90;
    doc.line(x, y, x + 70, y); doc.text(t, x, y + 5);
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(130);
    doc.text(`RTBI Portal - ${s.monthLabel} statement - page ${p} of ${pages}`, W / 2, 204, { align: 'center' });
  }
  return doc.output('blob');
}

// ---------------------------------------------------------------- ZIP with linked files

async function fileBytes(f: ReceiptFile): Promise<Blob> {
  if (f.dataUrl) return (await fetch(f.dataUrl)).blob(); // legacy inline base64
  if (!f.url) throw new Error('no file reference');
  const res = await fetch(f.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/**
 * ZIP layout:  RTBI_Statement_<YYYY-MM>/ Statement.pdf, Statement.csv, Expenses/<voucher folders>/…, Income/<invoice folders>/…
 * Files that can't be fetched are listed in MISSING_FILES.txt instead of failing the whole download.
 */
export async function statementZip(s: Statement, preparedBy: string, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const root = zip.folder(`RTBI_Statement_${s.month}`)!;
  root.file(`Statement_${s.month}.pdf`, await statementPdf(s, preparedBy));
  root.file(`Statement_${s.month}.csv`, '﻿' + statementCsv(s));

  const missing: string[] = [];
  let done = 0;
  const total = s.files.length;
  onProgress?.(0, total);
  const used = new Set<string>();
  for (const lf of s.files) {
    const base = `${lf.label.replace(/\s+/g, '_')}__${safe(lf.file.name.replace(/^\d+__/, ''), 80)}`;
    let path = `${lf.group}/${base}`;
    for (let n = 2; used.has(path); n++) path = `${lf.group}/${n}_${base}`;
    used.add(path);
    try {
      root.file(path, await fileBytes(lf.file));
    } catch (e: any) {
      missing.push(`${lf.group} / ${lf.label} (${lf.file.name}): ${e?.message || 'could not be fetched'}`);
    }
    onProgress?.(++done, total);
  }
  if (missing.length) root.file('MISSING_FILES.txt', `These linked files could not be included:\n\n${missing.join('\n')}\n`);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
