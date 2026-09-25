# Profile collection and save-without-contract

Additive capability inside the existing Assessment Card. It collects the client
-profile facts the owner asked sales to ask and persists them so the signed CRM
boundary can carry them **without generating a contract, without EDS and without
document generation**. The contract/EDS flow is not changed.

## Owner decisions honoured

| Section | Decision | Implementation |
|---|---|---|
| Addresses | registration (прописка) + actual only; postal is a CRM-side legal decision | `addressRegistration`, `addressActual`, `addressActualSame` |
| Employment | salary figure is enough; no detailed records | no new key; existing `n8001`/`n8002` salary rows are already mapped |
| Enforcement | structured with numbers | `enforcementStatus` + `enforcements` group (`enforcementCreditor`, `enforcementAmount`, `enforcementNote`) |
| Risks | free comment only | `riskNotes` |
| Recurring GKB | out of scope | not built |

## Answer keys and their sources

- `enforcementStatus`, group `enforcements` with `enforcementCreditor` /
  `enforcementAmount` / `enforcementNote`: the CRM read-only intake field map
  already declares exactly these keys and the `enforcementRecords` condition
  (`apps/platform/src/after-sales/intake-profile-fields.ts` at `c58aa43`). The
  card now produces them.
- `addressRegistration`, `addressActual`, `addressActualSame`: proposed in the
  owner study `documentologist-fill-tool-design.md` §2.1; no CRM field map entry
  exists yet, so the CRM patch adds them.
- `riskNotes`: proposed in `documentologist-fill-tool-design.md` §2.5.
- Salary: **no new key invented.** The card already collects salary as
  `clientjobs.n8001` / `partnerjobs.n8002`; the owner rejected detailed
  employment records and no source defines a single profile-level salary key.

## Contract path is untouched

- New scalars are `data-optional`; the `enforcements` group is marked
  `data-profile-only` and is skipped by `checkAnswers`, so it can never add a
  readiness gate to «Скачать договор».
- `SubmissionRepository.latest` / `active` are restricted to `kind='contract'`,
  so profile rows never enter the contract lane (reconcile, resume, download).
- The profile save uses a separate `kind='profile'` row and its own validation
  (`checkProfileAnswers`), not `finalCheck`/`checkAnswers`.

## Save-without-contract path

1. New button **«Сохранить профиль в CRM (без договора)»** saves the draft and
   POSTs `{ action: 'profile' }` to the existing
   `/api/assessment/:dealId/submission` route.
2. The server validates the profile-only keys and persists a durable, auditable
   `assessment_submissions` row (`kind='profile'`, `state='verified'`,
   `outcome_code='PROFILE_SAVED_NO_CONTRACT'`, payload `profileOnly: true`).
3. The **existing signed boundary** then carries the snapshot: the card pushes it
   with `syncAssessmentIntake` (same HMAC secret, same origins, same envelope
   version 1), and the pull selector serves it when no contract snapshot exists.
   No new endpoint, no contract data, no EDS, no document bytes.
4. Persistence is atomic and idempotent (request id + content hash); a repeated
   click or reload converges on the same row.
5. Fail closed: the row is committed before any CRM call. A failed/partial CRM
   transfer returns `pending`, leaves the verified row intact and is resolved by
   retry — never by a partial "sent" claim.

## Database

`drizzle/0011_foamy_sister_grimm.sql`:
`ALTER TABLE assessment_submissions ADD kind text DEFAULT 'contract' NOT NULL;`
Applies to existing rows as `contract`, so the contract lane is unchanged.

## Verification (exact)

- `npm ci` — clean.
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- `npm run build` — production build complete.
- `node --test tests/*.test.mjs` — **616 tests, 615 pass, 0 fail, 1 skipped**
  (the documented fixture-dependent skip).
- New focused suite `tests/profile-collection.test.mjs` (10 tests): new keys,
  profile readiness, fail-closed persistence, contract-lane isolation, export
  conversion, push without artifacts, failed-prepare no-finalize.
- Two existing test expectations were updated because they are strict
  structural loaders, not contract behaviour: `operations-ui.test.mjs` group
  count `18 -> 19`, and `contract-operation-route.test.mjs` registers the two
  new route imports.

## Deploy steps (owner's own hosting flow)

1. Apply the DB migration before/with the deploy:
   `npm run db:migrate:anti-krizis`
   (`wrangler d1 migrations apply DB --remote --config wrangler.anti-krizis.jsonc`).
2. Build and deploy the Anti-Krizis target:
   `npm run deploy:anti-krizis`
3. Do **not** deploy to `https://assessment.anti-krizis.kz` from this branch until
   the migration and build are reviewed; the live sales app is used daily.
4. Confirm the existing `ASSESSMENT_INTAKE_*` / HMAC configuration is present so
   the profile push is enabled; without it the profile still saves card-side and
   reports "передача в CRM не настроена".

## CRM-side patch

See `crm-side/README.md` and
`crm-side/assessment-intake.profile-collection.patch`. The CRM repo owner must
apply it; this repository does not modify the CRM.
