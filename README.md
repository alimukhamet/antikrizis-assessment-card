# Antikrizis assessment and document intake

Project ownership, unresolved issues and completion rules are maintained in [RELIABILITY.md](RELIABILITY.md). Agents working on this project must also follow [AGENTS.md](AGENTS.md).

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

## Client profiles (Документолог)

`/profile-backfill` lists every category `1` deal on a «ЗВИ…» or «В ожидании» stage, unfinished first, oldest Дата ЗВИ first. Missing/invalid dates are last within each completion group; equal dates use ascending deal ID. The queue reapplies this priority after completion or reopening, and «Начать» / «Следующая сделка» select the oldest available unfinished profile. Opening a deal runs the same questionnaire in `mode=profile`:

- deal documents are pulled from Bitrix and read automatically; the old text card (`UF_CRM_AI_CARD`) is shown read-only next to the answers;
- each imported PDF is checkpointed to the draft before the next file starts. Returning restores saved analysis in bounded batches; importing the same current Bitrix file reuses its immutable original after checking deal membership and identity. Final delivery still verifies live bytes;
- «Заполнить пропуски из документов» fills only empty answers using loaded evidence, without another download. Employee answers, explicit zeroes and existing review bindings remain intact; reopening alone never recreates deleted answers or loan rows;
- extraction rule updates reuse verified native pages when the PDF reader is unchanged. Unchanged extraction facts retain their existing evidence/review IDs; newly extracted or changed facts require review. Russian/Kazakh empty participant tables, financing variants and compact short-report tables are supported; missing currency, truncated IDs and uncertain debt components remain flagged.
- opening a profile automatically shows «В работе: имя» to colleagues. The queue refreshes activity every 15 seconds without rereading Bitrix; occupied rows and the next-profile suggestion direct staff to free clients. Direct links warn if another employee also has the profile open. Presence is coordination information, not an exclusive editing lock;
- presence clears after saving or leaving; disconnected tabs expire after two minutes. Tabs idle for ten minutes stop advertising work until the employee interacts again. Separate tabs cannot clear each other's presence;
- the small employee summary counts distinct completed client profiles across this tool, credited to the latest saver. Repeated saves do not add completions; reopened profiles are excluded until saved again. Presence does not change answers, documents, CRM fields or receipts;
- ФИО, телефон, семейное положение and процедура are prefilled from Bitrix; contract and payment questions are hidden;
- the profile reuses the contract questionnaire's client and financial questions, without contract/payment fields or stricter employer-name requirements. The existing contact phone is visible and optional; there is no email or family-members questionnaire;
- CRM «Изменить факты» opens this same questionnaire directly at the answers after the saved draft has loaded. Any profile answer can be corrected; uploading documents again is unnecessary. Draft autosave stays separate from «Сохранить изменения». After a verified save, editing restores that action and presence; a pending save must be reconciled before a new publication. A receipt never marks newer, unsent edits as saved.
- registration address and actual residence remain in the shared questionnaire. The court/address destination is entered only in the Platform support explanation task (owner decision 1 Oct). Separate court recommendations, client court preferences and registration-change inputs are retired from contract preparation and documentologist profiles; all six controls remain hidden here; saved values stay in drafts and profile/history feeds for support prefilling and never block assessment completion;
- the overall debt-purpose explanation is always visible in profiles; payment-difficulty details appear when a difficulty is selected. Both require at least 30 characters after trimming/collapsing whitespace, with concrete prompts and a live counter. «Не знаю» cannot satisfy these explanations. The server enforces the same rule for checking and saving, including old tabs; unfinished text remains saveable as a draft. Contract mode keeps its existing requirements;
- other supported «Не знаю» answers save an open question («Требует уточнения») and survive draft restore. Retired family/contact answers remain in old drafts and saved history without blocking profile completion;
- «Сохранить профиль» writes only the existing `UF_CRM_1773669702495` (ФИО), `UF_CRM_AI_MARITAL` and `UF_CRM_AI_DEBT`, with conflict detection and readback. No new Bitrix fields: the full profile (card text + `antikrizis.profile.v1` JSON) is kept in `assessment_profile_saves` and posted as a deal timeline comment together with the previous values. Contract, payment, procedure and the old card are never written.

Storage: `0016_profile_saves` and `0017_profile_presence`; no Bitrix fields are needed. The additive presence migration was applied and read back in production on 29 September before publication.

## Confirmed business rules

- Preserve the canonical document list, contract/payment rules and downstream assessment format.
- The client and spouse property questions include land plots under real estate. New plots use the real-estate object type; saved separate land answers, cards and source bindings remain intact and editable in the same section. Restoring a draft does not infer a second ownership answer or require a duplicate property card.
- For a married client, contract preparation asks for the spouse's social status separately from the client's. A new assessment cannot be completed with a missing or unknown spouse status; partial drafts remain savable. The answer is included in the saved assessment and CRM intake. Pension, disability or benefits make the spouse's own certificate required during CRM document collection, without adding a new spouse-document gate to contract generation.
- GKB reports issued in the last three calendar months are accepted (in September: from 1 June; owner decision 29 Sep 2026, previously 30 days); future dates are rejected.
- Bank and salary statements must cover twelve months and end in the last three calendar months (in September: from 1 June) (owner decision 29 Sep 2026).
- ENPF inspection accepts twelve months through the issue date, or an explicitly labelled all-history period on the original first page. This documents the existing inspection rule; it does not infer coverage from the first payment or filename.
- Match the client IIN against trusted deal data. A filename or matching name alone does not establish ownership or authenticity.
- Powers of attorney must identify the approved Aizhan representative or Aplus corporate entity. Server checks do not prove execution or authenticity.
- Sales may ask the client and explicitly confirm unclear debt amounts, preserving client-confirmed provenance rather than describing them as documentary facts.
- Keep the old EDS handoff. Key/password do not enter ordinary PDF extraction or drafts. Legacy CRM filenames contain the sanitized password and must remain confidential during recovery/export.
- Only dedicated synthetic deal **11665** is authorized for external write tests.

## Runtime and verification

In «Отдел продаж → Результаты → + План», Ali enters one future period, target and pair of rates, then selects employees (or «Все»). Each selected employee receives a separate plan with the full target; it is not divided across the team. An overlap for any selected employee rejects the entire save and identifies that employee. Retrying an uncertain save preserves the exact selection and terms and returns the original receipts. Existing single-person requests from old tabs remain supported, and payments remain individual.

First-place competitions for 1–30 September and 1–21 October 2026 award 100,000 ₸ to the single highest full contract volume among Darkhan, Ramazan and Nurdaulet, using the existing lawyer-handoff dates. The final day must finish before a winner is assigned. Ties, incomplete amounts or unavailable ranking remain unresolved. The bonus has a separate earnings line, is included once with monthly accrual, and never creates a payment. Historical commission rates and payment-type formulas remain unchanged; current-period prizes are shown separately from accrued earnings.

On 2 October the owner corrected the September target to 10,000,000 ₸ for each of the three employees. September retains 2% below target for Darkhan, 1.6% below target for Ramazan and Nurdaulet, and 2.3% when reached. The separately saved 1–21 October plans remain at 11,000,000 ₸, with 1.6% below target and 2% when reached.

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

Keep `.env*`, `.dev.vars*`, local databases, real keys, CRM responses and recovery bundles out of source and release archives. Use [RELIABILITY.md](RELIABILITY.md) for the current production release path. [RELEASE_RECOVERY.md](RELEASE_RECOVERY.md) preserves the historical Sites recovery procedure and case-data preservation rules.

## Verification limits

As of 12 September 2026, the build, 255 tests, TypeScript and lint pass. Synthetic live Bitrix acceptance verified document/EDS upload, byte readback, safe retry, assessment fields, history and saved contract download. The downloaded contract was inspected across 12 pages. Local migration recovery also passed with a running destination app.

Profile mode now reads scanned PDF pages and JPEG/PNG photographs on the employee laptop using the pinned PaddleOCR Cyrillic browser runtime. It processes one page at a time, saves immutable OCR checkpoints in migration `0018_browser_ocr`, and uses expiring document leases to prevent duplicate work. Closing/pausing leaves completed pages reusable by other staff. Model assets are self-hosted and cached; no OCR provider or cloud inference is called. Extracted text, dates and candidate fields remain unverified assistance: explicit actions can populate empty answers or unsupplied inspection dates, but existing answers, native evidence, approvals and financial completeness gates are preserved. JPEG/PNG originals retain their exact bytes and MIME type; each photo is one OCR page. Automatic verification of scanned GKB/Kaspi tables remains unsupported. Native extraction and supported manual inspections do not complete that requirement. No paid OCR service is enabled. Browser sign-in, reload, sign-out and error handling pass with an isolated local test account. The owner authorized the portal cutover on 20 September 2026. Scanned financial reports still require an original PDF with readable text; they must not be silently treated as verified. See RELIABILITY.md for current release gates and remaining employee acceptance. Test counts do not establish document authenticity or universal extraction accuracy.

## Migration

The authenticated case export retains original references, extraction/review history, identity revisions and submission/upload receipts. The offline validator and restore command preserve records without replaying Bitrix writes. [EXPORT_FORMAT.md](EXPORT_FORMAT.md) specifies commands, credential handling and limitations.

### Court trends for sales

`/knowledge` is the staff-protected ВПС court-trend finder, linked as «Практика судов» from the existing launcher. One search finds a region or court and opens its trend immediately. One shared sidebar list shows regions or the selected region’s courts on desktop and mobile, with a % ↑ / % ↓ control for the latest displayed percentage. Missing data stays last in either direction, and the selected direction is retained when moving between regions, courts and search results; there are no duplicate selection dropdowns or secondary court lists; the main view shows half-year/monthly trends, decision counts and the exact 2026 percentage-point change. There are no lessons, quizzes or sales scripts. `/api/knowledge` serves aggregate data with `private, no-store`; the dataset is never bundled into public browser assets. It does not read or write client cases, assessments or CRM records.

The read-only import in `data/vps-sheet-snapshot.json` preserves five named sheet ranges from spreadsheet `1vQg24SZsKQ2IPoPvdNs6PtWRQjPHKZtbJENt3rbeI44`, imported 22 September 2026, with the source cutoff of 17 September 2026. It contains 20 regions and 222 courts with displayed outcomes. Period and monthly rates are preserved as displayed; percentage-point changes use the source values (not subtraction of already-rounded rates). All-time rates use the original counts. The source is a manual snapshot, not a live Sheets connection.

To refresh, read the same exact tabs and bounded ranges through authenticated Google Sheets access, replace the snapshot, and run the knowledge tests plus release checks. Check source dates, totals, court/region pairing and missing-date limitations before release. `tests/knowledge.test.mjs` checks every imported period/month, totals by court and region, filtering and staff protection. The deployment workflow signs in through the normal salesperson account selection and verifies the live page, launcher link and complete JSON parity in `scripts/audit-live-knowledge.mjs`.
