import { z } from 'zod';
import type { ZodType } from 'zod';

/**
 * validation.ts — strict schema validation for API request bodies. Routes
 * previously accepted whatever shape of JSON a client sent and merged it
 * straight into a record (see e.g. members/[id]/route.ts's `{ ...next[idx],
 * ...updates }`) — sanitizing/escaping stray fields isn't the same as
 * rejecting a request that doesn't match the expected shape at all, which
 * is what this enforces: parse with a Zod schema, and anything that
 * doesn't validate (wrong type, too long, missing a required field, an
 * unrecognized field on a `.strict()` schema) is rejected with a 400
 * before it ever reaches business logic.
 */
export class ValidationError extends Error {
  status = 400;
  issues: string[];
  constructor(issues: string[]) {
    super(issues[0] || 'The request body is invalid.');
    this.issues = issues;
  }
}

/**
 * Member create/update schema. The Member type (local-data.ts) has 25+
 * optional fields covering several distinct workflows (avatar upload,
 * approval routing, etc.) — rather than a `.strict()` schema
 * that would need to enumerate every one of them exactly (and risk quietly
 * rejecting a legitimate field a future feature adds), this validates the
 * TYPE, FORMAT, and LENGTH of every field it recognizes, and uses
 * `.passthrough()` for the rest rather than `.strict()`. That's a
 * deliberate, narrower scope than full closed-schema validation: it stops
 * a malformed/malicious payload (wrong types, an absurdly long string, an
 * out-of-range tier), but doesn't reject an unrecognized-but-harmless
 * extra field the way a fully strict schema would. Full strict coverage of
 * every route's body is a larger, separate effort — see the audit notes.
 */
const MemberDivisionEnum = z.enum(['Super User', 'CEO', 'Employee', 'Startup']);

export const MemberWriteSchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().min(1).max(254).email().optional(),
  role: z.string().trim().max(200).optional(),
  tier: z.number().int().min(1).max(4).optional(),
  division: MemberDivisionEnum.optional(),
  committee: z.string().trim().max(200).optional(),
  department: z.string().trim().max(200).optional(),
  program: z.string().trim().max(200).optional(),
  batch: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(32).optional(),
  dateOfBirth: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  status: z.enum(['Active', 'Terminated']).optional(),
  avatarData: z.string().max(3_000_000).optional(), // base64 data URL — file-size cap enforced separately server-side
  avatarFileName: z.string().trim().max(300).optional(),
  avatarUrl: z.string().trim().max(2000).optional(),
  mustSetupPassword: z.boolean().optional(),
  cardEnabled: z.boolean().optional(),
  // Super-User-only free-text designation override — enforced server-side
  // in members/[id]/route.ts, not here (this schema doesn't know who the
  // actor is).
  cardDesignationOverride: z.string().trim().max(200).optional(),
  cardPhone: z.string().trim().max(32).optional(),
  cardSocials: z.object({
    linkedin: z.union([z.literal(''), z.string().trim().max(300).url()]).optional(),
    customLinks: z.array(z.object({
      label: z.string().trim().min(1).max(60),
      url: z.string().trim().max(300).url(),
      icon: z.string().trim().max(40),
      customIconUrl: z.string().trim().max(2000).optional(),
      customIconStorageKey: z.string().trim().max(500).optional(),
      customIconData: z.string().max(1_400_000).optional(), // base64 data URL — small icon badge, capped well below the card photo's 3MB
      customIconFileName: z.string().trim().max(300).optional(),
    })).max(5).optional(),
  }).optional(),
  cardPhotoData: z.string().max(3_000_000).optional(), // base64 data URL — file-size cap enforced separately server-side
  cardPhotoFileName: z.string().trim().max(300).optional(),
  cardPhotoUrl: z.string().trim().max(2000).optional(),
}).passthrough();

/** Parse `request`'s JSON body against `schema`, throwing ValidationError (caught by api-error.ts) on any mismatch. */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError(['Request body must be valid JSON.']);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`);
    throw new ValidationError(issues);
  }
  return result.data;
}
