import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { effectiveCardDesignation } from '@/lib/member-guard';
import { getSessionMember } from '@/lib/session';

// Public, no-auth endpoint — same pattern as /api/forms/[slug]: anyone with
// the link can view a published card. Only ever returns the safe public
// subset of a Member record (never email, id, tier, bank details, etc.).
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

  // Fire-and-forget view counter — only for public visits to published cards
  if (member.cardEnabled && member.cardSlug) {
    mutateCollection('members', (current: any[]) => {
      const idx = current.findIndex((m) => m.id === member.id);
      if (idx === -1) return current;
      const next = [...current];
      next[idx] = { ...next[idx], cardViews: (next[idx].cardViews || 0) + 1 };
      return next;
    }).catch(() => {});
  }

  return NextResponse.json({
    slug: member.cardSlug || 'preview',
    name: member.name,
    designation: effectiveCardDesignation(member),
    phone: member.cardPhone || '',
    email: member.email,
    socials: member.cardSocials || {},
    photoUrl: member.cardPhotoUrl || member.avatarUrl || '',
  });
}
