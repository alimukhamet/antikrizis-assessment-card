# Contract preparation and sales handoff

Confirmed workflow (2026-09-16): the portal saves the handoff files in the current
sales deal, then moves it to **Сделка завершена**. The existing Bitrix robot owns
onward routing. Do not move the deal directly into the legal pipeline or recreate
the robot in this application.

- Home has contract, handoff, and the existing credit-report analyzer. Home links
  never select a client. The shared form keeps all original fields and evidence.
- Contract generation requires the original six non-handoff document types and
  applicable salary/benefit documents. ЭЦП and доверенность belong to handoff.
- Handoff requires the selected client's saved ЭЦП/password, validated power of
  attorney, and the final signed TrustMe PDF. Staff explicitly checks signature
  and QR; the portal does not claim cryptographic verification of either.
- The stage adapter restricts handoff to sales category 13. On every preparation
  and immediately before updating, current CRM metadata must confirm C13:WON
  is named Сделка завершена. A mismatch blocks the operation; never guess a
  similarly named stage in another pipeline.
- The server reads back the file contents before changing only STAGE_ID. No
  category, owner, or robot configuration is changed by this endpoint.
- The durable handoff record pins identity, staff, selected documents, reviews,
  and target. Only one non-cancelled handoff may exist per case, even after success.
  Once a stage write may have started, retries are read-only. Fresh stage history
  can prove completion if the robot has already moved the deal onward.
- Prepared attempts can be cancelled without deleting files. An uncertain attempt
  cannot be cancelled or automatically resent. Resolve its result in Bitrix.

Tests cover the stage adapter, durable claims, file readback, wrong-client gates,
staff/CSRF protection, the real script load order, deliberate client selection,
and restored power/signed files. Automated fixtures are synthetic. A production
customer must not be advanced just for testing; runtime stage verification and
the first authorized real handoff are separate from local test/build success.
