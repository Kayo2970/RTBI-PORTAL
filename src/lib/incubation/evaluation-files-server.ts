import { saveBase64File } from '@/lib/file-storage';
import type { ApplicationFile } from './types';

const MAX_BYTES = 15 * 1024 * 1024;
export interface IncomingEvalFile { name?: string; type?: string; dataUrl?: string }

/** Save evaluation evidence (screening checks, scorecard attachments) under data/uploads/evaluations/<applicationId>/. */
export async function storeEvaluationFile(applicationId: string, tag: string, f: IncomingEvalFile | undefined): Promise<ApplicationFile | null> {
  if (!f || typeof f.dataUrl !== 'string' || !f.dataUrl.startsWith('data:')) return null;
  const name = String(f.name || 'file').slice(0, 150);
  if (Math.floor((f.dataUrl.length * 3) / 4) > MAX_BYTES) throw new Error(`"${name}" exceeds the 15 MB per-file limit.`);
  const s = await saveBase64File('evaluations', applicationId, Date.now() + Math.floor(Math.random() * 1000), `${tag}_${name}`, f.dataUrl);
  return { name, url: s.url, storageKey: s.storageKey, type: typeof f.type === 'string' ? f.type : undefined };
}
