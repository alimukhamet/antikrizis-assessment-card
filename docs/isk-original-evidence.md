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
