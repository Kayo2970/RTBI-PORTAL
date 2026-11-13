/**
 * backup.ts — Super User-only full-database backup and restore.
 *
 * A backup is the entire data/ directory (every per-collection JSON file plus
 * every uploaded document under data/uploads/) zipped, then encrypted as one
 * opaque blob with a passphrase the Super User supplies at download time.
 * Nobody who intercepts the downloaded file can read it without that
 * passphrase — AES-256-GCM's authentication tag makes a wrong passphrase (or
 * a corrupted/tampered file) fail decryption outright rather than silently
 * producing garbage.
 *
 * Restore never deletes the live data/ directory outright — it's always
 * retired (renamed, timestamped) before the restored contents take its
 * place, so a bad restore is always recoverable by hand on the server.
 */
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';

const DATA_DIR = path.join(process.cwd(), 'data');
const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_LEN = 32; // AES-256

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, KEY_LEN);
}

/** Recursively list every file under `dir`, returning paths relative to `dir`. */
async function listFilesRecursive(dir: string, baseDir = dir): Promise<string[]> {
  let entries: fssync.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full, baseDir)));
    } else {
      files.push(path.relative(baseDir, full));
    }
  }
  return files;
}

/** Build the zip (data/*.json + data/uploads/**) as an in-memory buffer. */
async function buildZipBuffer(): Promise<Buffer> {
  const zip = new AdmZip();
  const relFiles = await listFilesRecursive(DATA_DIR);
  for (const rel of relFiles) {
    if (rel.includes('.migrated') || rel.startsWith('..')) continue;
    const targetDir = path.dirname(rel) === '.' ? '' : path.dirname(rel);
    zip.addLocalFile(path.join(DATA_DIR, rel), targetDir, path.basename(rel));
  }
  return zip.toBuffer();
}

export interface BackupSummary {
  collectionCount: number;
  fileCount: number;
}

export async function createEncryptedBackup(passphrase: string): Promise<{ buffer: Buffer; summary: BackupSummary }> {
  const relFiles = await listFilesRecursive(DATA_DIR);
  const usableFiles = relFiles.filter(f => !f.includes('.migrated'));
  const collectionCount = usableFiles.filter(f => f.endsWith('.json') && !f.includes(path.sep)).length;
  const fileCount = usableFiles.filter(f => f.startsWith('uploads' + path.sep)).length;

  const zipBuffer = await buildZipBuffer();

  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(zipBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const output = Buffer.concat([salt, iv, authTag, ciphertext]);
  return { buffer: output, summary: { collectionCount, fileCount } };
}

export class InvalidPassphraseError extends Error {
  constructor() {
    super('Incorrect passphrase, or the backup file is corrupted.');
    this.name = 'InvalidPassphraseError';
  }
}

function decryptBackup(encrypted: Buffer, passphrase: string): Buffer {
  if (encrypted.length < SALT_LEN + IV_LEN + 16) {
    throw new InvalidPassphraseError();
  }
  const salt = encrypted.subarray(0, SALT_LEN);
  const iv = encrypted.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const authTag = encrypted.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + 16);
  const ciphertext = encrypted.subarray(SALT_LEN + IV_LEN + 16);

  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new InvalidPassphraseError();
  }
}

export interface RestoreSummary {
  collectionCount: number;
  fileCount: number;
  retiredTo: string;
}

export async function restoreEncryptedBackup(encrypted: Buffer, passphrase: string): Promise<RestoreSummary> {
  const zipBuffer = decryptBackup(encrypted, passphrase);

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new InvalidPassphraseError();
  }
  const entries = zip.getEntries();
  const hasAnyJson = entries.some(e => !e.isDirectory && e.entryName.endsWith('.json'));
  if (!hasAnyJson) {
    throw new Error('This backup does not look like a valid LEADS database backup — no collection files found.');
  }

  // Retire (never delete) the current live data/ directory before restoring.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const retiredDir = `${DATA_DIR}.pre-restore-${stamp}`;
  if (fssync.existsSync(DATA_DIR)) {
    await fs.rename(DATA_DIR, retiredDir);
  }
  await fs.mkdir(DATA_DIR, { recursive: true });

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const targetPath = path.join(DATA_DIR, entry.entryName);
    const resolved = path.resolve(targetPath);
    if (resolved !== DATA_DIR && !resolved.startsWith(DATA_DIR + path.sep)) {
      continue; // guard against a malicious/corrupt archive escaping data/
    }
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, entry.getData());
  }

  const restoredFiles = await listFilesRecursive(DATA_DIR);
  return {
    collectionCount: restoredFiles.filter(f => f.endsWith('.json') && !f.includes(path.sep)).length,
    fileCount: restoredFiles.filter(f => f.startsWith('uploads' + path.sep)).length,
    retiredTo: path.basename(retiredDir),
  };
}
