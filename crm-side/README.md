# CRM-side companion patch (proposal — CRM repo owner must apply)

The card-side change is additive and works with the **current** CRM for the
existing contract flow. This patch is only needed to populate the new structured
profile sections (addresses, enforcement) and the free-text risk note from the
envelope the card already sends over the signed `crm-intake` boundary.

- File: `apps/platform/src/crm/assessment-intake.ts`
- Base read from: `origin/feat/assessment-post-accept-attach` = `c58aa43`
  (`git show c58aa43:apps/platform/src/crm/assessment-intake.ts`)
- Patch: [`assessment-intake.profile-collection.patch`](./assessment-intake.profile-collection.patch)

## What the patch changes

1. `supportedScalars` gains `addressRegistration`, `addressActual`,
   `addressActualSame`, `enforcementStatus`, `riskNotes`. Without this the new
   answers land in `source.unmappedAnswerKeys` only.
2. `supportedGroups` gains `enforcements`
   (`enforcementCreditor`, `enforcementAmount`, `enforcementNote`).
3. Addresses: `clientInfo.registrationAddress` / `actualAddress` are filled from
   the envelope (they were hardcoded `''`) and two `records.addresses` rows are
   built with `kind` values from `PROFILE_ADDRESS_KINDS`
   (`Адрес регистрации`, `Адрес проживания`).
4. Enforcement: each row becomes a `records.creditors` record using the existing
   `enforcement` slot. The CRM profile model has **no standalone enforcement
   section**, so this is the only structured home today; a dedicated section is a
   separate model decision.
5. Risks: the free-text `riskNotes` is written to `profile.assessmentNote` (the
   nearest existing home; `ClientProfileData` has no risk field).

No contract/EDS field, no envelope version change, no new endpoint. The
`source.unmappedAnswerKeys`/`mappedFactCount` bookkeeping keeps working.

## Tests the CRM owner should add (in the CRM repo)

Use the existing `mapAssessmentIntake` test fixtures and add a profile-complete
envelope (synthetic only):

- `addressRegistration`/`addressActual` produce `clientInfo.registrationAddress`
  / `clientInfo.actualAddress` and two `records.addresses` rows.
- `addressActualSame: true` with an empty `addressActual` yields the registration
  address as the actual address.
- `enforcementStatus: 'yes'` with one `enforcements` row yields a
  `records.creditors` record whose `values.amount` is the number and whose
  `values.enforcement` is set; `note` carries the free text.
- `riskNotes` lands in `profile.assessmentNote`.
- A profile-only envelope (kind `profile`) still maps without contract fields,
  and `mapAssessmentIntake` stays append-only/idempotent through
  `mergeAssessmentClientInfo`.

## Why the CRM is not required for the existing sales flow

The card pushes/pulls the same `assessment-intake` envelope version `1`. Until
this patch is applied, the CRM still accepts and stores the envelope; the new
keys are reported as unmapped and remain visible in the read-only intake view.
The existing contract download is unchanged and independent of the CRM.
