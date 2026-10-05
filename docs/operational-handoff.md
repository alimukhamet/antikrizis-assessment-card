# Contract preparation and sales handoff

Owner correction (2026-10-05): after the verified handoff package is saved, the
portal moves the existing sales deal directly into **Юристы → В ожидании**
(category 1, `C1:NEW`). This supersedes the September sales-final/robot route.
The transition remains at the existing handoff completion action: downloading
the contract does not bypass the later ЭЦП, доверенность and signed-PDF gates.

- Home has contract, handoff, and the existing credit-report analyzer. Home links
  never select a client. The shared form keeps all original fields and evidence.
- Contract generation requires the original six non-handoff document types and
  applicable salary/benefit documents. ЭЦП and доверенность belong to handoff.
- Handoff requires the selected client's saved ЭЦП/password, validated power of
  attorney, and the final signed TrustMe PDF. Staff explicitly checks signature
  and QR; the portal does not claim cryptographic verification of either.
- The stage adapter accepts only an open sales category-13 deal. At preparation,
  before uploads and immediately before moving, it checks the current source
  stage and the unique `DEAL_STAGE_1` / `C1:NEW` target named «В ожидании».
  Closed, failed, changed or unverified stages block the operation.
- After file byte readback, one `crm.item.update` changes `categoryId` and
  `stageId`, with only the existing frozen, source-backed VP title adjustment
  when required. Other deal fields and robot configuration are unchanged.
- The durable handoff record pins identity, staff, selected documents, reviews,
  and target. Only one non-cancelled handoff may exist per case, even after success.
  Once a stage write may have started, retries are read-only. Fresh history of
  the frozen target proves completion if later automation already moved onward.
- Existing writing/uncertain receipts retain their original sales-final target
  for read-only recovery. An old prepared attempt must be cancelled/reprepared
  before uploads; its target and existing file receipts are never rewritten.
- Prepared attempts can be cancelled without deleting files. An uncertain attempt
  cannot be cancelled or automatically resent. Resolve its result in Bitrix.

Tests cover the stage adapter, durable claims, file readback, wrong-client gates,
staff/CSRF protection, the real script load order, deliberate client selection,
and restored power/signed files. Automated fixtures are synthetic. A production
customer must not be advanced just for testing; runtime stage verification and
the first authorized real handoff are separate from local test/build success.
