# Contract-save engine: identity and retry rules

## Structural problem found

The UI request ID, immutable assessment snapshot and outcome of an external CRM write
were being treated as one thing. They are different:

- A page reload generates a new UI request ID. It does not necessarily mean new answers.
- `historyCard` contains a fresh timestamp; `baseline` is a fresh CRM read. Neither is
  the identity of the user's request. Comparing their full-payload hash made genuine
  retries look like changed content.
- A failure while reading CRM before the update is not an uncertain update. The old
  services stored both as `uncertain`, then allowed only readback forever.
- The repository could return an existing request ID, but the service still claimed
  and finished the newly supplied ID. Recovery must use the returned durable record.

The previous tests mostly isolated services behind stubs with static payloads. The
new engine tests combine the real SQLite-backed repository, real final-submission
and save services, and real CRM adapters. Only network responses and document
approval are synthetic. They are not authenticated production end-to-end tests.

## Ownership

| Concern | Owner |
| --- | --- |
| Validate answers, documents, evidence and client identity | `final-check.ts` and `final-submission.ts` |
| Recognize unchanged request input before rebuilding metadata | `prepareFinalSubmission` |
| Persist the original snapshot; serialize claims and conditional transitions | `SubmissionRepository` |
| Prove whether a failure happened before the external write boundary | CRM adapter |
| Use the durable request ID and never replay an uncertain write | Save/history services |
| Display progress and download the saved renderer/data | `submission-flow.js` |

## State rules

`prepared` means that no external write is known to have begun. A successful claim
moves it to `writing`. The adapter can return it to `prepared` only by explicitly
proving that it failed in its read-only preflight (`notStarted`). That transition
records `NOT_SENT:<reason>`. History uses the same rule with `pending`.

Once the external update/add has been invoked, a timeout, rejection, partial
readback, or unknown exception does **not** authorize another send. The operation
stays `writing`/`uncertain` and can only be reconciled through reads. A verified
receipt cannot be downgraded by a late failure.

An unchanged request can resume an unfinished record or download the already
completed record. Recompilation is not required merely because the tab reloaded.
A prepared record still receives full final validation before a CRM write; an
attempted write keeps its original snapshot and renderer. Changed answers cannot
replace writing/uncertain work. Cross-worker and client-identity checks remain.

The full persisted payload/hash is not rewritten. A new preparation compares
content excluding only newly generated CRM baseline and audit text. Concurrent
identical insert losers may adopt the winning active record. The service always
uses that record's request ID and persisted values, not its caller's replacement ID.

## Limits and follow-on work

This is a targeted engine repair, not a rewrite of the whole application. The Word
file still requires the existing CRM and history receipts; the business meaning of
"saved contract" is unchanged. The browser still orchestrates multiple endpoints.
A future single server coordinator/outbox could hide more of those details, but
must preserve the same write boundaries and be migrated separately.

No database migration, runtime credential, approved contract template or CRM field
mapping changes are required. Do not mass-reset old uncertain rows. Their historical
error codes do not prove that nothing was sent. A particular stuck production deal
requires its actual receipt/readback to establish recovery; code tests alone are not
proof that deal 10479 is resolved.

## Focused checks

```sh
node --test tests/submission-engine-regression.test.mjs tests/submission-main-button.test.mjs
```

Run normal lint, TypeScript, build and the complete test suite before merge. For
publication use the existing deployment workflow and inspect its actual deploy
result; public asset equality alone cannot prove authenticated server behavior.
