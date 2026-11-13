import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canManageBilling } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { bad, str, num, cleanLines, createInvoice } from '@/lib/billing-server';
import type { Invoice } from '@/lib/billing';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const all = await readCollection<Invoice>('invoices');
    const rows = canManageBilling(actor) ? all : all.filter(i => i.customerId === actor.id);
    return NextResponse.json(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  } catch (err) {
    return apiError(err, 'invoices-get');
  }
}

/** Staff create an invoice: pick a member (or type a customer), list the due items with their breakup, and the number is assigned automatically. */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(canManageBilling(actor), 'Only Super User, CEO and Employees can raise invoices.');
    const b = await request.json();

    let customerName = str(b.customerName, 120);
    let customerEmail = str(b.customerEmail, 160);
    let customerOrganisation = str(b.customerOrganisation, 120);
    let customerId: string | undefined;
    if (b.customerId) {
      const member = (await readCollection<any>('members')).find(m => m.id === b.customerId);
      if (!member) bad('Selected member was not found.');
      customerId = member.id;
      customerName = member.name;
      customerEmail = member.email;
      customerOrganisation = customerOrganisation || member.organisation || member.company || '';
    }
    if (!customerName) bad('Choose a member or enter the customer name.');

    const inv = await createInvoice(
      {
        customerId, customerName, customerEmail, customerOrganisation,
        issueDate: b.issueDate, dueDate: b.dueDate,
        lines: cleanLines(b.lines),
        discount: num(b.discount),
        notes: str(b.notes, 1000),
        source: 'Manual',
      },
      { id: actor.id, name: actor.name }
    );
    return NextResponse.json(inv, { status: 201 });
  } catch (err) {
    return apiError(err, 'invoices-post', 400);
  }
}
