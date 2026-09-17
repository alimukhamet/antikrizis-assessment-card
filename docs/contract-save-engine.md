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
| Continue card, readback, history and contract release | `contract-operation.ts` |
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

## Two requests, one salesperson action

The main button retains a read-only `prepare` phase, so editing answers or cancelling
client confirmation can still stop the operation before a CRM write. After the
browser checks that the frozen selection is unchanged, it sends one `complete`
request. `completeContractOperation` owns commit, bounded read-only reconciliation,
history, and release of the immutable contract data. The browser no longer decides
which individual CRM action to issue. It renders the returned contract or the
server's explanation and uses the same main button for retry.

The coordinator reauthorizes/refreshes the client between stages and checks the
original employee and destination. A shared 90-second signal bounds its CRM calls,
with the existing 20-second per-call limits retained. A timeout is not evidence of
failure to write: retries always use the durable receipt. Each continuation attempts
at most one card write and one history append; repeated checks are read-only.

Legacy action endpoints remain available for already-open tabs. No new public
unauthenticated endpoint, credential, D1 schema, queue, storage binding, dependency,
contract template or CRM field mapping is introduced. Contract release still requires
both verified receipts. The browser still performs document intake and rendering.

Do not mass-reset old uncertain rows. Their error codes do not prove that nothing
was sent. A particular stuck production deal still needs its actual receipt/readback;
synthetic tests are not proof that deal 10479 is recovered.

## Focused checks

```sh
node --test tests/submission-engine-regression.test.mjs tests/submission-main-button.test.mjs tests/contract-operation-route.test.mjs
```

The integration test loader rejects TypeScript parsing diagnostics before executing
emitted JavaScript. A successful transpile is not a substitute for type checking.
Run normal lint, TypeScript, build and the complete test suite before merge. For
publication use the existing deployment workflow and inspect its actual deploy
result; public asset equality alone cannot prove authenticated server behavior.
