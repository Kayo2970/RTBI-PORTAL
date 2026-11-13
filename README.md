# RTBI Portal

Four-tier portal (Super User, CEO, Employee, Startup) built on Next.js, React and Tailwind, with an
AES-256-GCM encrypted JSON-file datastore.

## First run
```bash
npm install
npm run dev          # http://localhost:3030
```
Open `/setup` (or run `npm run setup`) to create the root Super User and generate `DATA_ENCRYPTION_KEY`
(written to `.env`). Back that key up: without it the data files cannot be decrypted.

See `CLAUDE.md` for architecture and the tier/permission model.
