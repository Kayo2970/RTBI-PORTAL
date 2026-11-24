import { readCollection } from '../server-db';
import { canManageStartupsServer } from '../permissions-server';
import type { Application } from './types';

/** Keys of the application that identify or describe the applicant — hidden from an evaluator until their COI gate is passed. */
const GATED_KEYS: (keyof Application)[] = ['sections', 'files', 'applicantEmail', 'applicantName', 'declaration', 'missingDocs', 'screening'];

export function nextApplicationId(existing: string[], now = new Date()): string {
  const prefix = `RTBI-APP-${now.getFullYear()}-`;
  const max = existing.filter(i => i.startsWith(prefix)).map(i => parseInt(i.slice(prefix.length), 10)).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export interface AppViewer { isManager: boolean; assigned: boolean; coi?: 'participate' | 'recuse'; ownScoreSubmitted: boolean }

export function viewerFor(app: Application, actor: any, isManager: boolean): AppViewer {
  const assigned = (app.assigned || []).some(a => a.memberId === actor.id);
  const coi = app.coi?.find(c => c.memberId === actor.id)?.action;
  return { isManager, assigned, coi, ownScoreSubmitted: (app.scorecards || []).some(s => s.memberId === actor.id) };
}

/**
 * What this actor may see of an application:
 *  - managers: everything (submitted scorecards included)
 *  - assigned evaluators: nothing identifying until they have filed a COI declaration and chosen to participate (hard gate);
 *    then the application, their own scorecard, and peers' scorecards only after they have submitted their own;
 *  - everyone else: nothing.
 */
export function viewApplication(app: Application, actor: any, isManager: boolean): (Partial<Application> & { viewer: AppViewer; gated?: boolean }) | null {
  const viewer = viewerFor(app, actor, isManager);
  if (isManager) return { ...app, viewer };
  if (!viewer.assigned) return null;
  if (viewer.coi !== 'participate') {
    const stub: any = { ...app, viewer, gated: true, scorecards: [] };
    for (const k of GATED_KEYS) delete stub[k];
    delete stub.decision; delete stub.log; delete stub.coi;
    stub.coi = (app.coi || []).filter(c => c.memberId === actor.id);
    return stub;
  }
  const scorecards = (app.scorecards || []).filter(s => s.memberId === actor.id || viewer.ownScoreSubmitted);
  const { decision: _d, ...rest } = app;
  // Until the decision is final, evaluators must not learn it from the activity log either.
  const log = app.decision?.finalisedAt ? app.log : (app.log || []).filter(l => !/^Decision (recorded|rejected|finalised)/i.test(l.action) && !/^Further information required \(approved\)/.test(l.action));
  return { ...rest, log, scorecards, viewer, ...(app.decision?.finalisedAt ? { decision: app.decision } : {}) };
}

export async function loadApplications(): Promise<Application[]> {
  return readCollection<Application>('applications');
}

export async function isManagerActor(actor: any): Promise<boolean> {
  return canManageStartupsServer(actor);
}
