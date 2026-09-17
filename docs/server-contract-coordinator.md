# One command for contract completion

The browser's final submission now sends `complete` once. The authenticated server
handler validates the confirmed destination and invokes `completeSubmission`.
That coordinator prepares/reuses the immutable operation, attempts the card write
once, checks uncertain readback, completes the timeline, and returns the saved
contract data. The browser renders the returned version and retains a direct file
link; it no longer chooses `commit`, `reconcile`, or `history` steps.

`resume` is an explicit selection of a saved snapshot; no replacement answers are
accepted. `complete` includes the checked questionnaire and bindings, so unchanged
input resumes but changed input cannot silently download an older contract.
Document validation, draft persistence and document uploads remain their own gates
before this command. A save cannot bypass the existing final checks.

## Safety boundaries

- Staff authorization and destination confirmation apply to both commands.
- Every transition uses the persisted request ID. A reload is not a new write.
- Each command attempts each external write at most once. Card reconciliation is
  limited to three reads. After a history attempt, only uncertain/writing history
  may be checked again; pending/proven-unsent history waits for another user click.
- The combined CRM sequence has an 80-second abort signal in addition to existing
  per-request timeouts. No detached coordinator or automatic write-retry job runs.
- Identity is re-read from the case repository before history and contract output,
  so a long request cannot continue using a superseded identity revision.
- Rendering still requires both verified receipts. Conflicts stay visible. No old
  uncertain records are reset, deleted, mass-unlocked, or marked successful.
- Old API actions remain supported for already open tabs. New browsers use only
  `complete` / `resume` for final submission, plus explicit pre-write cancellation.

Focused checks:

```sh
node --test tests/submission-coordinator*.test.mjs tests/submission-engine-regression.test.mjs tests/submission-flow.test.mjs tests/submission-main-button.test.mjs
python tests/browser/contract-download.py
python tests/browser/real-contract-download.py
```

Coordinator tests use the real SQLite repository, real save services and real
Bitrix adapters, with synthetic network responses and document approval. Route
tests exercise the actual HTTP handler and authorization/destination checks with
synthetic coordinator results. Browser tests use synthetic server responses;
one generates a real DOCX. None constitutes a production test for deal 10479.
