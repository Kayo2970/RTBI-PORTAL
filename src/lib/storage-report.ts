/**
 * Storage audit: sizes per upload category, files on disk that no record references
 * (orphans), and leftover pre-restore snapshots. Used by /api/admin/storage.
 */
import fs from 'fs/promises';
import path from 'path';
import { readDb } from '@/lib/server-db';

const DATA_DIR = path.join(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

export interface StorageFileInfo {
  key: string;
  bytes: number;
  modifiedAt: string;
}

export interface StorageReport {
  totalBytes: number;
  fileCount: number;
  categories: Array<{ category: string; bytes: number; files: number }>;
  orphanBytes: number;
  orphans: StorageFileInfo[];
  preRestoreSnapshots: Array<{ name: string; bytes: number }>;
  largest: StorageFileInfo[];
}

async function walk(dir: string, base = dir): Promise<StorageFileInfo[]> {
  let entries: import('fs').Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: StorageFileInfo[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else if (e.isFile()) {
      const st = await fs.stat(full);
      out.push({
        key: path.relative(base, full).split(path.sep).join('/'),
        bytes: st.size,
        modifiedAt: st.mtime.toISOString(),
      });
    }
  }
  return out;
}

async function dirSize(dir: string): Promise<number> {
  return (await walk(dir)).reduce((n, f) => n + f.bytes, 0);
}

/** Every storage key referenced anywhere in the database (storageKey fields and /api/files URLs). */
function collectReferencedKeys(node: unknown, keys: Set<string>, field = ''): void {
  if (typeof node === 'string') {
    if (/storagekey$/i.test(field) && node) keys.add(node);
    const idx = node.indexOf('/api/files/');
    if (idx >= 0) {
      const raw = node.slice(idx + '/api/files/'.length).split('?')[0];
      try {
        keys.add(decodeURIComponent(raw));
      } catch {
        keys.add(raw);
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectReferencedKeys(n, keys, field));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) collectReferencedKeys(v, keys, k);
  }
}

export async function buildStorageReport(): Promise<StorageReport> {
  const [files, db] = await Promise.all([walk(UPLOADS_DIR), readDb()]);
  const referenced = new Set<string>();
  collectReferencedKeys(db, referenced);

  // Pass themes live on disk (not in a collection): theme.json + its artwork are referenced while the event exists
  const eventIds = new Set((db.events || []).map((e: any) => e.id));
  for (const f of files) {
    const m = f.key.match(/^pass-themes\/([^/]+)\/9__theme\.json$/);
    if (!m || !eventIds.has(m[1])) continue;
    referenced.add(f.key);
    try {
      const theme = JSON.parse(await fs.readFile(path.join(UPLOADS_DIR, f.key), 'utf8'));
      if (theme.backgroundKey) referenced.add(theme.backgroundKey);
      if (theme.walletBackgroundKey) referenced.add(theme.walletBackgroundKey);
      if (theme.emailArtworkKey) referenced.add(theme.emailArtworkKey);
      if (theme.logoKey) referenced.add(theme.logoKey);
    } catch {
      /* unreadable theme file — leave its artwork unreferenced */
    }
  }

  const byCategory = new Map<string, { bytes: number; files: number }>();
  for (const f of files) {
    const cat = f.key.split('/')[0] || 'other';
    const cur = byCategory.get(cat) || { bytes: 0, files: 0 };
    cur.bytes += f.bytes;
    cur.files += 1;
    byCategory.set(cat, cur);
  }

  // Files uploaded in the last hour may belong to a form that hasn't been saved yet — never call those orphans
  const grace = Date.now() - 60 * 60 * 1000;
  const orphans = files.filter((f) => !referenced.has(f.key) && new Date(f.modifiedAt).getTime() < grace);
  let preRestore: StorageReport['preRestoreSnapshots'] = [];
  try {
    const siblings = await fs.readdir(process.cwd());
    preRestore = await Promise.all(
      siblings
        .filter((n) => n.startsWith('data.pre-restore-'))
        .map(async (name) => ({ name, bytes: await dirSize(path.join(process.cwd(), name)) }))
    );
  } catch {
    /* none */
  }

  return {
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    fileCount: files.length,
    categories: Array.from(byCategory.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.bytes - a.bytes),
    orphanBytes: orphans.reduce((n, f) => n + f.bytes, 0),
    orphans: orphans.sort((a, b) => b.bytes - a.bytes),
    preRestoreSnapshots: preRestore,
    largest: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 10),
  };
}

/** Delete every orphaned file (and prune empty folders). Returns what was removed. */
export async function deleteOrphans(): Promise<{ deleted: number; bytes: number }> {
  const report = await buildStorageReport();
  let deleted = 0;
  let bytes = 0;
  for (const f of report.orphans) {
    try {
      await fs.unlink(path.join(UPLOADS_DIR, f.key));
      deleted += 1;
      bytes += f.bytes;
    } catch {
      /* already gone */
    }
  }
  await pruneEmptyDirs(UPLOADS_DIR, true);
  return { deleted, bytes };
}

async function pruneEmptyDirs(dir: string, isRoot = false): Promise<boolean> {
  let entries: import('fs').Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let empty = true;
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!(await pruneEmptyDirs(path.join(dir, e.name)))) empty = false;
    } else empty = false;
  }
  if (empty && !isRoot) {
    await fs.rmdir(dir).catch(() => {});
    return true;
  }
  return empty && isRoot ? true : empty;
}

/** Remove old pre-restore snapshots (data.pre-restore-*). */
export async function deletePreRestoreSnapshots(): Promise<number> {
  let n = 0;
  for (const name of await fs.readdir(process.cwd())) {
    if (name.startsWith('data.pre-restore-')) {
      await fs.rm(path.join(process.cwd(), name), { recursive: true, force: true });
      n += 1;
    }
  }
  return n;
}
