@AGENTS.md

# CLAUDE.md — RTBI Portal

Next.js (App Router) portal for RTBI. Flat encrypted JSON-file DB under `data/` (gitignored).

## Commands
```bash
npm run dev        # dev server on :3030
npx tsc --noEmit   # type-check
npm run build      # production build — must pass before any push
npm run setup      # one-time Super User + DATA_ENCRYPTION_KEY bootstrap (or use /setup in the browser)
npm run wipe       # clean wipe all application data, memory, and uploads
```
No test suite: type-check + build passing is the acceptance bar.

## Client sync (`/api/data`)
localStorage-backed pages hydrate from `GET /api/data` (polled by `syncWithServer` in `src/lib/local-data.ts`). That route adds no permission logic of its own: it
calls each collection's own GET handler, so per-viewer rules are identical to the per-collection routes, and a refused collection is simply omitted. Add a collection
there only if it has its own permission-checked GET route. `.gitignore` anchors the runtime DB as `/data/` — an unanchored `data/` once swallowed `src/app/api/data/`.

## Four-tier model (lower number = more access)
1 Super User · 2 CEO · 3 Employee · 4 Startup. `Member.division` mirrors the tier name.
All checks live in `src/lib/permissions.ts` (client) and `src/lib/permissions-server.ts` (API routes).
**Phase 1 is blanket access**: every signed-in user may use every module; only account administration
(add/terminate members, password overrides, email settings, group policies) is Super User only.
To restrict a module later, tighten the matching `can*()` function — pages don't need to change.
The root Super User (id `m1`, created at setup) can never be demoted or deleted.

## Ported modules
Mail (Email Management), Dashboard, Calendar, Events, Tasks, Approvals, Proposals, Ratings, Design Portal,
Visiting Card, Finance (`/dashboard/finance` — annual budget, expenses with IDN drafter, income; old `/dashboard/budget` and `/dashboard/expenses` redirect here), Invoices, Public Forums (`/dashboard/forms`), Announcements, Guest Directory,
Group Policies, Settings, plus a new Users page (`/dashboard/users`).

## Git workflow
Develop on the feature branch, open a draft PR, and merge to `main` only when asked. Run `npx tsc --noEmit`
and `npm run build` before pushing.

## Incubation module (RTBI SOPs)
Server-first (not the localStorage pattern). Pure rules/types in `src/lib/incubation/` (`types.ts`, `rules.ts`, `kinds.ts`, `onboarding.ts`),
server helpers `*-server.ts`, routes `src/app/api/incubation/*` (+ public intake `src/app/api/public/applications`, page `/apply`), pages `src/app/dashboard/incubation/*`.
- Settings (`incubationSettings`): scorecard/graduation weights, thresholds, timers, KPI targets, fee schedules — all seeded **proposed**; approving needs an approval reference. Decisions can't be finalised while the selection scorecard is Proposed.
- Collections: `startups`, `applications`, and one generic store `incubationRecords` keyed by `kind` (agreement, review, trl, renewal, graduation, exit, evidence, mentor, mentorSession, cohort, milestone, programEvent, partnership, meeting, incident, onboarding). Add a register by adding a `KINDS` entry in `kinds.ts` — API and page are generic.
- Guardrails live in `kinds.ts` `validate`/`derive` and the routes: Red RAG never changes status; TRL needs evidence and Low confidence stays Provisional; `Active` is set only by the onboarding activation gate; evaluators pass a COI hard gate and can't see peer scores before submitting; adverse action needs legal review, notice, response period and approval.
- Selection decisions can be approved/rejected from the Approvals inbox (`entityType: 'incubation'`): approve = `finalise` with the note as the approval reference; reject = `rejectDecision`. The inbox row is only marked decided after the server accepts it.
- External reviewers: a tier-3 member with `externalReviewer: true` (Users page, privileged field) can only reach the applications API (assigned applications, behind the COI gate); every other incubation API uses `isInternalStaff`, and the shell shows them only Applications/Settings/Approvals. Legacy LEADS modules are still Phase-1 blanket access server-side.
- Consent: `/api/incubation/evidence-export` names a startup / links a document only where consent is recorded (startup `consent.externalDisclosure`, and the evidence record's consent for links); restricted evidence is never exported.
- Ratings page has a "Startup scorecards" tab (`components/incubation/scorecards-panel.tsx`); `record` field type (`refKind`) lets a register point at another (e.g. mentor session -> mentor).
- Daily digest scheduler: `src/lib/incubation/scheduler.ts` (registered in `instrumentation.ts`); bell + Calendar read `/api/incubation/alerts` and `/api/incubation/calendar`.
- Never hard-code approvers or fees; use settings. Label forms by name + SOP code, not annexure letter. Committee name is "Project Management Committee".
