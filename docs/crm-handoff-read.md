# Platform reads of verified handoff files

The Platform may read the files already delivered by a verified lawyer handoff without replaying any sending or stage operation. This bridge does not sync cases, change receipts, copy keys into evidence storage, or expose a staff session. Platform must enforce the authenticated employee's personal case access; credential metadata and bytes require its active assigned lawyer or authorized administrator gate.

`POST /api/assessment/{numericDealId}/crm-handoff` uses the existing Assessment intake HMAC secret and approved-origin configuration. Sign canonical JSON using `assessment-intake-auth.ts` (timestamp, signature, source origin). The operation is part of the signature. No browser receives this shared secret.

List request: `{ "operation": "assessment-handoff-list", "dealId": "11665" }` (synthetic ID).

A successful response has `status: "ready"`, `identityRevision`, `handoffRequestId`, `handoffPayloadHash`, and `artifacts`. Each artifact contains:

- `kind`: `power-of-attorney`, `signed-contract`, or `credential`;
- `dealId`, `identityRevision`, `handoffRequestId`, `handoffPayloadHash`;
- `uploadRequestId`, `uploadPayloadHash`, `fileId`, `sha256`, `sizeBytes`;
- `filename` and `descriptorHash`.

There are two ordinary documents and one to ten key files. Every key is a separate descriptor. Names are fixed `power-of-attorney.pdf`, `signed-contract-trustme.pdf`, or `credential-{fileId}.{p12|pfx|key|jks}`. Legacy source names can contain passwords and must never be serialized, logged, cached or added to ordinary document libraries/ZIPs. The descriptor hash is SHA-256 of the canonical descriptor excluding `descriptorHash`.

Download request: `{ "operation": "assessment-handoff-artifact", "dealId": "11665", "descriptor": <exact listed descriptor> }`. Selection is revalidated before and after reading the bytes. The current latest noncancelled handoff must be verified for the current identity; its credential receipt must still be the latest owner-confirmed verified credential. No fallback to older verified keys occurs when a replacement is pending. Immutable handoff/upload payload hashes, receipt membership and original document hashes/sizes are checked. Bitrix identity and current file membership are refreshed for each download; trusted origin/redirect and actual streamed-size limits are enforced before the byte hash is checked.

The response is attachment bytes with a neutral filename, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Content-Length`, and `X-Content-SHA256`. Consumers must enforce their own size ceiling, compare the returned size and byte hash, and recheck current employee access before returning bytes. Ordinary originals are capped at 35 MiB each; credential files total at most 2 MiB.

Errors are fixed JSON codes only: missing case/handoff returns 404; pending/changed/unverified selection returns 409; authentication returns 401/403; unavailable/invalid upstream content returns 503. List metadata describes verified stored receipts; current remote byte availability is established only on download. No filenames, passwords, signed URLs or raw exception messages appear in errors.

Local verification covers the source-selection and Bitrix-reader boundary plus a built Worker with synthetic persisted records and all file downloads. CI, coordinated deployment, and actual authorized Platform downloads of the reported case remain separate release gates.
