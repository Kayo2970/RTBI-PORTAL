import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { requireSession, ForbiddenError } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { isInternalStaff } from '@/lib/permissions-server';
import { incubationAudit } from '@/lib/incubation/audit-server';
import type { Startup } from '@/lib/incubation/types';

const WITHHELD = '[withheld — no consent]';

/**
 * Evidence index export for external reporting (e.g. KITS). Consent is applied here, on the server:
 *  - a startup is named only when its record says external disclosure is consented — otherwise its ID only;
 *  - a document link is included only when BOTH the startup (external disclosure) and the evidence record carry consent;
 *  - restricted evidence is never exported.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!isInternalStaff(actor)) throw new ForbiddenError('The evidence export is for RTBI staff only.');
    const [recs, startups, members] = await Promise.all([readCollection<any>('incubationRecords'), readCollection<Startup>('startups'), readCollection<any>('members')]);
    const origin = new URL(request.url).origin;
    const person = (id?: string) => members.find(m => m.id === id)?.name || id || '';
    const rows = recs.filter(r => r.kind === 'evidence' && !r.restricted).map(r => {
      const s = startups.find(x => x.id === r.startupId);
      const startupOk = !s || s.consent?.externalDisclosure === true;
      const linkOk = r.consent === true && startupOk;
      return {
        id: r.id, kpi: r.kpiKey, title: r.title, docRef: r.docRef || '', date: r.evidenceDate || '',
        startup: s ? (startupOk ? `${s.id} — ${s.name}` : s.id) : '',
        responsible: person(r.responsibleId), verifier: person(r.verifierId),
        fundingStage: r.fundingStage || '', amount: r.amount ?? '',
        documentLink: r.file?.url ? (linkOk ? origin + r.file.url : WITHHELD) : '',
      };
    });
    await incubationAudit(actor, 'EVIDENCE_EXPORTED', 'evidence', `Exported ${rows.length} evidence rows.`);
    return NextResponse.json({ rows, generatedAt: new Date().toISOString() });
  } catch (err) {
    return apiError(err, 'incubation-evidence-export', 500);
  }
}
