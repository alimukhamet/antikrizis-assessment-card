## Production source rule

Publish the combined application only through the `deploy/anti-krizis` branch and its GitHub release workflow. Direct local Wrangler publication is blocked: an older checkout previously replaced newer intake screens while publishing earnings changes. Preserve and merge both areas before release. Do not remove the guard to publish a feature from an old checkout.

# Release and recovery

Checked on **12 September 2026**. Publication and pushing the canonical repository await user approval. This procedure is not proof of a hosted rollback.

## Published recovery reference

The canonical Site is still on version **34**:

- Project: `appgprj_6a5aabe71a6081918018d373a3c5716f`
- Version: `appgprj_6a5aabe71a6081918018d373a3c5716f~appgver_ba20973cebd48191b12b06ec405c8ae4`
- Source commit: `923aed9f31287a8fc252f0d2817b4513b823ce1d`
- Archive SHA-256: `a5267b65f9ff38468e4c7eb9627b2cbcf548a0521a3c1ed399271d6c04338b74`
- Successful deployment: `appgdep_6aa2b92270c48191965fefa6d5bf4aee`

Recheck the publication immediately before release. Inspect and preserve any intervening source changes. Do not create a substitute Site.

The inspected hosted database overview had no existing assessment bindings or user tables. The candidate introduces persistent `DB`/`FILES` resources. The old archive is therefore not a data backup. Confirm with the hosting provider that these new resources survive an old-version redeployment before relying on that rollback. Current tools have not proved that retention behavior.

## Release gates

1. Verify a successful real payment-control login and session persistence after navigation/reload.
2. Complete and verify scanned financial document processing; do not silently replace that scope with native-only PDF parsing.
3. Verify the canonical project, DB/FILES bindings, all generated migrations, assets and pinned contract renderer in the exact release build. Exclude secrets, local databases and recovery bundles.
4. Establish hosted retention/recovery access. Keep the existing saved source version as the application recovery reference.
5. Obtain user approval of the finished preview. Only then push the exact approved source, save its version and publish through Sites to the existing Site and audience.
6. Verify hosted deployment status, bindings, real staff login and the authorized synthetic-deal workflow. Check persisted assessment fields, history, original bytes and contract download.

## Preserve case data

- Stop new intake while the operator assesses an incident. Do not reset prepared, writing or uncertain records directly in storage.
- Export each affected case through its authenticated history/evidence export. Retain ordinary originals and the renderer referenced by saved contracts.
- Recover EDS originals separately through the verified-receipt download path. Keep the recovery bundle private: even a legacy manifest filename can contain a password.
- Verify hashes and export structure, then restore into a **new** destination using the commands in [EXPORT_FORMAT.md](EXPORT_FORMAT.md). The restore tool refuses an existing destination and does not replay CRM writes.
- Compare restored IDs, order, identity/review revisions, original hashes, receipt states and saved contract data with the export before using the restored copy.

Local evidence: a running destination app returned the preserved saved contract and all 14 ordinary originals from the synthetic case. The separate fake credential was also recovered and packaged. Hosted restore remains unverified.

## Roll back the application

After confirming data retention and obtaining publication authorization, reuse the retained archive-backed version. Check the audience, deployment status and authenticated worker flow. Preserve DB/R2 data and operation receipts; a source rollback does not authorize deletion or replaying an uncertain CRM request.

If the provider's handling of new DB/R2 resources is unknown, resolve that gap before redeploying. Recreating the Site, dropping tables or blindly resending pending requests is not a recovery procedure.
