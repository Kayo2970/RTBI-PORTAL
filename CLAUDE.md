@AGENTS.md

# CLAUDE.md — RTBI Portal

Next.js (App Router) portal ported from the LEADS ERP. Flat encrypted JSON-file DB under `data/` (gitignored).

## Commands
```bash
npm run dev        # dev server on :3030
npx tsc --noEmit   # type-check
npm run build      # production build — must pass before any push
npm run setup      # one-time Super User + DATA_ENCRYPTION_KEY bootstrap (or use /setup in the browser)
```
No test suite: type-check + build passing is the acceptance bar.

## Four-tier model (lower number = more access)
1 Super User · 2 CEO · 3 Employee · 4 Startup. `Member.division` mirrors the tier name.
All checks live in `src/lib/permissions.ts` (client) and `src/lib/permissions-server.ts` (API routes).
**Phase 1 is blanket access**: every signed-in user may use every module; only account administration
(add/terminate members, password overrides, email settings, group policies) is Super User only.
To restrict a module later, tighten the matching `can*()` function — pages don't need to change.
The root Super User (id `m1`, created at setup) can never be demoted or deleted.

## Ported modules
Mail (Email Management), Dashboard, Calendar, Events, Tasks, Approvals, Proposals, Ratings, Design Portal,
Visiting Card, Reimbursements, Budget, Public Forums (`/dashboard/forms`), Announcements, Guest Directory,
Group Policies, Settings, plus a new Users page (`/dashboard/users`).

## Git workflow
Develop on the feature branch, open a draft PR, and merge to `main` only when asked. Run `npx tsc --noEmit`
and `npm run build` before pushing.
