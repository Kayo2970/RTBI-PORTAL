import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { computeInvoiceTotals, getFinancialYearForDate, type InvoiceItem, type InvoiceLine } from '@/lib/finance';

export async function GET(request: Request) {
  try {
    await requireSession(request);
    return NextResponse.json(await readCollection('invoices'));
  } catch (err: any) {
    return apiError(err, 'invoices-api-get', 500);
  }
}

/** Issue an invoice. Totals are recomputed here and the sequential number (INV-<FY start>-NNN) is assigned here. */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const body = await request.json();

    const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
    if (!clientName) throw new Error('Client name is required.');
    if (!body.issueDate || Number.isNaN(new Date(body.issueDate).getTime())) throw new Error('A valid invoice date is required.');

    const lineItems: InvoiceLine[] = (Array.isArray(body.lineItems) ? body.lineItems : [])
      .map((l: any) => ({ description: String(l?.description || '').trim(), quantity: Number(l?.quantity), rate: Number(l?.rate) }))
      .filter((l: InvoiceLine) => l.description);
    if (lineItems.length === 0) throw new Error('Add at least one line item.');
    for (const l of lineItems) {
      if (!Number.isFinite(l.quantity) || l.quantity <= 0 || !Number.isFinite(l.rate) || l.rate < 0) {
        throw new Error(`Line item "${l.description}" needs a positive quantity and a valid rate.`);
      }
    }
    const taxPercent = Number(body.taxPercent) || 0;
    if (taxPercent < 0 || taxPercent > 100) throw new Error('Tax must be between 0 and 100 percent.');
    const totals = computeInvoiceTotals(lineItems, taxPercent);
    if (totals.totalAmount <= 0) throw new Error('The invoice total must be greater than zero.');

    const financialYear = getFinancialYearForDate(body.issueDate);
    const fyStart = financialYear.split('-')[0];
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

    let created: InvoiceItem | null = null;
    await mutateCollection('invoices', (current: any[]) => {
      const prefix = `INV-${fyStart}-`;
      const maxSeq = current
        .map(i => (typeof i.invoiceNumber === 'string' && i.invoiceNumber.startsWith(prefix) ? parseInt(i.invoiceNumber.slice(prefix.length), 10) : 0))
        .reduce((m, n) => (Number.isFinite(n) && n > m ? n : m), 0);
      created = {
        id: 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        invoiceNumber: `${prefix}${String(maxSeq + 1).padStart(3, '0')}`,
        financialYear,
        clientName,
        clientEmail: str(body.clientEmail),
        clientAddress: str(body.clientAddress),
        clientGstin: str(body.clientGstin),
        issueDate: body.issueDate,
        dueDate: str(body.dueDate),
        lineItems,
        taxPercent,
        ...totals,
        notes: str(body.notes),
        status: 'Issued',
        createdBy: actor.name,
        createdByEmail: actor.email,
        createdAt: new Date().toISOString().split('T')[0],
      };
      return [created!, ...current];
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'invoices-api-post', 400);
  }
}
