import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { readStoredFile, guessMimeType } from '@/lib/file-storage';
import { effectiveCardDesignation } from '@/lib/member-guard';
import { getSessionMember } from '@/lib/session';

// Escapes a value for use inside a VCARD 3.0 text field (RFC 6350 §3.4):
// backslash, comma, semicolon and newline must be backslash-escaped.
function escapeVCardText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n');
}

// RFC 2426 §5.8.1: a content line longer than 75 octets is folded by
// inserting CRLF followed by a single leading space before continuing —
// the base64 PHOTO line is easily thousands of characters, well past that.
function foldVCardLine(line: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < line.length; i += 75) {
    chunks.push(line.slice(i, i + 75));
  }
  return chunks.join('\r\n ');
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const cleanSlug = decodeURIComponent(slug || '').trim().toLowerCase();
  const members = await readCollection<any>('members');
  const actor = await getSessionMember(request);

  let member = members.find((m) => m.cardSlug && m.cardSlug.toLowerCase() === cleanSlug);
  if (!member && cleanSlug === 'preview' && actor) {
    member = actor;
  }

  const isOwnerOrAdmin = actor && member && (actor.id === member.id || actor.role === 'SUPER_USER' || actor.tier === 1);

  if (!member || member.status === 'Terminated' || (!member.cardEnabled && !isOwnerOrAdmin)) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 });
  }

  const nameParts = (member.name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ');
  const socials = member.cardSocials || {};

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeVCardText(lastName)};${escapeVCardText(firstName)};;;`,
    `FN:${escapeVCardText(member.name || '')}`,
    'ORG:RTBI Portal',
  ];
  const designation = effectiveCardDesignation(member);
  if (designation) {
    lines.push(`TITLE:${escapeVCardText(designation)}`);
  }
  if (member.cardPhone) {
    lines.push(`TEL;TYPE=CELL:${escapeVCardText(member.cardPhone)}`);
  }
  if (member.email) {
    lines.push(`EMAIL:${escapeVCardText(member.email)}`);
  }
  if (socials.linkedin) lines.push(`URL;TYPE=LinkedIn:${escapeVCardText(socials.linkedin)}`);
  for (const link of socials.customLinks || []) {
    lines.push(`URL;TYPE=${escapeVCardText(link.label)}:${escapeVCardText(link.url)}`);
  }

  // The photo the member set on their own card (falling back to their
  // profile photo if they never set a card-specific one) — embedded inline
  // as base64 so the contact still has a photo even offline, rather than a
  // URL reference that depends on this server staying reachable.
  const photoStorageKey = member.cardPhotoStorageKey || member.avatarStorageKey;
  const photoFileName = member.cardPhotoUrl || member.avatarUrl || '';
  if (photoStorageKey) {
    try {
      const photoBuffer = await readStoredFile(photoStorageKey);
      const mime = guessMimeType(photoFileName || photoStorageKey);
      const type = (mime.split('/')[1] || 'jpeg').toUpperCase();
      const base64Photo = photoBuffer.toString('base64');
      lines.push(foldVCardLine(`PHOTO;ENCODING=b;TYPE=${type}:${base64Photo}`));
    } catch {
      // Missing/unreadable file on disk shouldn't break the whole vCard —
      // just skip the photo.
    }
  }

  lines.push('END:VCARD');

  const body = lines.join('\r\n') + '\r\n';

  // ?inline=1 lets iOS Safari open the native "Add to Contacts" sheet instead of saving a file
  const inline = new URL(request.url).searchParams.get('inline') === '1';

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${member.cardSlug || 'contact'}.vcf"`,
    },
  });
}
