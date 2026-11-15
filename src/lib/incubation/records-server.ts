import { readCollection, mutateCollection } from '../server-db';
import { saveBase64File } from '../file-storage';
import { canManageStartupsServer, isInternalStaff } from '../permissions-server';
import { defaultIncubationSettings } from './defaults';
import { visibleStartupsFor } from './startups-server';
import { KINDS, kindFields, type KindDef, type FieldDef } from './kinds';
import type { IncubationSettings, Startup } from './types';

export const MAX_RECORD_FILE_BYTES = 10 * 1024 * 1024;

export async function loadSettings(): Promise<IncubationSettings> {
  const rows = await readCollection<any>('incubationSettings');
  return (rows.find(r => r.id === 'default') as IncubationSettings | undefined) ?? defaultIncubationSettings();
}

/** Is this actor allowed to read the record? Applies per-kind visibility + startup-tier scoping + restricted flags. */
export async function canReadRecord(def: KindDef, rec: any, actor: any, ownStartupIds: Set<string>, isManager: boolean): Promise<boolean> {
  if (def.restricted) return isManager || rec.createdBy === actor.id;
  if (rec.kind === 'evidence' && rec.restricted && !isManager) return false;
  if (isInternalStaff(actor)) return true;
  if (!def.startupCanRead) return false;
  if (def.startupScoped) return !!rec.startupId && ownStartupIds.has(rec.startupId);
  return true; // e.g. cohorts
}

export async function readableRecords(kind: string, actor: any): Promise<any[]> {
  const def = KINDS[kind];
  const [all, isManager] = await Promise.all([readCollection<any>('incubationRecords'), canManageStartupsServer(actor)]);
  const own = new Set((await visibleStartupsFor(actor)).map(s => s.id));
  const rows = all.filter(r => r.kind === kind);
  const out: any[] = [];
  for (const r of rows) if (await canReadRecord(def, r, actor, own, isManager)) out.push(r);
  return out;
}

export async function canWriteKind(def: KindDef, actor: any): Promise<boolean> {
  return def.write === 'managers' ? canManageStartupsServer(actor) : isInternalStaff(actor);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Coerces and checks one submitted field; returns [value, error]. */
async function coerce(f: FieldDef, raw: any, ctx: { startupIds: Set<string>; memberIds: Set<string>; recordKeys: Set<string> }): Promise<[any, string | null]> {
  const empty = raw === undefined || raw === null || raw === '' || (f.type === 'checkbox' && raw === false && !f.required);
  if (f.type === 'checkbox') return [!!raw, f.required && !raw ? `"${f.label}" is required.` : null];
  if (empty) return [undefined, f.required ? `"${f.label}" is required.` : null];
  switch (f.type) {
    case 'text': case 'textarea': return [String(raw).trim().slice(0, f.type === 'textarea' ? 5000 : 300), null];
    case 'select': return f.options?.includes(String(raw)) ? [String(raw), null] : [undefined, `"${f.label}": choose one of the listed options.`];
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) return [undefined, `"${f.label}" must be a number${f.min !== undefined ? ` from ${f.min}` : ''}${f.max !== undefined ? ` to ${f.max}` : ''}.`];
      return [n, null];
    }
    case 'date': return ISO_DATE.test(String(raw)) ? [String(raw), null] : [undefined, `"${f.label}" must be a date.`];
    case 'startup': return ctx.startupIds.has(String(raw)) ? [String(raw), null] : [undefined, `"${f.label}": unknown startup.`];
    case 'member': return ctx.memberIds.has(String(raw)) ? [String(raw), null] : [undefined, `"${f.label}": unknown member.`];
    case 'record': return ctx.recordKeys.has(`${f.refKind}:${String(raw)}`) ? [String(raw), null] : [undefined, `"${f.label}": unknown ${f.refKind} record.`];
    case 'file': return [raw, null]; // handled by the caller
  }
}

export interface SaveInput { def: KindDef; body: any; existing?: any; actor: any; isManager: boolean }

/** Validates + builds the next version of a record (without persisting). */
export async function buildRecord({ def, body, existing, actor, isManager }: SaveInput): Promise<{ rec?: any; error?: string; changes?: { field: string; from: unknown; to: unknown }[] }> {
  const settings = await loadSettings();
  const fields = kindFields(def, settings);
  const [startups, members, all] = await Promise.all([readCollection<Startup>('startups'), readCollection<any>('members'), readCollection<any>('incubationRecords')]);
  const ctxIds = { startupIds: new Set(startups.map(s => s.id)), memberIds: new Set(members.filter(m => m.status !== 'Terminated').map(m => m.id)), recordKeys: new Set(all.map(r => `${r.kind}:${r.id}`)) };

  const next: any = existing ? { ...existing } : { kind: def.kind };
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const id = existing?.id ?? `${def.kind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  let fileIdx = 0;
  for (const f of fields) {
    if (existing && body[f.key] === undefined) continue; // PATCH: untouched
    if (f.managerOnly && !isManager) continue; // silently kept as-is
    if (f.type === 'file') {
      const v = body[f.key];
      if (v && typeof v === 'object' && typeof v.dataUrl === 'string') {
        if (!v.dataUrl.startsWith('data:')) return { error: 'Invalid attachment.' };
        if (Math.floor((v.dataUrl.length * 3) / 4) > MAX_RECORD_FILE_BYTES) return { error: `"${v.name || 'File'}" exceeds the 10 MB limit.` };
        const stored = await saveBase64File('incubation', id, fileIdx++, String(v.name || 'file'), v.dataUrl);
        const file = { name: String(v.name || 'file'), url: stored.url, storageKey: stored.storageKey, type: typeof v.type === 'string' ? v.type : undefined };
        if (JSON.stringify(existing?.[f.key]) !== JSON.stringify(file)) changes.push({ field: f.key, from: existing?.[f.key]?.name, to: file.name });
        next[f.key] = file;
      }
      continue;
    }
    const [val, err] = await coerce(f, body[f.key], ctxIds);
    if (err) return { error: err };
    if (existing && JSON.stringify(existing[f.key]) !== JSON.stringify(val)) changes.push({ field: f.key, from: existing[f.key], to: val });
    if (val === undefined) delete next[f.key]; else next[f.key] = val;
  }
  // Required fields that are still missing on create (e.g. required file-less fields).
  for (const f of fields) if (f.required && f.type !== 'checkbox' && f.type !== 'file' && next[f.key] === undefined) return { error: `"${f.label}" is required.` };

  const siblings = all.filter(r => r.kind === def.kind && r.id !== id && (!def.startupScoped || r.startupId === next.startupId));
  const ctx = { settings, actorIsManager: isManager, actorId: actor.id, siblings, startup: startups.find(s => s.id === next.startupId), now: new Date() };
  const derived = def.derive ? def.derive(next, ctx) : next;
  const verr = def.validate ? def.validate(derived, ctx) : null;
  if (verr) return { error: verr };

  const now = new Date().toISOString();
  const rec = existing
    ? { ...derived, updatedAt: now, changeLog: [...(existing.changeLog || []), ...changes.map(c => ({ ...c, at: now, by: actor.id }))] }
    : { ...derived, id, kind: def.kind, createdAt: now, createdBy: actor.id, updatedAt: now, changeLog: [] };
  return { rec, changes };
}

/**
 * Explicit, approved decisions may move a startup's status. Nothing here is driven by RAG: a Red status never changes it.
 */
export async function applyStartupStatusEffects(rec: any): Promise<void> {
  if (!rec.startupId) return;
  const settings = await loadSettings();
  let status: Startup['status'] | null = null;
  if (rec.kind === 'graduation' && rec.finalised && rec.approvalRef?.trim() && settings.graduation.status === 'approved') {
    if (['Graduate', 'Early graduation'].includes(rec.outcome)) status = 'Graduated';
    if (rec.outcome === 'Non-renewal/exit') status = 'Exited';
  }
  if (rec.kind === 'renewal' && rec.finalised && rec.approvalRef?.trim()) {
    if (rec.outcome === 'Graduation') status = 'Graduated';
    if (['Non-renewal', 'Proposed termination'].includes(rec.outcome)) status = 'Exited';
  }
  if (rec.kind === 'exit' && rec.closed) status = 'Exited';
  if (!status) return;
  await mutateCollection<Startup>('startups', cur => cur.map(s => (s.id === rec.startupId && s.status !== status
    ? { ...s, status: status!, updatedAt: new Date().toISOString(), changeLog: [...(s.changeLog || []), { at: new Date().toISOString(), by: rec.updatedBy || rec.createdBy, field: 'status', from: s.status, to: status }] }
    : s)));
}
