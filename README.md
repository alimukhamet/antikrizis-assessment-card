# Antikrizis assessment and document intake

For deployment outside ChatGPT Sites, start with
[OWN_HOSTING_HANDOFF.md](OWN_HOSTING_HANDOFF.md) and
[environment.example](environment.example).

Fourth tool on the existing Assessment Card Site. Publication alongside the existing three tools was authorized on 14 September 2026. The original contract, document-upload and credit-report entries remain available; this is not a retirement of the old workflow.

Canonical Site: https://antikrizis-assessment-card.mukhamet-ali-ma.chatgpt.site

## Worker flow

1. Sign in using the existing payment-control worker selection and password.
2. Open a deal; the server establishes the client IIN from Bitrix.
3. Select the existing required documents. Digital PDF text is extracted and cached; recognized answers keep document and page references.
4. Check document ownership, type, periods and conflicts. Ask the client for unanswered information. Preserve whether a value came from a document or a client answer.
5. Draft answers and ordinary original files are saved in D1/R2. They are not sent to Bitrix just because the employee leaves or reloads the draft.
6. Click «Скачать договор»: complete required checks, upload documents/EDS through the existing handoff, save the assessment, verify Bitrix readback and history, then download the saved contract.
7. Use «Сообщить об ошибке» to report a problem without changing the client assessment. Ali sees all reports at `/assessment-feedback`; other workers see their own.

Documents, drafts, inspections, submissions and upload receipts are separate records. A timeout does not prove that an external write failed. Retrying recovers the original operation. An owner can cancel an upload only while the server can prove it never started; cancellation remains available after reopening the case.

## Profile backfill (Документолог, one-time)

`/profile-backfill` lists every category `1` deal on a «ЗВИ…» or «В ожидании» stage, unfinished first, newest Дата ЗВИ first. Opening a deal runs the same questionnaire in `mode=profile`:

- deal documents are pulled from Bitrix and read automatically; the old text card (`UF_CRM_AI_CARD`) is shown read-only next to the answers;
- ФИО, телефон, семейное положение and процедура are prefilled from Bitrix; contract and payment questions are hidden;
- extra profile questions: addresses, phone and channel, family members with birth dates, employer names;
- «Не знаю» saves an open question («Требует уточнения») instead of blocking the save;
- «Сохранить профиль» writes only `UF_CRM_1773669702495` (ФИО), `UF_CRM_AI_MARITAL`, `UF_CRM_AI_DEBT` and the new `UF_CRM_ANK_PROFILE_CARD` / `UF_CRM_ANK_PROFILE_JSON` / `UF_CRM_ANK_PROFILE_AT`, with conflict detection and readback. Contract, payment, procedure and the old card are never written. The previous values are kept in `assessment_profile_saves` and posted as a deal timeline comment.

Before first use: apply migration `0011` (`npm run db:migrate:anti-krizis`), then Ali or Darkhan opens `/profile-backfill` and clicks «Создать поля в Bitrix» (needs a webhook with admin rights). Test writes only on synthetic deal 11665.

## Confirmed business rules

- Preserve the canonical document list, contract/payment rules and downstream assessment format.
- GKB reports must be generated within exactly 30 days of assessment; future dates are rejected.
- ENPF inspection requires three years of coverage through its issue date.
- Match the client IIN against trusted deal data. A filename or matching name alone does not establish ownership or authenticity.
- Powers of attorney must identify the approved Aizhan representative or Aplus corporate entity. Server checks do not prove execution or authenticity.
- Sales may ask the client and explicitly confirm unclear debt amounts, preserving client-confirmed provenance rather than describing them as documentary facts.
- Keep the old EDS handoff. Key/password do not enter ordinary PDF extraction or drafts. Legacy CRM filenames contain the sanitized password and must remain confidential during recovery/export.
- Only dedicated synthetic deal **11665** is authorized for external write tests.

## Runtime and verification

Use Node.js 22.13 or newer and the pinned package lock.

```sh
npm ci
npm test
npx tsc --noEmit
npm run lint
```

Tests include a production build. The build checks the canonical Site ID and emits the questionnaire schema, pinned contract renderer, server, assets, hosting manifest and migrations. Generate a migration after schema changes with `npm run db:generate`; retain prior migrations.

The Site manifest declares `DB` and `FILES`. Required server secrets are `BITRIX_WEBHOOK` for CRM access and `SITE_SESSION_TOKEN` (at least 32 characters) for session signing. Never expose them in assets or logs.

Authentication defaults to the canonical payment-control Site. `AUTH_PROVIDER=local` with `SITE_ACCESS_PASSWORD` is reserved for deliberately isolated tests. Do not use that override in the user preview or release. The inherited shared-password/worker-selection mechanism is not individual identity verification. Login uses a native POST form and checks the saved cookie before entering the protected page. A missing cookie has a distinct error; passwords never enter redirect URLs.

Keep `.env*`, `.dev.vars*`, local databases, real keys, CRM responses and recovery bundles out of source and release archives. See [RELEASE_RECOVERY.md](RELEASE_RECOVERY.md) before publishing.

## Verification limits

As of 12 September 2026, the build, 255 tests, TypeScript and lint pass. Synthetic live Bitrix acceptance verified document/EDS upload, byte readback, safe retry, assessment fields, history and saved contract download. The downloaded contract was inspected across 12 pages. Local migration recovery also passed with a running destination app.

Scanned financial GKB/Kaspi processing still requires an OCR service integration and end-to-end validation. Native extraction and supported manual inspections do not complete that requirement. No paid OCR service is enabled. Browser sign-in, reload, sign-out and error handling pass with an isolated local test account. The fourth-tool publication is explicitly authorized. Hosted retention/recovery access and broader scanned-document acceptance remain limitations on fully retiring the old tool. Test counts do not establish document authenticity or universal extraction accuracy.

## Migration

The authenticated case export retains original references, extraction/review history, identity revisions and submission/upload receipts. The offline validator and restore command preserve records without replaying Bitrix writes. [EXPORT_FORMAT.md](EXPORT_FORMAT.md) specifies commands, credential handling and limitations.
