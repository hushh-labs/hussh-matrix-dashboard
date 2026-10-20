# One PLG infrastructure

Reviewable provisioning for the pilot. Nothing in this directory has been
applied. Matrix and the audience follow-up remain PR-only; their merge,
provisioning and production activation have not been authorized. The earlier
backend foundation PR8240 was separately authorized, merged and deployed to UAT.

## Resources

- Native database `hushh-ai-prod/one-plg-production`, deletion protected, PITR
  enabled. The existing `(default)` database is Datastore mode and stays intact.
- Database-scoped `roles/datastore.user` for the existing dashboard runtime.
- Six Secret Manager containers in `hushh-ai-prod`, three in `hushh-pda`.
  No secret values are Terraform inputs, resources or outputs.
- Worker and scheduler identities. The worker can read its request key; it
  cannot read Firestore, the One source key, customer content or sender keys.
- A Cloud Run job using an immutable reviewed dashboard image, with automatic
  retries disabled. It imports evidence using `--sync-only`; it cannot send email.
- A paused Cloud Scheduler job. Its identity can invoke only that Cloud Run job.

Google supports [separate database modes within a project](https://cloud.google.com/blog/products/databases/manage-multiple-firestore-databases-in-a-project)
and [database-scoped IAM conditions](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions).
Server SDK access uses IAM. Do not grant browser clients access to this database.

## Release procedure, after separate approval

1. Enable the Firestore, Secret Manager, Cloud Run and Cloud Scheduler APIs if
   needed. Use a separately authorized provisioning identity. Confirm the
   named database does not already exist; import any existing resources into
   state rather than replacing them. Use a private remote state backend with
   locking and restricted IAM before applying this configuration.
2. Run `terraform init`, `terraform fmt -check` and `terraform validate`. First
   plan with default `worker_image=null`: this provisions storage, identities
   and empty secret containers without a worker that depends on missing values.
   Review before apply. Never put secret values in a plan or tfvars file.
3. Populate independent signing and sync keys with at least 32 random bytes each, the explicit admin
   and operator email lists, and the source key through Secret Manager secure
   stdin. Source-key values must match in `metrics-one-plg-source-secret`
   (`hushh-ai-prod`) and `ONE_PLG_EXPORT_SECRET` (`hushh-pda`). Never reuse the
   application signing key, session key, OTP key or personal credentials.
4. Populate `ONE_PLG_EXPORT_ACCOUNT_IDS` with the comma-separated production
   customer Firebase UIDs explicitly enrolled in the pilot. Maximum 100.
   This is private information: keep it out of Terraform state and PRs.
   After all required secret versions and IAM are present, review a second plan
   with `-var='worker_image=<reviewed image URI with sha256 digest>'` to create
   the sync job and its paused scheduler.
5. Review the backend companion PR, enable `one_plg_export_enabled` in its
   existing production runtime-config secret, and release that exact reviewed
   code through the backend's established release procedure. Its optional
   secret bindings are production-only and use the two local secret names.
6. Only after provisioning and secret versions are ready, set repository
   variable `ONE_PLG_CONFIGURED=true` for the separately approved dashboard
   release. The existing candidate workflow binds the named database and five
   secrets, and explicitly keeps `PLG_DELIVERY_ENABLED=false`. It retains the
   zero-traffic candidate and Google sign-in verification procedure.
7. Use the private workspace to enroll the same accounts with explicit consent
   records. Run `npm run plg:worker -- --sync-only` using Secret Manager-backed
   settings. Verify imports, replay deduplication and a controlled deletion.
   Review the worker image digest each release; apply a reviewed updated plan.
8. After candidate promotion and a successful controlled sync, unpause the
   scheduler through a reviewed configuration change. Keep campaigns paused
   until the separate sender integration is complete.

## Email remains a release prerequisite

The private **Agent people** reader is a separate rollout. Populate independent
`metrics-one-plg-audience-secret` (`hushh-ai-prod`) and
`ONE_PLG_AUDIENCE_SECRET` (`hushh-pda`) with the same new HMAC key through secure
stdin. Do not reuse signing, sync or snapshot keys. Runtime IAM grants only the
corresponding dashboard/backend access; the sync worker receives neither key.
After the follow-up backend migration366 and reader have been reviewed/released,
separately enable backend `one_plg_audience_enabled` and repository variable
`ONE_PLG_AUDIENCE_CONFIGURED=true` (requires `ONE_PLG_CONFIGURED=true`). The
candidate workflow checks enabled version metadata, mounts the new key and
verifies its exact secret reference. A false/unset audience variable clears the
source URL on deploy, disabling the reader even if an older key mount remains.
Expanded collection additionally needs `one_plg_activity_enabled` and
`one_plg_activity_all_registered`, with canonical registered-contact admission.
These settings do not enroll accounts, copy the full directory to Firestore,
enable delivery or change messaging permission. Verify source traversal,
missing/cleared phone handling and signed cursor filtering privately before
launch. All flags remain off and no provisioning was performed in this PR.

The team has not yet identified its marketing email provider, verified From
identity or Reply-To address. Accessible secret-name inventories were checked in
`hushh-ai-prod`, `hushh-pda` and `hushh-tech-prod`; no marketing-provider credential
was identified. The existing One mail API's delegated sender is OTP-only.

Do not substitute OTP or generic SMTP credentials. Once the team supplies the
provider/account, verify sender/domain authentication, provider acceptance,
signed bounce/complaint callbacks and one-click unsubscribe with a controlled
recipient. Implement the matching adapter if the provider is not Resend. The
current Resend adapter is retained, but no provider has been selected or bound.

## Rollback

Pause the scheduler and campaigns; disable the export flag and dashboard PLG
feature. Roll back service revisions through the existing release procedures.
Retain the database, deduplication ledger, suppression records and secrets.
Do not destroy protected state as an application rollback.
