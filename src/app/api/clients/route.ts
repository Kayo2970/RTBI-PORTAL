import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import type { ClientRecord } from '@/lib/finance';

export async function GET(request: Request) {
  try {
    await requireSession(request);
    return NextResponse.json(await readCollection('clients'));
  } catch (err: any) {
    return apiError(err, 'clients-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession(request);
    const body = await request.json();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new Error('Client or Startup name is required.');

    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

    let saved: ClientRecord | null = null;
    await mutateCollection('clients', (current: any[] = []) => {
      const matchIdx = current.findIndex(c =>
        (body.id && c.id === body.id) ||
        (c.name && c.name.trim().toLowerCase() === name.toLowerCase())
      );
      const existing = matchIdx >= 0 ? current[matchIdx] : null;

      saved = {
        id: existing?.id || body.id || 'cli_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name,
        email: str(body.email) ?? existing?.email,
        address: str(body.address) ?? existing?.address,
        gstin: str(body.gstin) ?? existing?.gstin,
        isStartup: Boolean(body.isStartup ?? existing?.isStartup),
        startupName: str(body.startupName) ?? existing?.startupName,
        founderName: str(body.founderName) ?? existing?.founderName,
        phone: str(body.phone) ?? existing?.phone,
        notes: str(body.notes) ?? existing?.notes,
        defaultTaxPercent: Number(body.defaultTaxPercent) || existing?.defaultTaxPercent || 18,
        lastBilledAt: str(body.lastBilledAt) ?? existing?.lastBilledAt,
        totalBilled: Number(body.totalBilled) || existing?.totalBilled || 0,
        invoiceCount: Number(body.invoiceCount) || existing?.invoiceCount || 0,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (matchIdx >= 0) {
        current[matchIdx] = saved;
        return [...current];
      }
      return [saved, ...current];
    });

    return NextResponse.json(saved, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'clients-api-post', 400);
  }
}
