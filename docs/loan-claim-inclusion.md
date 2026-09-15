# Loan inclusion in the lawyer's claim

Every row in `draft.groups[id=creditors].rows` may contain the structured answer:

```json
{"key":"loanClaimIncluded","value":"on","checked":true}
```

`checked: true` means include the loan in the claim. `checked: false` is the employee's instruction to the lawyer to exclude that specific loan. An absent answer in an older draft or submission means **include**; never interpret a missing field as an exclusion.

The flag is independent of loan eligibility, source verification, current outstanding debt and the client's total debt. Exclusion does not delete a loan, waive its required answers, remove it from source reconciliation, or subtract it from total debt or the service contract's financial record.

The immutable submission draft and Assessment-to-CRM intake retain the answer with the creditor row and its existing `rowKeys` identity. The lawyer card repeats the flag for each loan and lists exclusions prominently by row, creditor and amount. A consumer building a claim must read this structured flag; it must not infer it from a missing loan or parse the narrative as a substitute.

New and legacy rows default to included. Saving, reopening, and reanalysing source documents preserve an explicit exclusion. The tool records the employee's instruction; it does not itself file a legal claim.
