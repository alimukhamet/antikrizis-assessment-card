# Tools 03 and 04 reliability checks

## Ownership and completion rules — 23 September 2026

Codex owns technical triage, prioritization, fixes, regression prevention and verification. Ali owns business decisions and approvals that change the authorized scope. Automatic diagnostics and scheduled checks are the first source of incidents; employee reports are optional additional evidence. Ali can identify a problem by deal ID. Inspect diagnostics, saved state and reports before asking an employee to repeat anything.

Prioritize lost or corrupted data, duplicate external actions and wrong-client documents first; blocked employee work second; confusing labels and unnecessary steps next. Preserve every active loan and its provenance. Uncertainty must lead to a clear manager action, without invented amounts, approvals or missing-loan suppression.

An issue moves through **reported → investigating → implemented → deployed → verified live**. Close it only when the reported employee action has been reproduced and verified after the fix, including saved-state readback where it writes data. A workaround is recorded separately. Passing preview, validation or read-only checks must be described within that scope. For an unresolved report, keep the issue open and state what evidence is still missing.

For each report record the deal, employee action, observed error, client/server versions, draft or operation revision, cause if established, fix/workaround, verification evidence and remaining gate. Keep sensitive source material and recovery bundles outside Git. For releases that affect browser state, check an existing tab and safe recovery as well as a fresh page. Never discard unsaved input to obtain a clean result.

### Open issue register

Entries have separate verification dates. Unresolved observations below originated on **22 September 2026** unless a newer date is stated. Recheck live state before taking action.

| Priority | Issue | Last verified state | Next completion gate |
| --- | --- | --- | --- |
| P1 | Scheduled monitoring cadence unverified | At 06:29 UTC on 23 September, the dedicated monitor was over 45 minutes old and no `schedule` event had run. The workflow is active on `main`, checkout points to `deploy/anti-krizis`, Actions is enabled and the cron syntax is valid. A manual fallback run `35827033913` passed at 06:30 UTC with no incidents or stuck operations. | Observe a successful automatic scheduled run. Do not treat manual fallback success as proof of the 15-minute cadence. Continue checking schedule events separately from snapshot freshness; no configuration defect or service outage is established yet. |
| P1 | Employees continue working in old open tabs | Opening a fresh 12103 page restored the current saved version. No automatic update/recovery mechanism has been verified for old tabs. | Provide a clear, tested route to the current release that preserves unsaved work and handles concurrent draft changes. |
| P1 | Complete contract and lawyer-handoff acceptance | Deal 12103 now has a real verified final assessment/history save on 23 September and an existing verified handoff from 22 September; see delivery evidence below. | Remaining general acceptance is a complete fresh employee UI flow on an authorized eligible test case. Recheck eligibility of test deal 11665 before any write; do not infer universal readiness from one repaired case. |
| P1 | Scanned and mixed-language document reading | Native PDF extraction and manual inspection exist; scanned financial OCR remains incomplete. | Verify representative authorized Kazakh/Russian identity and bank documents, date extraction, active-loan coverage and understandable correction/persistence when reading fails. |
| P2 | Deal 11123: manager duplicate-loan decisions | The comparison fix was released; the last inspection still required explicit choices between differing duplicate records. | Recheck the saved case and verify the manager can resolve each duplicate without dropping a distinct active loan. |
| P2 | Deal 12103: misleading “выбрать снова: 1” | Header displayed one missing selection while the pending-file list was empty and the credential receipt was verified. | Make the header and actionable pending-file list use the same effective state; check reload and genuinely missing files. |

### Narrowly verified fixes

- Court-trend navigation, 23 September: the owner reported duplicate search/selection controls and requested ascending lists. The dropdowns repeated the sidebar, while courts used descending decision count and regions used alphabetical order. One search now feeds one region/court list on desktop and mobile, with manual % ↑ / % ↓ controls for the latest displayed percentage, with missing values last in either direction and zero preserved. The chosen direction is retained while navigating and searching. Local browser checks reproduced region → district court and cross-region search, including 390-pixel layout without overflow. Switching to descending put the highest rates first and retained the direction when opening a region and searching; switching back to ascending reordered the same mobile search results without clearing the query. The navigation regression verifies both directions, ties and missing data without mutating source rows. The authenticated release audit requires one search, one navigation surface, both sort-direction controls, no duplicate dropdowns and exact source-data parity. Production release evidence is in that commit's deploy workflow audit; local interaction checks do not claim an authenticated browser click-through.

- Deal 12103 assessment delivery, 23 September: live audit `35824286378` found 11 Bitrix attachments and a verified lawyer handoff, while D1 contained an uncommitted employee submission. The final commit mistakenly fed package-derived GKB balance evidence back through the ordinary fact-binding validator; the built-Worker test reproduced `ASSESSMENT_NOT_READY` after a successful readiness check. Commit now revalidates the original bindings and compares the full regenerated evidence before any write. The regression covers GKB preparation through final contract, owner continuation with unchanged snapshot/author, retries, and withdrawal before commit. Stalled prepared submissions are now monitored; owner audits include all employees' submissions instead of only Ali's. Live recovery remains a separate gate from deployment.

  **Verified live:** production commit `7d00731`, release `.2`, deployment `35825696329`; source checks `35825696205` passed 722 tests with one existing skip and the built-Worker recovery check. Darkhan completed the existing answers through the normal employee flow at `2026-09-23T06:21:16.572Z`; submission and history receipts are verified. Draft 75, values, contract data and evidence match the previously pending snapshot. Audit `35826523790` independently confirmed the saved contract is available, 11 attachments remain in Bitrix, all 9 active loans are present and handoff remains verified. D1 has no unfinished submissions. The Bitrix-delivery issue is closed within this scope.

  The manual audit workflow accepts an optional exact request ID and payload hash for an explicitly authorized recovery. The owner-only continuation preserves the saved employee intent and refuses changed answers, identity or evidence. It cannot supply replacement answers, upload files or move stages. Original authorship remains intact and a separate owner recovery event is recorded. It is never called by scheduled monitoring. Uncertain operations remain read-only reconciliation. Treat this as recovery of an authorized operation, never permission to submit real contracts as tests. Maintenance run `35826330641` intentionally stopped with `SUBMISSION_CANCELLED`: the employee had already completed a newer submission after deployment, and the pinned recovery correctly refused the superseded attempt. Do not retry that old request. Sanitized evidence is in the task's `outputs/delivery-12103-verification.json`.

- Contract filenames: commit `2b1b1b4`, release `.7`; production run `35742132865` passed 707 tests with one existing skip, plus runtime recovery. A real preliminary download for 12103 used the legacy name/contract-number/deal-ID format, matched the DOCX contents and passed ZIP integrity. Final/recovered filename paths have regression coverage; this does not establish a final submission for that deal.
- Return from document to credit reconciliation: commit `147e587`; verified live opening a report and returning to the same comparison. Keep this verification separate from overall case readiness.

## Release checks

The production release workflow requires lint, type checking, the full regression suite, and `npm run test:runtime` before deployment. It preserves runtime variables, compares live asset hashes, and then signs in normally to audit the existing read paths. A production API failure fails the release job even when deployment itself succeeded. An incomplete customer questionnaire or a case outside the sales pipeline remains a business gate, not an outage.

## Runtime recovery test

`npm run build:anti-krizis` followed by `npm run test:runtime` runs the built Worker in local workerd, with the real D1 migrations, R2 object storage, production repositories, API routes, validation and CRM adapters. Only the external CRM transport is synthetic. All outbound requests are restricted to an isolated `.invalid` origin. No real credentials, client files, signatures or remote bindings are used.

The test verifies:

- Authentication and rejection of cross-origin writes.
- Saving and restoring a complete draft, including document references and manual review records.
- Final readiness through the actual API.
- Saving the assessment and timeline after the CRM applies a write but its response is lost; repeating the request must not duplicate either write.
- Generating a DOCX from the saved contract using the shipped renderer and local vendored libraries.
- Uploading documents and dummy credentials, then reading back and verifying their bytes after lost responses.
- Losing the handoff response and readback after the CRM advances the case onward, terminating workerd, and resuming against persisted storage. Recovery must use history and must not move the stage again.
- Restoring the same draft, contract and credential receipt after restart; rejecting a stale draft save.

The fixture seeds explicit extracted document results. It does not prove PDF interpretation or legal authenticity; separate parser tests cover extraction. The pinned local workerd uses compatibility date 2026-05-22, while production keeps 2026-09-16. Local success therefore does not replace live checks or employee acceptance.

## Live audit

`Tools 03 and 04 audit` can be dispatched on `deploy/anti-krizis` without changing client answers or CRM business data. The normal audit signs in with the existing test secret, reads saved drafts, submissions, uploads, credentials and handoff state, and runs the read-only final check. It fails for authentication, API, storage recovery or contract retrieval errors. The optional saved-analysis refresh is separate and disabled by default.

After every release the deploy workflow runs the same read-only audit and the production monitoring probe. Recurring monitoring is configured separately below. GitHub schedules only run workflows on the repository default branch; the monitoring workflow must exist on `main`, even though it checks out `deploy/anti-krizis`.

## Remaining live acceptance

A real employee must complete the permitted synthetic sales case through contract download and handoff in the production UI. The existing designated test deal 11665 was outside sales during the September 20 audit; it must not be moved back or repurposed silently. Production case data was not modified to manufacture readiness. Local recovery tests and authenticated read-only production checks do not prove real Bitrix automation or employee acceptance.


## Portal cutover — 20 September 2026

The owner explicitly retired tools 01 and 02. The launcher now publishes only 03/04; both legacy launcher URLs serve the current home screen. Old cached tabs receive `OLD_TOOL_RETIRED` (HTTP 410) for `crm.deal.update`, `crm.timeline.comment.add` and `crm.item.update`. Authentication and origin checks still apply first. Tools 03/04 retain their dedicated validated, recoverable write routes. The archived source template and all stored/CRM data remain intact; no old Site is deleted.

The interface has one compact title/client bar, a direct Bitrix import action, three contract steps, and a clear “Сохранить и скачать” action. The raw questionnaire stays hidden until the working interface initializes; failed or stalled startup offers a reload action. Desktop and 390 px browser checks cover the launcher, saved-client selection, document intake, answers, contract screen and handoff layout using synthetic local data.

A bounded real Bitrix audit read 24 PDFs / 613 pages in six cases without modifying their saved drafts. It found a short-report layout error: explanatory text in legacy Kazakh reports mentioned the newer format. Version `rules-native-18` chose the first report title and extracted all 9/7/5 loans from those three reports. At that release, shortened identifiers required reconciliation; subsequent comparison work supplies explicit manager decisions. This historical audit does not define current blocking behavior. Fixtures cover this regression without storing real client details in the repository. Document reading is not evidence of authenticity, universal extraction accuracy, or employee acceptance.

Release checks assert the current launcher and all three retired methods using normal staff authentication, in addition to existing saved-case/API and public-asset checks. The signed intake test uses an explicitly disposed pinned Worker runtime; it no longer relies on a development server that could leave background processes running after its assertions finished.

Automatic production asset and authenticated readback checks run inside the deployment job after publishing. The separate publication snapshot is manual-only: running it in parallel on every push could compare the previous release before deployment completed. This preserves the post-deployment gate and removes that ordering race.

## Document review corrections — 21 September 2026

ENPF coverage now recognizes the labelled “Весь период” value in the immutable first-page text. It uses the printed issue date, accepts the all-history coverage without inventing a start date, and retains missing-date, future-date, wrong-client and unreadable-page gates. This policy check also applies to existing cached analyses, preserving extraction receipts and employee inspections.

Typed document-review fields are saved with the versioned assessment draft, keyed by document and type. They survive rechecking and reload; confirmation checkboxes and approval flags are excluded. Accepted document inspections return their saved dates. A duplicate file selected under a wrong type remains an actionable error but no longer hides a valid inspection of that same file under its correct type.


## Proactive monitoring — 23 September 2026

Implementation and activation must be verified independently; the release evidence is recorded after publication.

Release preparation evidence: source `43dd520` passed 718 tests (one existing skip), lint, types, build and runtime recovery in run `35821727757`. The deployment credential is limited to deployment and cannot import D1 schema. The already connected Cloudflare account separately authorized D1 management: migration `0012_operations_events.sql` was applied to the canonical database and its 11 columns and indexes read back on 23 September. Customer rows were not changed. Keep that separation: apply future reviewed D1 migrations through the authorized connector before release, and let the live probe verify normal application storage. Do not widen credentials or add arbitrary SQL endpoints.

- `operations-monitor.js` observes questionnaire/handoff browser errors, failed assessment API calls, known stale-version/save failures and contract actions busy for three minutes. Successful browser work is never retried or changed by diagnostics. Reports include deal ID, action, stable code, release and timing; no raw errors, input values, document text or credentials. Client events are deduplicated and bounded. Failed delivery is retried while the tab remains open; an offline or closed tab can lose undelivered diagnostics.
- The Worker records assessment API 5xx failures independently. D1 stores diagnostics in `assessment_operations_events`; this release adds only that table and indexes. An unavailable diagnostics database does not replace the business response. Staff can submit their own diagnostics; only Ali can read the combined owner view at `/assessment-feedback`.
- `scripts/monitor-production.mjs` signs in normally, verifies configuration, diagnostic persistence, the current client release, saved drafts and read-only checks for up to three cases. It distinguishes technical availability from business readiness. Missing/duplicate active loans appear as counts; unknown coverage stays unknown. It does not submit contracts, approve evidence, change answers or reprocess documents.
- `Production monitoring` is scheduled in GitHub every 15 minutes at minutes 7, 22, 37 and 52. Scheduled execution can be delayed. Its artifact records automatic incidents from the last 24 hours and external operations still writing/uncertain after 15 minutes. Historical incidents remain visible; their presence alone does not turn every check into a new outage. Probe artifacts expire after seven days. The successful owner probe removes diagnostics older than 30 days from this telemetry table only; business records and originals are untouched.
- The `Assessment reliability` Codex heartbeat reviews results hourly, investigates actionable changes, and keeps unchanged checks quiet. Local Codex follow-up requires the host/app to be available; GitHub probes run independently in the cloud. Check the monitor itself if its latest result is older than 45 minutes. State belongs in `../../outputs/operations-monitor-state.json`, outside Git, and must not contain client content.
- Review new incidents by signature, affected deal and saved operation receipt before retrying. Update this register with cause, fix, release and actual verification. A technical fix can be released under existing authorization; client decisions and evidence approval still belong to the manager. Escalate only a required business decision, unavailable access, or a consequential action outside that scope.
- Existing pre-monitor browser tabs need one safe reload or a fresh tab to acquire this code. Later version differences offer a new tab while preserving unsaved input in the original. This does not prove universal OCR accuracy or full employee acceptance, and it does not close the open issues above.
