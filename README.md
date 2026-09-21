# Antikrizis assessment and document intake

For deployment outside ChatGPT Sites, start with
[OWN_HOSTING_HANDOFF.md](OWN_HOSTING_HANDOFF.md) and
[environment.example](environment.example).

Current portal: https://assessment.anti-krizis.kz. On 20 September 2026 the owner explicitly authorized retiring tools 01 and 02. Only 03 (prepare contract) and 04 (handoff to lawyers) are published as the main workflows. The archived original template stays in source for contract generation and recovery; it is not served. The legacy Bitrix proxy rejects its three write methods with HTTP 410. Existing Bitrix data, saved originals, drafts and operation receipts are retained. The separate historical chatgpt.site is outside this retirement scope.

Canonical Site: https://antikrizis-assessment-card.mukhamet-ali-ma.chatgpt.site

## Worker flow

1. Sign in using the existing payment-control worker selection and password.
2. Open a deal; the server establishes the client IIN from Bitrix.
3. Select the existing required documents. Digital PDF text is extracted and cached; recognized answers keep document and page references.
4. Check document ownership, type, periods and conflicts. Ask the client for unanswered information. Preserve whether a value came from a document or a client answer.
5. Draft answers and ordinary original files are saved in D1/R2. They are not sent to Bitrix just because the employee leaves or reloads the draft.
6. Click «Скачать договор»: complete required checks, upload ordinary documents, save the assessment, verify Bitrix readback and history, then download the saved contract. Moving between Documents, Answers and Contract does not approve facts or bypass this final check.
7. Use «Сообщить об ошибке» to report a problem without changing the client assessment. Ali sees all reports at `/assessment-feedback`; other workers see their own.

Documents, drafts, inspections, submissions and upload receipts are separate records. A timeout does not prove that an external write failed. Retrying recovers the original operation. An owner can cancel an upload only while the server can prove it never started; cancellation remains available after reopening the case.

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

Scanned financial GKB/Kaspi processing still requires an OCR service integration and end-to-end validation. Native extraction and supported manual inspections do not complete that requirement. No paid OCR service is enabled. Browser sign-in, reload, sign-out and error handling pass with an isolated local test account. The owner authorized the portal cutover on 20 September 2026. Scanned financial reports still require an original PDF with readable text; they must not be silently treated as verified. See RELIABILITY.md for current release gates and remaining employee acceptance. Test counts do not establish document authenticity or universal extraction accuracy.

## Migration

The authenticated case export retains original references, extraction/review history, identity revisions and submission/upload receipts. The offline validator and restore command preserve records without replaying Bitrix writes. [EXPORT_FORMAT.md](EXPORT_FORMAT.md) specifies commands, credential handling and limitations.
