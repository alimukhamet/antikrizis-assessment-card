# Own-hosting handoff

This repository preserves the complete source and history of the Anti-Krizis
Assessment Card that was deployed as hosted version 64.

- Verified hosted source commit: `f03f20ba30752a295e7558107d3f486511b33414`
- Imported baseline tag: `sites-v64-source`
- Original hosted URL: `https://antikrizis-assessment-card.mukhamet-ali-ma.chatgpt.site`

The original hosted Site remains unchanged and should stay available as rollback
until the Anti-Krizis-owned deployment has passed migration and acceptance checks.

## Application stack

This is a React/Vinext server application deployed as a Cloudflare Worker. It is
not a static HTML page. The application expects:

- `DB`: D1/SQLite-compatible durable storage;
- `FILES`: private R2-compatible object storage;
- `ASSETS`: built static assets;
- `IMAGES`: image transformation for the Worker image route;
- Bitrix, session and assessment-intake configuration from `environment.example`.

The lowest-change independent deployment is a Cloudflare Worker in an
Anti-Krizis-owned account and domain, with Anti-Krizis-owned D1 and R2 resources.
For Node.js/PostgreSQL/S3 hosting, adapt `db/index.ts`,
`lib/documents/storage.ts`, the D1 repositories, dynamic `cloudflare:workers`
imports, and `worker/index.ts`.

## Before building for the new host

1. Replace the Sites-only project guard in `scripts/verify-canonical-target.mjs`
   deliberately. `.openai/hosting.json` records the old hosted Site and is not a
   destination-host configuration.
2. Replace the current Payment Control authentication origin in
   `lib/auth-provider.ts`.
3. Replace the Payment Control and GKB links in
   `templates/assessment-card.html`.
4. Provision the database and run every migration in `drizzle/` in order.
5. Provision private object storage and preserve object hashes, sizes and case
   ownership.
6. Store secrets in the host's secret manager, never in Git.

Use Node.js 22.13 or newer and the committed lockfile:

```sh
npm ci
npm test
npx tsc --noEmit
```

At import time, the production build passed, TypeScript passed, and 500 tests
passed with one fixture-dependent test skipped. The exact live baseline has six
ESLint errors and eight warnings; they were retained rather than silently
changing the imported source.

## Data migration boundary

This repository contains application source, database schema and migrations. It
does not contain production secrets, D1 rows, R2 objects, EDS keys, passwords,
Bitrix credentials or customer documents.

A production cutover requires a separate controlled migration: export the
required assessments and originals, validate counts and SHA-256 hashes, transfer
database and file state, recreate secrets securely, and verify saved drafts and
documents after reload. Read `EXPORT_FORMAT.md` before moving case evidence.
Never replay a pending, writing or uncertain Bitrix operation during migration;
resolve it by readback against its original destination.

Use only synthetic Bitrix deal `11665` for external-write acceptance tests.

