# ISK original evidence feed

The existing server-to-server profile feed accepts `include=isk-originals`. It adds an `iskOriginals` object without changing the profile JSON/hash, saved answers or completion receipts. Calls without the opt-in retain the existing response.

```ts
{
  schema: 'antikrizis.isk-originals.v1',
  documents: [{ id, original_name, content_type, size_bytes, sha256 }],
  loanDates: [{ documentId, sha256, subjectIin, contractCode, contractNumber,
    startDate, disbursementDate, page, quote }]
}
```

`GET /api/profile-feed/{dealId}/documents/{documentId}` requires the same `PROFILE_FEED_TOKEN`. It resolves the exact Bitrix case and document membership, verifies original bytes against SHA-256 and size, and returns an attachment with `x-original-sha256`, `no-store` and `nosniff`. There is no listing across cases, storage URL, cookie authentication fallback, write, redirect or CRM call. Consumers must enforce employee case grants before proxying these endpoints. PDFs, JPEG/PNG photos and signed PDF containers are supported; credential files, archives and unsupported formats are excluded.

Catalogs exceeding 500 originals fail explicitly instead of silently dropping documents. More than 1,000 date facts also fails explicitly. Quotes are limited to 4,000 characters. Dates are ISO days, never a default first day of a questionnaire month.

Native parser v32 stores `credits[].contractStartDate` as an optional fact containing the full day, original page and page excerpt. Existing questionnaire `facts`, month values, source bindings and employee confirmations remain unchanged. Existing v31 analyses remain compatible. The feed maps only new native v32 stored extraction results after result-hash verification; it does not reparse PDF files or invoke OCR on a request. It requires a checksum-valid, nonempty subject IIN matching the verified profile, readable identity/date pages, exact original wording, and both available contract identifiers. Spouse reports cannot supply applicant dates. `disbursementDate` is currently null because contract commencement does not establish disbursement.

Legacy retained analyses may therefore return an empty `loanDates` array. The downloadable original is the evidence for manual exact-date preparation. This feature does not certify document authenticity or approve a filing package.

Validation uses synthetic original bytes and cases in a built Worker with isolated D1/R2: token rejection, cross-case rejection, original/result hash failures, unchanged default profile, date provenance and unchanged saved data. Deployment must retain the existing DB/FILES bindings and PROFILE_FEED_TOKEN; no migration or new secret is needed. Main auto-deploys through the canonical GitHub workflow, so merging is a production release step.

## Full loan dates and retained reports

The questionnaire stores `creditors[].n8038Start` as an ISO calendar date (`YYYY-MM-DD`) for new precise entries. Historical `YYYY-MM` values remain unchanged and display “день не указан”; they never become the first day of a month. `loanDisbursementDate` is a separate optional ISO date. Commencement and actual disbursement retain separate labels, evidence and source pages. Russian editors and generated cards show `DD.MM.YYYY`; the saved profile feed preserves canonical strings. An issuance-only source can satisfy the date question without inventing commencement.

Native rules v33 retain optional `contractStartDate` and `disbursementDate` outside the historical month facts. Existing extraction/review IDs remain compatible. The old Kazakh PKB issuance mapping is not proposed as a commencement date by new clients. Precise date proposals do not silently overwrite employee answers; a retained month can be refined with an explicit source action.

For pre-v32 reports, `loan-dates-1` derives only dates from hash-verified retained readable pages. It requires the same valid applicant IIN and unique lender/contract identifier matches against the original analysis. Explicit document analysis adds a separate immutable extraction (`loan-dates-1:<sourceExtractionId>`) whose confirmations are independent. The historical analysis and its reviews are never replaced or inherited. No PDF rereading, OCR or paid service is involved.

The opt-in ISK feed may derive the same date-only proposals read-only. A bounded in-memory cache avoids repeating text extraction for the same immutable result. `loanDates` permits a nullable `startDate` or nullable `disbursementDate`, with at least one exact date; complementary dates may be separate facts on separate pages. Derived facts add `evidenceVersion` and `sourceExtractionId`. Consumers must merge only exact identity/contract matches, preserve each supporting page/quote, and reject contradictory non-null dates. These newly exposed facts legitimately change the ISK source fingerprint; they do not change stored profile JSON or imply review.

New draft clients send `loanDatesVersion: 1`. Old month-only clients cannot save over a draft/profile already containing a precise loan date, because their browser inputs would otherwise silently blank it. The refusal leaves both stored data and unsaved browser input intact. Ordinary legacy-only drafts remain writable. No bulk client update or implicit confirmation is performed.
