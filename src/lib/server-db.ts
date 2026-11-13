/**
 * server-db.ts — Shared server-side file-based database helper.
 *
 * Each collection lives in its own file under data/ (data/members.json,
 * data/events.json, ...) rather than one shared database.json — a write to
 * one collection no longer requires reading and rewriting every other
 * collection, and unrelated collections never block each other's writes
 * (each has its own async mutex). The files stay "interconnected" the same
 * way real relational tables do: by referencing each other's ids (tasks
 * reference eventId/assigneeId, ratings reference targetId, reimbursements
 * reference eventId, etc.) — the connections are in the data, not in a
 * shared physical file.
 *
 * A one-time, idempotent migration splits any pre-existing single-file
 * data/database.json into these per-collection files on first read after
 * upgrading, and retires (never deletes) the old file to data/database.json.migrated
 * as a safety net.
 */
import fs from 'fs/promises';
import path from 'path';
import { deleteStoredFile, saveBase64File } from './file-storage';
import { encryptData, decryptData, isEncryptedPayload } from './encryption';
import {
  initialEvents,
  initialTasks,
  initialRatings,
  initialReimbursements,
  initialAnnouncements,
  initialForms,
  initialFormTemplates,
  initialSubmissions,
  initialDesigns,
  initialGroupPolicies,
  initialAccessLevelSettings,
  initialSystemSettings,
  initialGuests,
  initialBudgets,
  initialIncomeSources,
  initialProcurementRequests,
  FEEDBACK_FORM_TEMPLATE_ID,
  isFacultyMember,
  isSocialMediaTeamMember,
  isSocialMediaPostTask,
} from './local-data';

const DATA_DIR = path.join(process.cwd(), 'data');
const LEGACY_DB_PATH = path.join(DATA_DIR, 'database.json');
const RETIRED_LEGACY_DB_PATH = path.join(DATA_DIR, 'database.json.migrated');
const META_PATH = path.join(DATA_DIR, '_meta.json');

export interface DbSchema {
  members: any[];
  events: any[];
  tasks: any[];
  ratings: any[];
  reimbursements: any[];
  announcements: any[];
  proposals: any[];
  forms: any[];
  formTemplates: any[];
  submissions: any[];
  designs: any[];
  groupPolicies: any[];
  accessLevelSettings: any[];
  systemSettings: any[];
  auditLogs: any[];
  emails: any[];
  passwordResets: any[];
  emailChanges: any[];
  accountActivations: any[];
  emailSettings: any[];
  guests: any[];
  budgets: any[];
  incomeSources: any[];
  eventReports: any[];
  event_passes: any[];
  certificates: any[];
  certificateSchedules: any[];
  passEmailSchedules: any[];
  approvalRequests: any[];
  procurementRequests: any[];
  // One row per (memberId, date) a birthday email was actually sent for —
  // see src/lib/birthday-scheduler.ts. Purely an idempotency guard so a
  // PM2 restart near midnight (or two scheduler ticks landing on the same
  // day) can never double-send the same member's birthday email.
  birthdayEmailLog: any[];
  // Server-side auth sessions — one row per issued login token (see
  // src/lib/session.ts). Only the SHA-256 hash of the token is stored, never
  // the token itself, so a leaked/backed-up sessions.json can't be replayed
  // directly. This is what makes "sign out" and "revoke this device" real:
  // deleting a row here invalidates that token immediately, server-side.
  sessions: any[];
  // Single-row collection (one document, id 'default') holding Apple/Google
  // Wallet issuer credentials for the Digital Visiting Card feature — see
  // src/lib/wallet/*-config.ts. Stored here (encrypted at rest, same as
  // emailSettings' SMTP password) rather than only in env vars so a Super
  // User can paste them in from Settings without a redeploy.
  walletSettings: any[];
  // Bookings / billing / inventory modules — see src/lib/billing.ts for the row shapes.
  rooms: any[];
  bookings: any[];
  invoices: any[];
  payments: any[];
  billingSettings: any[];
  inventoryItems: any[];
  inventoryMovements: any[];
  lastUpdated?: string;
}

const EMPTY_DB: DbSchema = {
  members: [],
  events: [],
  tasks: [],
  ratings: [],
  reimbursements: [],
  announcements: [],
  proposals: [],
  forms: [],
  formTemplates: [],
  submissions: [],
  designs: [],
  groupPolicies: [],
  accessLevelSettings: [],
  systemSettings: [],
  auditLogs: [],
  emails: [],
  passwordResets: [],
  emailChanges: [],
  accountActivations: [],
  emailSettings: [],
  guests: [],
  budgets: [],
  incomeSources: [],
  eventReports: [],
  event_passes: [],
  certificates: [],
  certificateSchedules: [],
  passEmailSchedules: [],
  approvalRequests: [],
  procurementRequests: [],
  birthdayEmailLog: [],
  sessions: [],
  walletSettings: [],
  rooms: [],
  bookings: [],
  invoices: [],
  payments: [],
  billingSettings: [],
  inventoryItems: [],
  inventoryMovements: [],
};

const SEED_DB: DbSchema = {
  // Deliberately NOT seeded from local-data.ts's initialMembers — that fake
  // faculty roster shared one known default password across every account.
  // A fresh deploy now starts with zero members; run `npm run setup`
  // (scripts/setup-superuser.mjs) once before first start to create the one
  // real Super User account interactively (email + a password you choose).
  // Everyone else gets added through the app afterward.
  members: [],
  events: initialEvents,
  tasks: initialTasks,
  ratings: initialRatings,
  reimbursements: initialReimbursements,
  announcements: initialAnnouncements,
  proposals: [],
  forms: initialForms,
  formTemplates: initialFormTemplates,
  submissions: initialSubmissions,
  designs: initialDesigns,
  groupPolicies: initialGroupPolicies,
  accessLevelSettings: initialAccessLevelSettings,
  systemSettings: initialSystemSettings,
  auditLogs: [],
  emails: [],
  passwordResets: [],
  emailChanges: [],
  accountActivations: [],
  emailSettings: [
    {
      id: 'default',
      provider: 'gmail',
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      secure: false,
      authUser: 'portal@example.com',
      authPass: '',
      fromName: 'RTBI Portal',
      fromEmail: 'portal@example.com',
      replyTo: 'portal@example.com',
      updatedAt: new Date().toISOString()
    }
  ],
  guests: initialGuests,
  budgets: initialBudgets,
  incomeSources: initialIncomeSources,
  eventReports: [],
  event_passes: [],
  certificates: [],
  certificateSchedules: [],
  passEmailSchedules: [],
  approvalRequests: [],
  procurementRequests: initialProcurementRequests,
  birthdayEmailLog: [],
  sessions: [],
  walletSettings: [],
  rooms: [],
  bookings: [],
  invoices: [],
  payments: [],
  billingSettings: [],
  inventoryItems: [],
  inventoryMovements: [],
};

const COLLECTION_KEYS = Object.keys(EMPTY_DB) as (keyof DbSchema)[];

function collectionPath(key: keyof DbSchema): string {
  return path.join(DATA_DIR, `${String(key)}.json`);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * One-time, idempotent split of the legacy single-file database.json into
 * per-collection files. Cached in module scope so concurrent calls (e.g.
 * several requests landing at once on first boot after upgrading) all await
 * the same migration instead of racing each other. Safe to call on every
 * boot — a no-op once migration has happened (ENOENT on the legacy path).
 */
let migrationPromise: Promise<void> | null = null;
function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      let legacy: Partial<DbSchema>;
      try {
        const raw = await fs.readFile(LEGACY_DB_PATH, 'utf-8');
        legacy = JSON.parse(raw);
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          console.error('[server-db] Legacy database.json read failed during migration check:', err);
        }
        return; // no legacy file (or unreadable) — nothing to migrate
      }

      await fs.mkdir(DATA_DIR, { recursive: true });
      for (const key of COLLECTION_KEYS) {
        const target = collectionPath(key);
        if (await fileExists(target)) continue; // already migrated (or created independently) — never overwrite
        const value = Array.isArray(legacy[key]) ? legacy[key] : (EMPTY_DB[key] as any[]);
        await fs.writeFile(target, JSON.stringify(value, null, 2), 'utf-8');
      }

      // Retire, never delete, the legacy file — undeletable safety net if migration
      // logic ever has a bug. Idempotent: if a retired copy already exists (a prior
      // partial run), leave both alone rather than overwriting the earlier snapshot.
      if (!(await fileExists(RETIRED_LEGACY_DB_PATH))) {
        try {
          await fs.rename(LEGACY_DB_PATH, RETIRED_LEGACY_DB_PATH);
        } catch (err) {
          console.error('[server-db] Failed to retire legacy database.json after migration:', err);
        }
      }
    })();
  }
  return migrationPromise;
}

/**
 * 30-Day Storage Retention Cleanup Helper:
 * Checks design items past 30 days, marks them as expired, and purges the stored
 * file — both the legacy inline base64 payload (if the record predates the
 * disk-backed storage migration) and, for newer records, the actual file on disk
 * referenced by storageKey.
 */
function processDesignRetention(designs: any[]): any[] {
  if (!Array.isArray(designs)) return [];
  const nowMs = Date.now();

  return designs.map(item => {
    if (!item.expiresAt) return item;
    const expiresMs = new Date(item.expiresAt).getTime();
    if (nowMs > expiresMs) {
      if (!item.isExpired && item.storageKey) {
        // Best-effort, not awaited — this function stays synchronous and never
        // blocks a read waiting on a delete that only needs to happen once.
        deleteStoredFile(item.storageKey).catch(() => {});
      }
      return {
        ...item,
        isExpired: true,
        fileData: undefined, // Purge legacy inline payload after 30 days
        fileUrl: undefined,
        storageKey: undefined,
      };
    }
    return item;
  });
}

/**
 * One-time, idempotent migration of any legacy inline-base64 file payloads
 * (designs.json's fileData, reimbursements.json's receiptFiles[].dataUrl /
 * receiptData) out to real files under data/uploads/, rewriting the JSON
 * records to reference them via storageKey/url instead. Safe to run on every
 * boot — a record that's already migrated has no dataUrl/fileData left to act
 * on, so it's skipped. Cached in module scope like ensureMigrated().
 */
let fileMigrationPromise: Promise<void> | null = null;
function ensureFilesMigrated(): Promise<void> {
  if (!fileMigrationPromise) {
    fileMigrationPromise = (async () => {
      await migrateDesignFilesToDisk();
      await migrateReimbursementFilesToDisk();
    })();
  }
  return fileMigrationPromise;
}

/**
 * One-time, idempotent seed: the built-in Feedback Form Template only
 * auto-appears via SEED_DB on a brand-new formTemplates.json (first boot
 * for that specific collection). Any database that already existed before
 * this template shipped needs it inserted directly — same shape as the
 * other one-off corrections above. Runs once per boot; a permanent no-op
 * once the template id is present.
 */
let feedbackFormTemplateSeedPromise: Promise<void> | null = null;
function ensureFeedbackFormTemplateSeeded(): Promise<void> {
  if (!feedbackFormTemplateSeedPromise) {
    feedbackFormTemplateSeedPromise = (async () => {
      const builtIn = SEED_DB.formTemplates.find((t: any) => t.id === FEEDBACK_FORM_TEMPLATE_ID);
      if (!builtIn) return;
      try {
        const raw = await fs.readFile(collectionPath('formTemplates'), 'utf-8');
        const parsed = JSON.parse(raw);
        let jsonContent: any = parsed;
        if (isEncryptedPayload(parsed)) {
          try {
            jsonContent = JSON.parse(decryptData(parsed));
          } catch {
            return;
          }
        }
        if (!Array.isArray(jsonContent)) return;
        const existingIdx = jsonContent.findIndex((t: any) => t?.id === FEEDBACK_FORM_TEMPLATE_ID);
        if (existingIdx === -1) {
          await writeCollectionFile('formTemplates', [builtIn, ...jsonContent]);
          return;
        }
        // An admin edited (customized) or deleted this built-in from Manage Templates — never overwrite that.
        if (jsonContent[existingIdx]?.customized || jsonContent[existingIdx]?.deleted) return;

        // Already present, but this is a built-in/managed template (not
        // something an admin hand-edits) — a database seeded before a
        // field-definition change shipped (e.g. "Type of Event" becoming a
        // multiselect) would otherwise keep serving its stale copy forever,
        // since the ENOENT first-boot seed path only ever runs once. Keep
        // it in sync with the current code-defined version whenever the
        // fields differ.
        if (JSON.stringify(jsonContent[existingIdx]?.fields) !== JSON.stringify(builtIn.fields)) {
          const updated = [...jsonContent];
          updated[existingIdx] = { ...updated[existingIdx], fields: builtIn.fields };
          await writeCollectionFile('formTemplates', updated);
        }
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          console.error('[server-db] Feedback Form Template seed check failed:', err);
        }
        // ENOENT: no file yet — readCollectionFile's first-boot seed path handles it.
      }
    })();
  }
  return feedbackFormTemplateSeedPromise;
}

async function migrateDesignFilesToDisk(): Promise<void> {
  let designs: any[];
  try {
    designs = JSON.parse(await fs.readFile(collectionPath('designs'), 'utf-8'));
  } catch {
    return; // no file yet — nothing to migrate
  }
  if (!Array.isArray(designs)) return;

  let changed = false;
  for (const item of designs) {
    if (typeof item.fileData === 'string' && item.fileData.startsWith('data:')) {
      try {
        const stored = await saveBase64File('designs', item.id, 0, item.fileName || 'file', item.fileData);
        item.fileUrl = stored.url;
        item.storageKey = stored.storageKey;
        delete item.fileData;
        changed = true;
      } catch (err) {
        console.error('[server-db] Failed to migrate design file to disk for', item.id, err);
      }
    }
  }
  if (changed) await writeCollectionFile('designs', designs);
}

async function migrateReimbursementFilesToDisk(): Promise<void> {
  let items: any[];
  try {
    items = JSON.parse(await fs.readFile(collectionPath('reimbursements'), 'utf-8'));
  } catch {
    return;
  }
  if (!Array.isArray(items)) return;

  let changed = false;
  for (const item of items) {
    const files = Array.isArray(item.receiptFiles) ? item.receiptFiles : [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f && typeof f.dataUrl === 'string' && f.dataUrl.startsWith('data:')) {
        try {
          const stored = await saveBase64File('reimbursements', item.id, i, f.name || 'file', f.dataUrl);
          f.url = stored.url;
          f.storageKey = stored.storageKey;
          delete f.dataUrl;
          changed = true;
        } catch (err) {
          console.error('[server-db] Failed to migrate receipt file to disk for', item.id, i, err);
        }
      }
    }
    // Legacy single-file shape predating receiptFiles[] entirely.
    if (files.length === 0 && typeof item.receiptData === 'string' && item.receiptData.startsWith('data:')) {
      try {
        const stored = await saveBase64File('reimbursements', item.id, 0, item.receiptUrl || 'receipt.pdf', item.receiptData);
        item.receiptFiles = [{ name: item.receiptUrl || 'receipt.pdf', url: stored.url, storageKey: stored.storageKey }];
        delete item.receiptData;
        changed = true;
      } catch (err) {
        console.error('[server-db] Failed to migrate legacy receipt for', item.id, err);
      }
    }
  }
  if (changed) await writeCollectionFile('reimbursements', items);
}

async function readCollectionFile<T = any>(key: keyof DbSchema): Promise<T[]> {
  await ensureMigrated();
  await ensureFilesMigrated();
  await ensureFeedbackFormTemplateSeeded();
  try {
    const raw = await fs.readFile(collectionPath(key), 'utf-8');
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr: any) {
      // "Unexpected non-whitespace character after JSON at position N" = a complete,
      // valid payload followed by leftover bytes (two overlapping writes). Keep the
      // valid prefix, back up the damaged file, and rewrite it cleanly.
      const m = /after JSON at position (\d+)/.exec(String(parseErr?.message ?? ''));
      if (!m) throw parseErr;
      parsed = JSON.parse(raw.slice(0, Number(m[1])));
      if (!isEncryptedPayload(parsed)) throw parseErr;
      try {
        decryptData(parsed); // only repair when the surviving prefix is itself intact
        const backup = `${collectionPath(key)}.corrupt-${Date.now()}`;
        await fs.writeFile(backup, raw, 'utf-8');
        const fixed = `${collectionPath(key)}.${process.pid}.repair.tmp`;
        await fs.writeFile(fixed, JSON.stringify(parsed), 'utf-8');
        await fs.rename(fixed, collectionPath(key));
        console.warn(`[server-db] Repaired "${String(key)}" (trailing data removed). Original saved to ${backup}`);
      } catch (repairErr) {
        console.error(`[server-db] Could not repair "${String(key)}":`, repairErr);
        throw parseErr;
      }
    }
    let jsonContent: any = parsed;

    if (isEncryptedPayload(parsed)) {
      try {
        const decryptedText = decryptData(parsed);
        jsonContent = JSON.parse(decryptedText);
      } catch (decErr) {
        console.error(`[server-db] Decryption failed for collection "${String(key)}":`, decErr);
        // Never treat an undecryptable file as "empty" — that empty array can
        // flow straight into mutateCollection's write-back and permanently
        // overwrite the real (still-intact-on-disk) data with just the new
        // mutation. Surface the failure instead so the caller sees an error
        // rather than silent data loss.
        throw new Error(`[server-db] Collection "${String(key)}" could not be decrypted — refusing to treat it as empty.`);
      }
    }

    let arr: any[] = Array.isArray(jsonContent) ? jsonContent : ((EMPTY_DB[key] as any[]) ?? []);
    if (key === 'designs') arr = processDesignRetention(arr);
    return arr as T[];
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      // A corrupted/unparsable file, a transient disk error, etc. Same
      // reasoning as above: returning EMPTY_DB here used to make a
      // transient read failure look like a genuinely empty collection,
      // and mutateCollection would then happily persist that emptiness,
      // wiping out real data on the very next write. Log loudly and
      // rethrow so the failure surfaces as an error instead of silent
      // data loss.
      console.error(`[server-db] Failed to read collection "${String(key)}":`, err);
      throw err;
    }
    // First boot for this specific collection: seed it from local-data.ts's initial* export.
    const seeded = ((SEED_DB[key] as any[]) ?? []) as T[];
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const encryptedPayload = encryptData(JSON.stringify(seeded));
      await fs.writeFile(collectionPath(key), JSON.stringify(encryptedPayload, null, 2), 'utf-8');
    } catch (writeErr) {
      console.error(`[server-db] First-boot seed write failed for "${String(key)}":`, writeErr);
    }
    return seeded;
  }
}

async function writeCollectionFile<T = any>(key: keyof DbSchema, data: T[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const jsonString = JSON.stringify(data);
  const encryptedPayload = encryptData(jsonString);
  // Write to a temp file then rename: rename is atomic, so a reader (or a crash mid-write)
  // can never see a half-written or doubled-up file.
  const target = collectionPath(key);
  const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(encryptedPayload), 'utf-8');
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Best-effort shared freshness marker — nothing depends on this for correctness. */
async function touchMeta(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(META_PATH, JSON.stringify({ lastUpdated: new Date().toISOString() }, null, 2), 'utf-8');
  } catch (err) {
    console.error('[server-db] Failed to update _meta.json:', err);
  }
}

/** Read every collection and assemble the full DbSchema shape (used by the /api/data aggregate poll). */
export async function readDb(keys?: readonly (keyof DbSchema)[]): Promise<DbSchema> {
  const wanted = keys ? COLLECTION_KEYS.filter(k => keys.includes(k)) : COLLECTION_KEYS;
  const entries = await Promise.all(
    wanted.map(async key => [key, await readCollectionFile(key)] as const)
  );
  const db = Object.fromEntries(entries) as unknown as DbSchema;
  try {
    const metaRaw = await fs.readFile(META_PATH, 'utf-8');
    db.lastUpdated = JSON.parse(metaRaw)?.lastUpdated;
  } catch {
    // no meta file yet — fine, lastUpdated stays undefined
  }
  return db;
}

/**
 * Read a single collection from its own file.
 */
export async function readCollection<T = any>(key: keyof DbSchema): Promise<T[]> {
  return readCollectionFile<T>(key);
}

// Per-collection write locks — a write to "tasks" never waits on a concurrent
// write to "members" or any other unrelated collection.
// Stored on globalThis: Next.js bundles this module separately per route/instrumentation
// chunk, and a module-level Map would give each copy its own lock — letting two writers hit
// the same file at once and corrupt it.
const globalForDb = globalThis as unknown as { __leadsWriteLocks?: Map<keyof DbSchema, Promise<void>> };
const writeLocks: Map<keyof DbSchema, Promise<void>> = (globalForDb.__leadsWriteLocks ??= new Map());

/**
 * Apply a mutation to a single collection and write only that collection's file.
 * The mutator receives the current array and returns the updated array.
 * Locked per-collection so concurrent calls to the SAME collection queue up
 * safely, while calls to different collections proceed independently.
 */
/**
 * Server-side bookkeeping for tasks, whichever route or scheduler wrote them: a task the server has not seen before gets
 * `assignedAt` (so the "assigned on" date is the real creation moment), and a task that just became Completed gets
 * `completedAt` (cleared again if it is reopened). Existing tasks are never back-dated.
 */
function stampTaskTimes(before: any[], after: any[]): any[] {
  const prev = new Map((before || []).map(t => [t?.id, t]));
  const now = new Date().toISOString();
  return (after || []).map(t => {
    if (!t || typeof t !== 'object') return t;
    const old = prev.get(t.id);
    let next = t;
    if (!old && !t.assignedAt) next = { ...next, assignedAt: now };
    if (t.status === 'Completed' && (!old || old.status !== 'Completed') && !t.completedAt) next = { ...next, completedAt: now };
    if (t.status !== 'Completed' && old?.status === 'Completed' && t.completedAt) {
      const { completedAt: _drop, ...rest } = next;
      next = rest;
    }
    return next;
  });
}

export async function mutateCollection<T = any>(
  key: keyof DbSchema,
  mutator: (current: T[]) => T[]
): Promise<T[]> {
  const previousLock = writeLocks.get(key) ?? Promise.resolve();
  let result: T[] = [];
  let mutationError: unknown = null;

  const thisLock = previousLock.then(async () => {
    try {
      const current = await readCollectionFile<T>(key);
      let updated = mutator(current);
      if (key === 'tasks') updated = stampTaskTimes(current as any[], updated as any[]) as unknown as T[];
      await writeCollectionFile(key, updated);
      result = updated;
    } catch (err) {
      mutationError = err;
    }
  });

  writeLocks.set(key, thisLock);
  await thisLock;
  touchMeta(); // best-effort, not awaited — never blocks or fails a mutation
  if (mutationError) throw mutationError;
  return result;
}
