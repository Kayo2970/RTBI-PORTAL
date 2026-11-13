import { NextResponse } from 'next/server';
import { parseDataUrl } from '@/lib/file-storage';
import { scanForTextIssues } from '@/lib/ocr-spellcheck';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB, matches the Design Portal upload cap

/**
 * Runs an OCR + spell-check pass on a poster/PDF *before* it's submitted as
 * a design record — the upload modal calls this with the same in-memory
 * data: URL it already holds, so nothing needs to be persisted first. Purely
 * advisory: a scan failure or unsupported file type is reported back as a
 * normal error response, never blocking the caller's actual submission.
 */
export async function POST(request: Request) {
  try {
    await requireSession(request);
    const { fileData, fileType } = await request.json();

    if (typeof fileData !== 'string' || !fileData.startsWith('data:')) {
      return NextResponse.json({ error: 'No file data provided.' }, { status: 400 });
    }

    const { mime, buffer } = parseDataUrl(fileData);
    const effectiveMime = fileType || mime;

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: 'File size exceeds the maximum limit of 25 MB.' }, { status: 400 });
    }

    if (!effectiveMime.startsWith('image/') && effectiveMime !== 'application/pdf') {
      return NextResponse.json({ error: 'OCR scanning only supports images and PDF files.' }, { status: 400 });
    }

    const result = await scanForTextIssues(buffer, effectiveMime);
    return NextResponse.json(result);
  } catch (err: any) {
    return apiError(err, 'designs-ocr-scan-api-post', 500);
  }
}
