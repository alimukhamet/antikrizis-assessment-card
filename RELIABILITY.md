# Tools 03 and 04 reliability checks

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

A bounded real Bitrix audit read 24 PDFs / 613 pages in six cases without modifying their saved drafts. It found a short-report layout error: explanatory text in legacy Kazakh reports mentioned the newer format. Version `rules-native-18` chooses the first report title and extracts all 9/7/5 loans from those three reports. Shortened contract identifiers remain reconciliation blockers. Fixtures cover this regression without storing real client details in the repository. Document reading is not evidence of authenticity, universal extraction accuracy, or employee acceptance.

Release checks assert the current launcher and all three retired methods using normal staff authentication, in addition to existing saved-case/API and public-asset checks. The signed intake test uses an explicitly disposed pinned Worker runtime; it no longer relies on a development server that could leave background processes running after its assertions finished.
