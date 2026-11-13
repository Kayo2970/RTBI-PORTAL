/**
 * file-storage.ts — Real on-disk storage for uploaded documents (design assets,
 * reimbursement receipts), replacing the previous approach of embedding a file's
 * full base64 payload directly inside its JSON record.
 *
 * Every uploaded file lives under data/uploads/<category>/<recordId>/<index>__<name>
 * — the same data/ directory the per-collection JSON files already live in, so a
 * single backup of data/ (as already documented for the JSON collections) restores
 * both the records AND the files they reference. JSON records only ever store a
 * `storageKey` (the path under data/uploads) and a servable `url` — never the raw
 * bytes — keeping the JSON files small and fast to read/write regardless of how
 * much has been uploaded.
 */
import fs from 'fs/promises';
import path from 'path';

const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads');

/** Strip anything that isn't a safe filename character, keep it short. */
function sanitizeFileName(name: string): string {
  const base = (name || 'file').split(/[/\\]/).pop() || 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return (cleaned || 'file').slice(0, 120);
}

/**
 * Parse a `data:<mime>;base64,<data>` URL into its MIME type and raw buffer.
 * The mime segment is matched as zero-or-more chars (not one-or-more) — a
 * browser that can't sniff a file's type can produce `data:;base64,...`
 * with nothing before the semicolon, which used to fail this parse outright
 * and silently drop the whole upload.
 */
/**
 * Parse a `data:<mime>;base64,<data>` URL into its MIME type and raw buffer.
 * Handles data URL variants including missing mime headers, octet-stream fallbacks,
 * and additional parameters.
 */
export function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return { mime: 'application/octet-stream', buffer: Buffer.alloc(0) };
  }
  const match = /^data:([^;]*)(?:;[^;]*)*;base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) {
    const parts = dataUrl.split(';base64,');
    if (parts.length === 2) {
      const mimePart = parts[0].replace(/^data:/, '').split(';')[0];
      return { mime: mimePart || 'application/octet-stream', buffer: Buffer.from(parts[1].trim(), 'base64') };
    }
    const cleanBase64 = dataUrl.replace(/^data:[^,]+,/, '').trim();
    return { mime: 'application/octet-stream', buffer: Buffer.from(cleanBase64, 'base64') };
  }
  return { mime: match[1] || 'application/octet-stream', buffer: Buffer.from(match[2].trim(), 'base64') };
}

export interface StoredFile {
  storageKey: string; // path relative to data/uploads, e.g. "designs/des_123/0__poster.png"
  url: string;         // servable URL, e.g. "/api/files/designs/des_123/0__poster.png"
  size: number;
}

/**
 * Decode a base64 data URL and write it to disk under
 * data/uploads/<category>/<recordId>/<index>__<sanitizedName>.
 */
export async function saveBase64File(
  category: string,
  recordId: string,
  index: number,
  fileName: string,
  dataUrl: string
): Promise<StoredFile> {
  const { buffer } = parseDataUrl(dataUrl);
  const safeName = sanitizeFileName(fileName);
  const storageKey = `${category}/${recordId}/${index}__${safeName}`;
  const target = path.join(UPLOADS_DIR, category, recordId, `${index}__${safeName}`);

  // Guard against path traversal in category or recordId — path.join normalises
  // '..' sequences, so we must verify the resolved path stays inside UPLOADS_DIR
  // and within the expected category subdirectory before writing anything.
  const resolvedTarget = path.resolve(target);
  const expectedPrefix = path.join(UPLOADS_DIR, category) + path.sep;
  if (!resolvedTarget.startsWith(expectedPrefix)) {
    throw new Error('Invalid file path: category or record ID contains path traversal sequences.');
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);

  return { storageKey, url: `/api/files/${storageKey}`, size: buffer.length };
}

/** Resolve a storageKey to an absolute path, refusing anything that escapes UPLOADS_DIR
 *  or traverses into a different category than the one stated in the key's first segment. */
function resolveStoragePath(storageKey: string): string {
  const resolved = path.resolve(UPLOADS_DIR, storageKey);
  if (resolved !== UPLOADS_DIR && !resolved.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error('Invalid storage key.');
  }
  // Prevent cross-category traversal: e.g. "members/../guests/x/file" resolves
  // within UPLOADS_DIR but ends up in a different category.  Verify the resolved
  // path is actually inside the category named by the first segment of the key.
  const firstSegment = storageKey.split('/')[0];
  if (firstSegment) {
    const expectedPrefix = path.join(UPLOADS_DIR, firstSegment) + path.sep;
    if (!resolved.startsWith(expectedPrefix)) {
      throw new Error('Invalid storage key.');
    }
  }
  return resolved;
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return fs.readFile(resolveStoragePath(storageKey));
}

/** Best-effort delete — missing files are not an error. */
export async function deleteStoredFile(storageKey: string): Promise<void> {
  try {
    const resolved = resolveStoragePath(storageKey);
    await fs.unlink(resolved);
    // Prune the now-possibly-empty <category>/<recordId> folder so empty dirs don't pile up
    try {
      await fs.rmdir(path.dirname(resolved));
    } catch {
      /* not empty — leave it */
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') console.error('[file-storage] Failed to delete', storageKey, err);
  }
}

/** Best-effort recursive delete of every file stored for one record (e.g. on record deletion). */
export async function deleteStoredFilesForRecord(category: string, recordId: string): Promise<void> {
  try {
    await fs.rm(path.join(UPLOADS_DIR, category, recordId), { recursive: true, force: true });
  } catch (err) {
    console.error('[file-storage] Failed to delete record folder', category, recordId, err);
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pkpass': 'application/vnd.apple.pkpass',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.psd': 'image/vnd.adobe.photoshop',
  '.ai': 'application/postscript',
  '.eps': 'application/postscript',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed',
  '.cdr': 'application/coreldraw',
  '.fig': 'application/octet-stream',
  '.xd': 'application/octet-stream',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
};

export function guessMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_BY_EXTENSION[ext] || 'application/octet-stream';
}
