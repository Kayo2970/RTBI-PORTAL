import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { saveBase64File } from '@/lib/file-storage';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { getFinancialYearForDate, isExpenseHeadKey } from '@/lib/finance';

export const maxDuration = 60;

const MAX_BILL_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_BILL_FILES = 5;

export async function GET(request: Request) {
  try {
    await requireSession(request);
    return NextResponse.json(await readCollection('expenses'));
  } catch (err: any) {
    return apiError(err, 'expenses-api-get', 500);
  }
}

/**
 * Book an expense. An expense is only accepted with a bill, a description and a
 * head — the submitter's identity always comes from the session, never the body.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const body = await request.json();

    if (!isExpenseHeadKey(body.head)) throw new Error('Select the head this expense falls under.');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid expense amount.');
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description) throw new Error('Describe what the expense was for.');
    const expenseDate = typeof body.expenseDate === 'string' ? body.expenseDate : '';
    if (!expenseDate || Number.isNaN(new Date(expenseDate).getTime())) throw new Error('Enter the date on the bill.');

    const files = Array.isArray(body.billFiles) ? body.billFiles : [];
    if (files.length === 0) throw new Error('Attach the bill for this expense.');
    if (files.length > MAX_BILL_FILES) throw new Error(`Maximum ${MAX_BILL_FILES} bill files allowed per expense.`);

    const id = 'exp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const billFiles = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (typeof f?.dataUrl !== 'string' || !f.dataUrl.startsWith('data:')) throw new Error('A bill file could not be read. Please re-attach it.');
      if (Math.floor((f.dataUrl.length * 3) / 4) > MAX_BILL_FILE_BYTES) throw new Error(`"${f.name || 'File'}" exceeds the 10 MB per-file limit.`);
      const stored = await saveBase64File('expenses', id, i, f.name || 'bill', f.dataUrl);
      billFiles.push({ name: f.name, url: stored.url, storageKey: stored.storageKey, type: f.type });
    }

    const expense = {
      id,
      financialYear: getFinancialYearForDate(expenseDate),
      head: body.head,
      amount,
      description,
      expenseDate,
      billFiles,
      vendor: typeof body.vendor === 'string' ? body.vendor.trim() || undefined : undefined,
      eventId: body.eventId || undefined,
      eventName: body.eventName || undefined,
      submittedBy: actor.name,
      submittedByEmail: actor.email,
      submittedAt: new Date().toISOString().split('T')[0],
    };

    await mutateCollection('expenses', (current) => [expense, ...current]);
    return NextResponse.json(expense, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'expenses-api-post', 400);
  }
}
