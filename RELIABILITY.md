# Tools 03 and 04 reliability checks

## Ownership and completion rules — 23 September 2026

Codex owns technical triage, prioritization, fixes, regression prevention and verification. Ali owns business decisions and approvals that change the authorized scope. Employees report through `/assessment-feedback`; Ali can identify a problem by deal ID. Inspect the recorded report before asking an employee to repeat it.

Prioritize lost or corrupted data, duplicate external actions and wrong-client documents first; blocked employee work second; confusing labels and unnecessary steps next. Preserve every active loan and its provenance. Uncertainty must lead to a clear manager action, without invented amounts, approvals or missing-loan suppression.

An issue moves through **reported → investigating → implemented → deployed → verified live**. Close it only when the reported employee action has been reproduced and verified after the fix, including saved-state readback where it writes data. A workaround is recorded separately. Passing preview, validation or read-only checks must be described within that scope. For an unresolved report, keep the issue open and state what evidence is still missing.

For each report record the deal, employee action, observed error, client/server versions, draft or operation revision, cause if established, fix/workaround, verification evidence and remaining gate. Keep sensitive source material and recovery bundles outside Git. For releases that affect browser state, check an existing tab and safe recovery as well as a fresh page. Never discard unsaved input to obtain a clean result.

### Open issue register

This is a dated evidence register, not a claim that production was inspected today. The latest observations below are from **22 September 2026**. Recheck live state before taking action.

| Priority | Issue | Last verified state | Next completion gate |
| --- | --- | --- | --- |
| P1 | Deal 12103: newest unspecified error | The two original tabs used release `assessment-2026-09-16.14`, draft 66. A fresh page used `.7`, draft 75. Audit `35743584753` found 9/9 active loans, 73 valid evidence bindings, no validation issues and no final submission record. The newest error was not reproduced. | Identify the exact failed employee action from a fresh report or reproduction. Verify that action; keep the report open meanwhile. |
| P1 | Employees continue working in old open tabs | Opening a fresh 12103 page restored the current saved version. No automatic update/recovery mechanism has been verified for old tabs. | Provide a clear, tested route to the current release that preserves unsaved work and handles concurrent draft changes. |
| P1 | Complete contract and lawyer-handoff acceptance | Release CI and read-only audits pass. Real preview download for 12103 was verified. That is not final submission/handoff acceptance. | Verify the complete employee flow on an authorized eligible test case, including saved fields, history, originals and stage readback. Recheck eligibility of test deal 11665 before any write. |
| P1 | Scanned and mixed-language document reading | Native PDF extraction and manual inspection exist; scanned financial OCR remains incomplete. | Verify representative authorized Kazakh/Russian identity and bank documents, date extraction, active-loan coverage and understandable correction/persistence when reading fails. |
| P2 | Deal 11123: manager duplicate-loan decisions | The comparison fix was released; the last inspection still required explicit choices between differing duplicate records. | Recheck the saved case and verify the manager can resolve each duplicate without dropping a distinct active loan. |
| P2 | Deal 12103: misleading “выбрать снова: 1” | Header displayed one missing selection while the pending-file list was empty and the credential receipt was verified. | Make the header and actionable pending-file list use the same effective state; check reload and genuinely missing files. |

### Narrowly verified fixes

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

After every release the deploy workflow runs the same read-only audit. This is a release check, not continuous monitoring. GitHub cron only runs workflows on the repository's default branch; adding a schedule to the deployment branch alone would provide no coverage.

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
