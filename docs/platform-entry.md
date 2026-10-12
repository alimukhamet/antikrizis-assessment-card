# Sales entry to Platform

The launcher displays «Сделки» next to «Профиль» only for authenticated
`darkhan`, `ramazan`, and `nurdaulet`. It opens a new tab, retaining the
Assessment page and draft. No additional Platform password is created.

A same-origin POST to `/platform-entry` signs a single-use 60-second ticket.
The subject comes exclusively from the verified Assessment session. The ticket
is posted in a form body to the fixed Platform entry endpoint; it never appears
in a URL, persistent browser storage or application logs. Responses are private,
uncacheable, and use a restrictive CSP. GET does not issue a ticket. After an
expired Assessment login the user returns to a local confirmation button.

Platform validates the signature, exact issuer origin, audience, lifetime and
nonce, then verifies the dedicated employee is active and view-only. Nonce
redemption and its audit event are atomic. Platform rechecks the identity and
view-only ceiling on every request, including when the normal cookie is still
valid. Existing non-view-only Platform sessions are preserved.

## Release gates

Both production releases require the owner's separate approval. Assessment
`main` automatically deploys, so do not merge its PR as a preparation step.

1. Complete both PR checks and synthetic hosted staging verification of both
   applications with matching staging-only secrets. Keep production endpoints
   out of test fixtures; use a temporary local browser harness or isolated
   canonical-origin routing for the fixed-origin integration.
2. Obtain approval for Platform: verify current main and unused migration number;
   apply its additive Assessment entry migration, configure `ASSESSMENT_ENTRY_SECRET`
   via protected stdin, then publish clean CI-passed main with existing bindings.
   Follow Platform's `docs/assessment-entry.md` for rollback and live gates.
3. Obtain approval for Assessment: configure the same production value as
   `PLATFORM_ENTRY_SECRET` via protected stdin. Never put it in Git, shell arguments,
   workflow logs or a browser asset. Merge the CI-passed PR and let the canonical
   deployment workflow publish. Re-read exact release assets and authentication.
4. Verify the actual salesperson click-through, deal/documents visibility and
   mutation denial. Local synthetic proof is separate from staff acceptance.

No client facts, tasks, documents, payments or CRM stages are changed by entry.
Assessment retains its existing authentication strength and account selection
rules; this feature does not upgrade the identity provider.

An administrator can disable a person at Настройка → Входы сотрудников
(source «через анкету»). Disablement blocks new entry and existing sales sessions
on their next server request. It cannot recall content already viewed/downloaded.
Re-enablement is not added by this change.

## Local verification — 12 October 2026

Both built Workers ran locally with synthetic D1/R2 and an HTTPS proxy that
kept canonical-origin redirects on the local computer. Chromium verified the
three identities, two visible fictional deals in different stages, preserved
Assessment tab, noopener, mutation denial, single-use redemption, and revocation
of both an existing session and a new entry. Unit checks additionally cover
expiry, forgery, audience, wrong subjects/origins, account promotion, concurrent
redemption, audit rollback and preserving an existing privileged session.

The locally installed Worker binaries use supported compatibility dates
(Assessment May 22, Platform August 6); production-date parity and hosted
verification remain release gates. No real employee/client record or secret
was used. The initial full runs encountered local port restrictions (Assessment)
and resource timeouts (Platform); affected files passed unchanged on isolated
reruns. The GitHub push was blocked by automatic approval review pending
explicit permission to transfer source to the existing repositories.
