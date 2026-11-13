/**
 * Daily housekeeping for the blurred e-mail background pictures (see the retention notes in email-background.ts):
 *   - 90 days after the last e-mail that used a blurred copy: shrink it to a very small blurred image (same URL);
 *   - 180 days after: delete it — old e-mails then show the plain solid background instead.
 * "Last used" is recorded whenever an e-mail (or a preview) asks for the copy, so a picture that is still being sent with is never touched.
 */
import fs from 'fs/promises';
import path from 'path';
import { BLURRED_CATEGORY, DELETE_AFTER_DAYS, SMALL_AFTER_DAYS, blurredFileKey, readBlurredMeta, shrinkBlurredJpeg, writeBlurredMeta } from './email-background';
import { readStoredFile, saveBase64File } from './file-storage';

const DAY_MS = 24 * 60 * 60 * 1000;
const BLURRED_DIR = path.join(process.cwd(), 'data', 'uploads', BLURRED_CATEGORY);

export async function sweepEmailBackgrounds(now: Date = new Date()): Promise<{ shrunk: number; removed: number }> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(BLURRED_DIR);
  } catch {
    return { shrunk: 0, removed: 0 }; // nothing was ever made
  }
  let shrunk = 0;
  let removed = 0;
  for (const hash of entries) {
    if (!/^[a-f0-9]{20}$/.test(hash)) continue;
    try {
      const meta = await readBlurredMeta(hash);
      // Copies made before usage tracking existed have no record: use the file's own date.
      let lastUsed = meta ? Date.parse(meta.lastUsedAt) : NaN;
      if (Number.isNaN(lastUsed)) lastUsed = (await fs.stat(path.join(BLURRED_DIR, hash, '0__bg.jpg'))).mtimeMs;
      const ageDays = (now.getTime() - lastUsed) / DAY_MS;

      if (ageDays >= DELETE_AFTER_DAYS) {
        await fs.rm(path.join(BLURRED_DIR, hash), { recursive: true, force: true });
        removed += 1;
      } else if (ageDays >= SMALL_AFTER_DAYS && meta?.stage !== 'small') {
        const small = await shrinkBlurredJpeg(await readStoredFile(blurredFileKey(hash)));
        await saveBase64File(BLURRED_CATEGORY, hash, 0, 'bg.jpg', `data:image/jpeg;base64,${small.toString('base64')}`);
        await writeBlurredMeta(hash, {
          stage: 'small',
          lastUsedAt: new Date(lastUsed).toISOString(),
          sourceKey: meta?.sourceKey || '',
          blur: meta?.blur ?? 0,
        });
        shrunk += 1;
      }
    } catch (err) {
      console.error(`[email-background-retention] Skipped ${hash}:`, err);
    }
  }
  return { shrunk, removed };
}

let timer: NodeJS.Timeout | null = null;

export function startEmailBackgroundScheduler(): void {
  if (timer) return;
  const tick = () => {
    sweepEmailBackgrounds()
      .then((r) => (r.shrunk || r.removed) && console.log(`[email-background-retention] shrunk ${r.shrunk}, removed ${r.removed} blurred background(s)`))
      .catch((err) => console.error('[email-background-retention] run failed:', err));
  };
  setTimeout(tick, 90_000); // shortly after boot, then daily
  timer = setInterval(tick, DAY_MS);
}
