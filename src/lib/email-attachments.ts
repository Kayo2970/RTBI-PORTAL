/**
 * email-attachments.ts — client-side helpers shared by every email composer
 * (Email Management's Broadcast Composer, the Mail Merge module) for turning
 * picked files into the base64 shape src/app/api/email/send/route.ts's
 * decodeAttachments() expects, and for the "Please find attached the
 * following file(s)" notice line inserted into a message body.
 */

export interface ComposedAttachment {
  filename: string;
  contentBase64: string;
  contentType?: string;
  size: number;
}

// Matches typical SMTP/Outlook practical limits (Microsoft 365 caps a single
// outbound message around 20-25MB including headers/encoding overhead) —
// keeps a mail-merge batch from silently failing partway through a send
// instead of being rejected upfront with a clear reason.
export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15MB

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // FileReader.readAsDataURL gives "data:<mime>;base64,<data>" — the API
      // route only wants the base64 payload itself.
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export async function filesToAttachments(files: File[]): Promise<ComposedAttachment[]> {
  const results: ComposedAttachment[] = [];
  for (const file of files) {
    const contentBase64 = await readFileAsBase64(file);
    results.push({
      filename: file.name,
      contentBase64,
      contentType: file.type || undefined,
      size: file.size,
    });
  }
  return results;
}

/** "Please find attached the following file(s): a.pdf, b.png" — the exact notice line a composer inserts into the message body when attachments are present. */
export function buildAttachmentNoticeLine(filenames: string[]): string {
  if (filenames.length === 0) return '';
  return filenames.length === 1
    ? `Please find attached the following file: ${filenames[0]}.`
    : `Please find attached the following files: ${filenames.join(', ')}.`;
}
