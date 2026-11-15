import { readCollection } from '../server-db';
import { loadSettings } from './records-server';
import { financialYearLabel } from './rules';
import { GRADUATED_OUTCOMES } from './kinds';
import type { Startup } from './types';

export interface KpiRow {
  key: string; label: string; annualTarget: number; fiveYearTarget: number;
  ytd: number; cumulative: number; variance: number; status: 'Met' | 'On track' | 'Behind';
  evidenced: number; /** startup IDs (never names) or record refs behind the count */ refs: string[]; evidenceRequired: string;
}
export interface KpiReport {
  fy: string; fyOptions: string[]; asOf: string; settingsStatus: string;
  rows: KpiRow[];
  clause84: { min: number; incubatedThisFy: number; met: boolean };
  funding: Record<'Applied' | 'Recommended' | 'Sanctioned' | 'Received', number>;
  shortfalls: string[];
}

/** FY label "FY2026-27" → [start, end] dates for a given FY start month. */
function fyRange(label: string, startMonth: number): [Date, Date] {
  const y = parseInt(label.replace('FY', '').slice(0, 4), 10);
  const start = new Date(y, startMonth - 1, 1);
  const end = new Date(y + 1, startMonth - 1, 0, 23, 59, 59);
  return [start, end];
}

export async function computeKpis(fyParam?: string, now = new Date()): Promise<KpiReport> {
  const settings = await loadSettings();
  const sm = settings.fiscalYearStartMonth;
  const fy = fyParam && /^FY\d{4}(-\d{2})?$/.test(fyParam) ? fyParam : financialYearLabel(now, sm);
  const [from, to] = fyRange(fy, sm);
  const programmeStart = settings.programmeStartDate ? new Date(settings.programmeStartDate) : new Date(0);
  const inFy = (d?: string | Date) => !!d && new Date(d) >= from && new Date(d) <= to;
  const sinceStart = (d?: string | Date) => !!d && new Date(d) >= programmeStart && new Date(d) <= to;

  const [startups, recs] = await Promise.all([readCollection<Startup>('startups'), readCollection<any>('incubationRecords')]);
  const unique = (xs: string[]) => Array.from(new Set(xs));
  const ev = (k: string) => recs.filter(r => r.kind === 'evidence' && r.kpiKey === k);
  const executed = new Set(recs.filter(r => r.kind === 'agreement' && r.state === 'Executed').map(r => r.startupId));
  const facilityDone = new Set(recs.filter(r => r.kind === 'onboarding' && r.items?.facility?.done).map(r => r.startupId));
  const finalGrad = recs.filter(r => (r.kind === 'graduation' && r.state === 'Final' && GRADUATED_OUTCOMES.includes(r.outcome))
    || (r.kind === 'renewal' && r.state === 'Final' && r.outcome === 'Graduation'));

  type Src = { id: string; date?: string; evidenced: boolean };
  const sources: Record<string, Src[]> = {
    // Each startup counts once — no double counting across years or records.
    incubated: startups.filter(s => s.activatedAt).map(s => ({ id: s.id, date: s.activatedAt, evidenced: executed.has(s.id) })),
    graduated: unique(finalGrad.map(r => r.startupId)).map(id => ({ id, date: finalGrad.find(r => r.startupId === id)?.reviewDate || finalGrad.find(r => r.startupId === id)?.updatedAt, evidenced: true })),
    // Patents count when FILED (acknowledgement/number), not when granted.
    patents: ev('patents').map(r => ({ id: r.docRef || r.id, date: r.evidenceDate, evidenced: true })),
    commercialised: ev('commercialised').map(r => ({ id: r.docRef || r.id, date: r.evidenceDate, evidenced: true })),
    premises: startups.filter(s => s.activatedAt && s.mode && s.mode !== 'Other').map(s => ({ id: s.id, date: s.activatedAt, evidenced: executed.has(s.id) || facilityDone.has(s.id) })),
    // Mentoring and other support are "support delivered" — never counted as commercial outcomes (those are the two rows above).
    support: [...ev('support').map(r => ({ id: r.docRef || r.id, date: r.evidenceDate, evidenced: true })), ...recs.filter(r => r.kind === 'mentorSession').map(r => ({ id: r.id, date: r.sessionDate, evidenced: !!r.summary }))],
    events: recs.filter(r => r.kind === 'programEvent' && r.status === 'Reported').map(r => ({ id: r.id, date: r.date, evidenced: !!r.reportEvidence })),
  };

  const monthsElapsed = Math.min(12, Math.max(0, (Math.min(now.getTime(), to.getTime()) - from.getTime()) / (30.44 * 86_400_000)));
  const rows: KpiRow[] = settings.kpis.targets.map(t => {
    const src = sources[t.key] || [];
    const ytdSrc = src.filter(s => inFy(s.date));
    const cum = unique(src.filter(s => sinceStart(s.date)).map(s => s.id));
    const ytdIds = unique(ytdSrc.map(s => s.id));
    const ytd = ytdIds.length;
    const expected = (t.annual * monthsElapsed) / 12;
    return { key: t.key, label: t.label, annualTarget: t.annual, fiveYearTarget: t.fiveYear, ytd, cumulative: cum.length, variance: ytd - t.annual,
      status: ytd >= t.annual ? 'Met' : ytd >= expected ? 'On track' : 'Behind', evidenced: ytdSrc.filter(s => s.evidenced).length, refs: ytdIds, evidenceRequired: t.evidence };
  });

  const funding = { Applied: 0, Recommended: 0, Sanctioned: 0, Received: 0 };
  for (const r of ev('funding')) if (inFy(r.evidenceDate) && r.fundingStage in funding) funding[r.fundingStage as keyof typeof funding] += Number(r.amount) || 0;

  const incubated = rows.find(r => r.key === 'incubated');
  const years = unique([financialYearLabel(now, sm), ...startups.filter(s => s.activatedAt).map(s => financialYearLabel(new Date(s.activatedAt!), sm))]).sort().reverse();
  return {
    fy, fyOptions: years, asOf: now.toISOString(), settingsStatus: settings.kpis.status, rows,
    clause84: { min: settings.kpis.clause84MinStartupsPerFy, incubatedThisFy: incubated?.ytd ?? 0, met: (incubated?.ytd ?? 0) >= settings.kpis.clause84MinStartupsPerFy },
    funding, shortfalls: rows.filter(r => r.status === 'Behind').map(r => r.label),
  };
}
