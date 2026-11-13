import { NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { purgeMemberArtifacts } from '@/lib/cascade-delete';
import { deleteStoredFile, saveBase64File } from '@/lib/file-storage';
import { requireSession } from '@/lib/session';
import { getAccessLevelSettingsServer, canEditDirectory, canTerminateMember, isSuperUser } from '@/lib/permissions-server';
import { invalidateAllSessionsForMember } from '@/lib/session';
import { isRootSuperUser, countActiveSuperUsersServer, PRIVILEGED_FIELDS } from '@/lib/member-guard';
import { parseJsonBody, MemberWriteSchema } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_CUSTOM_ICON_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'member';
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const updates: any = await parseJsonBody(request, MemberWriteSchema);

    delete updates.passwordHash; // never settable through this route
    // Server-managed wallet-pass cache (see card-wallet-pass.ts) — never
    // settable through this route either. MemberWriteSchema is a passthrough
    // schema (see validation.ts), so without this a client could otherwise
    // point cardPassAppleUrl at an arbitrary storage key and have the
    // apple-pass route serve that file back as their .pkpass download.
    delete updates.cardPassSerial;
    delete updates.cardPassContentHash;
    delete updates.cardPassAppleUrl;
    delete updates.cardPassAppleStorageKey;
    delete updates.cardPassGoogleSaveUrl;
    delete updates.cardPassGenerations; // rate-limit bookkeeping — never client-writable
    // The card's designation free-text override is Super-User-only — anyone
    // else's card keeps mirroring their Directory role regardless of what
    // they send here.
    if ('cardDesignationOverride' in updates && !isSuperUser(actor)) {
      delete updates.cardDesignationOverride;
    }

    const isSelf = actor.id === id;
    const settings = await getAccessLevelSettingsServer();
    const hasDirectoryEdit = canEditDirectory(actor, settings);
    const touchesPrivilegedField = PRIVILEGED_FIELDS.some(f => f in updates);

    if (touchesPrivilegedField && !hasDirectoryEdit) {
      return NextResponse.json({ error: "You don't have permission to change a member's tier, role, status, or department — including your own." }, { status: 403 });
    }
    if (!touchesPrivilegedField && !isSelf && !hasDirectoryEdit) {
      return NextResponse.json({ error: "You don't have permission to edit this member's record." }, { status: 403 });
    }
    if ('status' in updates && updates.status === 'Terminated' && !canTerminateMember(actor, settings)) {
      return NextResponse.json({ error: "You don't have permission to terminate members." }, { status: 403 });
    }

    // Persist a newly uploaded profile photo as a real file on disk under
    // data/uploads/, same as guests' visiting cards and design submissions —
    // never keep the raw base64 payload inline in members.json.
    if (typeof updates.avatarData === 'string' && updates.avatarData.startsWith('data:')) {
      const approxSize = Math.ceil((updates.avatarData.length * 3) / 4);
      if (approxSize > MAX_AVATAR_SIZE_BYTES) {
        return NextResponse.json({ error: 'Profile photo exceeds the 2 MB maximum limit.' }, { status: 400 });
      }
      const stored = await saveBase64File('members', id, 0, updates.avatarFileName || 'avatar.jpg', updates.avatarData);
      updates.avatarUrl = stored.url;
      updates.avatarStorageKey = stored.storageKey;
    }
    delete updates.avatarData;
    delete updates.avatarFileName;

    // Same treatment for the digital visiting card's own photo — stored under
    // a different index (1) in the member's upload folder so it never collides
    // with the avatar (index 0) saved above.
    if (typeof updates.cardPhotoData === 'string' && updates.cardPhotoData.startsWith('data:')) {
      const approxSize = Math.ceil((updates.cardPhotoData.length * 3) / 4);
      if (approxSize > MAX_AVATAR_SIZE_BYTES) {
        return NextResponse.json({ error: 'Card photo exceeds the 2 MB maximum limit.' }, { status: 400 });
      }
      const stored = await saveBase64File('members', id, 1, updates.cardPhotoFileName || 'card-photo.jpg', updates.cardPhotoData);
      updates.cardPhotoUrl = stored.url;
      updates.cardPhotoStorageKey = stored.storageKey;
    }
    delete updates.cardPhotoData;
    delete updates.cardPhotoFileName;

    // Persist any freshly-uploaded custom-link icon (see visiting-card
    // page's "Upload custom icon" control) as a real file on disk, same
    // treatment as the avatar/card photo above — one saveBase64File call
    // per row that carries a new customIconData payload, indexed by its
    // position in the array under its own storage category so it never
    // collides with the avatar (index 0) or card photo (index 1) above.
    if (updates.cardSocials && Array.isArray(updates.cardSocials.customLinks)) {
      for (let i = 0; i < updates.cardSocials.customLinks.length; i++) {
        const link = updates.cardSocials.customLinks[i];
        if (typeof link.customIconData === 'string' && link.customIconData.startsWith('data:')) {
          const approxSize = Math.ceil((link.customIconData.length * 3) / 4);
          if (approxSize > MAX_CUSTOM_ICON_SIZE_BYTES) {
            return NextResponse.json({ error: `Custom link icon "${link.label || `#${i + 1}`}" exceeds the 1 MB maximum limit.` }, { status: 400 });
          }
          const stored = await saveBase64File('card-link-icons', id, i, link.customIconFileName || `icon-${i}.png`, link.customIconData);
          link.customIconUrl = stored.url;
          link.customIconStorageKey = stored.storageKey;
        }
        delete link.customIconData;
        delete link.customIconFileName;
      }
    }

    let previousStorageKey: string | undefined;
    let previousCardPhotoStorageKey: string | undefined;
    // Set-based (not positional) since custom-link rows can be reordered or
    // removed between saves — computed inside the mutator below, from
    // whatever the record's customLinks looked like just before this merge.
    let previousCustomIconStorageKeys: Set<string> = new Set();
    // Upsert: if this id isn't in the server's collection yet (e.g. client-bundled
    // sample/seed data never POSTed), create it instead of 404ing and silently
    // dropping the edit.
    const updated = await mutateCollection('members', (current) => {
      const idx = current.findIndex((m: any) => m.id === id);
      if (idx === -1) {
        return [...current, { id, ...updates }];
      }
      const next = [...current];
      if (updates.avatarStorageKey && next[idx].avatarStorageKey && next[idx].avatarStorageKey !== updates.avatarStorageKey) {
        previousStorageKey = next[idx].avatarStorageKey;
      }
      if (updates.cardPhotoStorageKey && next[idx].cardPhotoStorageKey && next[idx].cardPhotoStorageKey !== updates.cardPhotoStorageKey) {
        previousCardPhotoStorageKey = next[idx].cardPhotoStorageKey;
      }
      if (updates.cardSocials && Array.isArray(updates.cardSocials.customLinks)) {
        previousCustomIconStorageKeys = new Set(
          (next[idx].cardSocials?.customLinks || []).map((l: any) => l.customIconStorageKey).filter(Boolean)
        );
      }
      const merged = { ...next[idx], ...updates };

      // First time the card is enabled, mint a stable public slug — done here
      // (inside the mutator) so it can see the full collection and dedupe
      // against every other member's slug before it's ever exposed publicly.
      if (updates.cardEnabled === true && !merged.cardSlug) {
        const base = slugifyName(merged.name || 'member');
        const taken = new Set(next.filter((m: any) => m.id !== id).map((m: any) => m.cardSlug).filter(Boolean));
        let slug = base;
        while (taken.has(slug)) {
          slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        }
        merged.cardSlug = slug;
      }

      // Invariant 1: The root Super User ALWAYS remains a Super User (tier 1, Active)
      if (isRootSuperUser(next[idx]) || isRootSuperUser(merged)) {
        merged.tier = 1;
        if (merged.status === 'Terminated') {
          merged.status = 'Active';
        }
      }

      next[idx] = merged;

      // Invariant 2: Ensure at least one active Super User  remains
      if (countActiveSuperUsersServer(next) < 1) {
        throw new Error('Action blocked: System must always maintain at least one active Super User .');
      }

      return next;
    });

    if (previousStorageKey) {
      await deleteStoredFile(previousStorageKey);
    }
    if (previousCardPhotoStorageKey) {
      await deleteStoredFile(previousCardPhotoStorageKey);
    }
    if (previousCustomIconStorageKeys.size > 0) {
      const newCustomIconStorageKeys = new Set(
        (updates.cardSocials?.customLinks || []).map((l: any) => l.customIconStorageKey).filter(Boolean)
      );
      for (const key of previousCustomIconStorageKeys) {
        if (!newCustomIconStorageKeys.has(key)) {
          await deleteStoredFile(key);
        }
      }
    }

    if (updates.status === 'Terminated') {
      await invalidateAllSessionsForMember(id);
    }

    return NextResponse.json(updated.find((m: any) => m.id === id));
  } catch (err: any) {
    return apiError(err, 'members-id-api-patch', 400);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canEditDirectory(actor, settings)) {
      return NextResponse.json({ error: "You don't have permission to delete members." }, { status: 403 });
    }
    const { id } = await params;
    const force = new URL(request.url).searchParams.get('force') === 'true';
    let found = false;
    let deletedEmail: string | undefined;
    await mutateCollection('members', (current) => {
      const target = current.find((m: any) => m.id === id);
      if (!target) return current;
      deletedEmail = target.email;

      if (isRootSuperUser(target) && !force) {
        throw new Error('The root Super User account is protected and cannot be deleted.');
      }

      const filtered = current.filter((m: any) => m.id !== id);
      if (countActiveSuperUsersServer(filtered) < 1) {
        throw new Error('Action blocked: System must always maintain at least one active Super User .');
      }

      found = filtered.length < current.length;
      return filtered;
    });
    if (!found) return NextResponse.json({ error: 'Not found or protected' }, { status: 404 });
    await invalidateAllSessionsForMember(id);
    await purgeMemberArtifacts(id, deletedEmail);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'members-id-api-delete');
  }
}
