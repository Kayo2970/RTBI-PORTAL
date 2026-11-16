import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { GET as membersGET } from '../members/route';
import { GET as eventsGET } from '../events/route';
import { GET as tasksGET } from '../tasks/route';
import { GET as ratingsGET } from '../ratings/route';
import { GET as announcementsGET } from '../announcements/route';
import { GET as formsGET } from '../forms/route';
import { GET as formTemplatesGET } from '../form-templates/route';
import { GET as submissionsGET } from '../submissions/route';
import { GET as designsGET } from '../designs/route';
import { GET as groupPoliciesGET } from '../group-policies/route';
import { GET as accessLevelSettingsGET } from '../access-level-settings/route';
import { GET as systemSettingsGET } from '../system-settings/route';
import { GET as guestsGET } from '../guests/route';
import { GET as annualBudgetsGET } from '../annual-budgets/route';
import { GET as expensesGET } from '../expenses/route';
import { GET as invoicesGET } from '../invoices/route';
import { GET as incomeSourcesGET } from '../income-sources/route';
import { GET as auditLogsGET } from '../auditlogs/route';
import { GET as approvalRequestsGET } from '../approval-requests/route';
import { GET as bookingsGET } from '../bookings/route';
import { GET as roomsGET } from '../rooms/route';

/**
 * GET /api/data — the aggregate the client polls (syncWithServer in src/lib/local-data.ts) to hydrate its localStorage collections.
 *
 * It deliberately adds NO permission logic of its own: every collection is fetched through that collection's own GET handler, called
 * with the same request (Bearer token included), so each route's session check, per-viewer filtering and permission rules apply exactly
 * as they do when the page calls the route directly (members never carry passwordHash; audit logs, group policies, access settings,
 * income sources and form templates only come back for viewers who may see them, etc.). A handler that refuses (403) or fails just
 * leaves its key out — the client ignores missing keys.
 *
 * Collections with no route/permission model (event reports, passes, sessions, reset tokens, SMTP/wallet settings, email logs, and
 * every incubation collection, which has its own server-first API) are intentionally NOT served here.
 */
const SOURCES: Record<string, (request: Request) => Promise<Response>> = {
  members: membersGET,
  events: eventsGET,
  tasks: tasksGET,
  ratings: ratingsGET,
  announcements: announcementsGET,
  forms: formsGET,
  formTemplates: formTemplatesGET,
  submissions: submissionsGET,
  designs: designsGET,
  groupPolicies: groupPoliciesGET,
  accessLevelSettings: accessLevelSettingsGET,
  systemSettings: systemSettingsGET,
  guests: guestsGET,
  annualBudgets: annualBudgetsGET,
  expenses: expensesGET,
  invoices: invoicesGET,
  incomeSources: incomeSourcesGET,
  auditLogs: auditLogsGET,
  approvalRequests: approvalRequestsGET,
  bookings: bookingsGET,
  rooms: roomsGET,
};

export async function GET(request: Request) {
  try {
    await requireSession(request); // 401 for a missing/expired/terminated session — the client then signs the user out

    const entries = await Promise.all(
      Object.entries(SOURCES).map(async ([key, handler]): Promise<[string, unknown] | null> => {
        try {
          const res = await handler(request);
          if (!res.ok) return null; // not permitted for this viewer (or failed) — omit the key
          const data = await res.json();
          return Array.isArray(data) ? [key, data] : null;
        } catch (err) {
          console.error(`[api/data] ${key} failed:`, err);
          return null;
        }
      })
    );

    return NextResponse.json(Object.fromEntries(entries.filter((e): e is [string, unknown] => e !== null)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return apiError(err, 'data-api-get', 500);
  }
}
