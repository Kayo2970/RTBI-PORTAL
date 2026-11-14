import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canManageAnnualBudget } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { EXPENSE_HEADS, annualBudgetId, isExpenseHeadKey } from '@/lib/finance';

export async function GET(request: Request) {
  try {
    await requireSession(request);
    return NextResponse.json(await readCollection('annualBudgets'));
  } catch (err: any) {
    return apiError(err, 'annual-budgets-api-get', 500);
  }
}

/** Create or replace the single annual budget for a financial year (upsert by `ab_<FY>`). */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(canManageAnnualBudget(actor), 'Only the Super User or CEO can set the annual budget.');

    const body = await request.json();
    const fy = String(body.financialYear || '');
    if (!/^\d{4}-\d{4}$/.test(fy)) throw new Error('A valid financial year (e.g. 2026-2027) is required.');

    const total = Number(body.totalAmount);
    if (!Number.isFinite(total) || total <= 0) throw new Error('The annual budget must be a positive amount.');

    const allocations: Record<string, number> = {};
    let allocated = 0;
    for (const [key, raw] of Object.entries(body.allocations || {})) {
      if (!isExpenseHeadKey(key)) throw new Error(`Unknown budget head "${key}".`);
      const value = Number(raw) || 0;
      if (!Number.isFinite(value) || value < 0) throw new Error('Head allocations cannot be negative.');
      allocations[key] = value;
      allocated += value;
    }
    for (const h of EXPENSE_HEADS) allocations[h.key] = allocations[h.key] || 0;
    if (allocated > total + 0.005) {
      throw new Error(`The head-wise breakup (₹${allocated.toLocaleString('en-IN')}) exceeds the annual budget (₹${total.toLocaleString('en-IN')}).`);
    }

    const record = {
      id: annualBudgetId(fy),
      financialYear: fy,
      totalAmount: total,
      allocations,
      notes: typeof body.notes === 'string' ? body.notes.trim() || undefined : undefined,
      updatedBy: actor.name,
      updatedAt: new Date().toISOString().split('T')[0],
    };

    await mutateCollection('annualBudgets', (current) => [record, ...current.filter((b: any) => b.id !== record.id)]);
    return NextResponse.json(record, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'annual-budgets-api-post', 400);
  }
}
