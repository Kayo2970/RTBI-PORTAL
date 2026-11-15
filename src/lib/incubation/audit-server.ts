import { mutateCollection } from '../server-db';

/** Server-side audit entry (same shape/cap as the other server writers of `auditLogs`). */
export async function incubationAudit(actor: { name?: string; email?: string }, action: string, target: string, details: string): Promise<void> {
  try {
    await mutateCollection('auditLogs', (cur: any[]) => [
      {
        id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        action,
        actorName: actor.name || 'Unknown',
        actorEmail: actor.email || '',
        target,
        details,
        timestamp: new Date().toISOString(),
      },
      ...cur,
    ].slice(0, 1000));
  } catch (e) {
    console.error('[incubation-audit] failed to write audit log', e);
  }
}
