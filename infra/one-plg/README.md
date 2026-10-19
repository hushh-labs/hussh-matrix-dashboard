# One PLG infrastructure

Reviewable provisioning for the pilot. Nothing in this directory has been
applied. The user requires PR-only work and has not authorized a merge or release.

## Resources

- Native database `hushh-ai-prod/one-plg-production`, deletion protected, PITR
  enabled. The existing `(default)` database is Datastore mode and stays intact.
- Database-scoped `roles/datastore.user` for the existing dashboard runtime.
- Five Secret Manager containers in `hushh-ai-prod`, two in `hushh-pda`.
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
