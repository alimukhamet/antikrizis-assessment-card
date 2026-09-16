# Sales-testing release gate

## What automated checks do and do not prove

The Node suite exercises the application, client identity isolation, drafts, CRM failure handling, eligibility, and contract generation. Browser regression tests use synthetic server/CRM responses; the native Chromium test uses the actual pinned DOCX libraries and actual renderer. These are not authenticated production end-to-end tests. The private-document fixture test remains intentionally skipped when those fixtures are absent.

The approved legal template, contract terms, database schema, production credentials, and storage bindings are not changed by this repair.

## Verify and publish the tested source

Use Node 22.13 or newer and the existing authorized Cloudflare account:

```sh
npm ci --no-audit --no-fund
npm run lint -- --max-warnings=0
npx --no-install tsc --noEmit
ANTIKRIZIS_EXTERNAL_DEPLOY=1 npm test
npm run deploy:anti-krizis
```

`deploy:anti-krizis` deploys using the existing `wrangler.anti-krizis.jsonc`. Do not run database migrations, replace secrets, or create new storage resources for this repair. A GitHub merge is not evidence of a Cloudflare deployment. Compare the live renderer, hosted-assessment adapter, draft adapter, and vendored library hashes with the release source before calling the release current.

The read-only publication check on pushes to `deploy/anti-krizis` reports those hashes. It does not deploy and a successful job is not sufficient: its report must say `matchesReleaseAssets: true`.

## Salesperson smoke test

Use a dedicated approved test deal and test documents, not a real client’s case. Sign in with the actual salesperson account. Start in a fresh tab after publication; preserve or save any existing unsaved questionnaire before reloading.

1. Open the correct deal. Confirm the displayed name, deal ID, and IIN refer to the same test client.
2. Add the approved documents. Run “Проверить и продолжить” and resolve required checks. An unavailable server must show an actionable error and leave the questionnaire intact.
3. Save a draft, reopen it, and verify answers and document references. Switch to another test deal and back; no answers or errors from the first deal should appear on the second.
4. Finish the answers and contract payment fields. Generate the contract. Open the downloaded Word file and inspect the client, contract number, amount, dates, and payment schedule.
5. Use the persistent download link again. This must download the same saved contract without a second contract/CRM save. Edit an answer and verify the old download is no longer silently presented as the new result.
6. After a session-expiry warning, leave the questionnaire tab open. Follow the separate-tab login link, sign in as the same employee, return, and retry. Do not switch employees inside an unsaved questionnaire.

Record the test deal ID, time, failed step, exact message, and downloaded filename. Do not paste passwords, ECP keys, authentication cookies, or real client documents into bug reports.

## Reproduce browser checks locally

With Python Playwright and Chromium installed:

```sh
python tests/browser/contract-download.py
python tests/browser/real-contract-download.py
```

The native browser test accepts `CHROMIUM_EXECUTABLE`; otherwise it uses Chromium on PATH or Playwright's managed browser. It does not contact production and deletes its synthetic DOCX after verification.
