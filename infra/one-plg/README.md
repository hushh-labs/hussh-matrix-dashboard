# One PLG infrastructure

## Dev and UAT owner-read runtime

The same `deploy-main.yml` workflow accepts `target_environment=dev|uat` after
the reviewed source has merged into `main`. The existing main-only Matrix
Workload Identity provider is reused; no branch trust, Production service,
Production traffic, database or mailbox grant is changed by this path.

Provision the additive `owner_environments=["dev"]` foundation with this
directory's existing private locked state, then include `uat`. Default is empty.
Review the complete plan and import any already-existing owned resources before
apply; do not use a second state for these addresses or recreate identities.
The new runtimes receive only their five named secret readers. The deploy
identities get Cloud Run administration in their respective nonproduction
project, act-as only on their own runtime, secret-version metadata (not payload)
and the needed image-repository access. Dev builds the immutable image; UAT
pulls that same digest. No production database/secret access is provisioned.

Configure a separate Google Web OAuth client in each target project. Register
only its corresponding callback below. The deterministic Cloud Run URL format
is [documented by Google](https://docs.cloud.google.com/run/docs/triggering/https-request);
the deployed native revision and anonymous auth boundary are checked separately.

| GitHub environment | Project | OAuth callback |
| --- | --- | --- |
| `matrix-dev` | `hushh-pda-dev` | `https://hushh-matrix-dashboard-621416509462.us-central1.run.app/auth/callback` |
| `matrix-uat` | `hushh-pda-uat` | `https://hushh-matrix-dashboard-745506018753.us-central1.run.app/auth/callback` |

Restrict each GitHub environment's deployment branches to `main`. Set its public
`MATRIX_GOOGLE_CLIENT_ID`, and `MATRIX_SECRET_VERSIONS` as a JSON mapping from
the following names to enabled numeric versions. Values are supplied to Secret
Manager through secure stdin, never Terraform/GitHub variables or this document:

- `metrics-dashboard-google-client-secret`: that environment's OAuth secret.
- `metrics-dashboard-session-secret`: independent cryptographically random key.
- `metrics-dashboard-allowed-emails`: the explicit testing cohort.
- `metrics-one-plg-owner-source-secret`: independent environment read HMAC,
  paired with One's `ONE_PLG_DEV_EXPORT_SECRET` or `ONE_PLG_UAT_EXPORT_SECRET`.
- `metrics-one-plg-owner-email-hashes`: SHA256 of normalized verified cohort emails.

The cohort and its paired One UUID allowlist must come from current authenticated
owner identities, never invented fixture IDs or another environment's snapshots.
No secret version is created by Terraform. Missing/disabled/unpinned versions
fail before image or service mutation. OAuth consent/callback configuration
requires the authorized client's actual setup; a container or public client ID
alone does not establish working sign-in.

Dispatch the existing workflow from `main` with the exact merged `source_sha`
and its successful canonical `Responsive dashboard UI` PR `ci_run_id`. All
three jobs must have actually passed for that SHA. UAT additionally requires
`dev_run_id`, whose successful canonical runtime artifact binds the same source
and image digest. No production image, mutable tag or differently sourced Dev
receipt is accepted. This workflow manages only the named Matrix service in
the selected project and refuses an existing service with another owner label.

`MATRIX_OWNER_READ_ENABLED` defaults false. Enable it only after the paired One
release, separate source key/cohort and signed identity are ready. A runtime
artifact explicitly records `interactiveSignInVerified=false`,
`behaviourVerified=false`, `emailEnabled=false` and `inboxVerified=false`:
native readiness and an anonymous OAuth boundary probe are not those proofs.
Complete actual Dev owner-flow verification before proceeding to UAT acceptance.
This foundation intentionally creates no Gmail grant, outbox worker, scheduler,
customer campaign state or per-attempt preference. Those remain separately
authorized release configuration and acceptance, not implied by runtime deploy.

The nonproduction deployment replaces its owned manifest, clearing stale
credentials/settings, and checks exact source/image/runtime/secret references.
It serves the nonproduction revision at100% and does not mutate Production.
If postdeploy verification fails, record it as failed and inspect native state;
do not blindly rerun or change another operator's traffic. Restore the recorded
prior reviewed nonproduction manifest through the same workflow as needed.

The production foundation uses the named Native Firestore database
`hushh-ai-prod/one-plg-production`, protected against deletion with PITR enabled.
The existing `(default)` Datastore database is separate. Runtime access is IAM
scoped; browser clients receive no database access.

## Runtime and sender configuration

Secret values never enter Terraform inputs, outputs or plans. Provision containers
with this configuration and populate enabled versions through Secret Manager stdin.
The source, private audience, sync, cycle and preference signing keys are independent.
Bind `metrics-one-plg-cycle-secret` to `PLG_CYCLE_SECRET`. The scheduled worker
receives this dedicated key, not the preference/enrollment signing key.

The approved Google Workspace From is **Neelesh Meena <i-neelesh@hushh.ai>**,
Reply-To **i-neelesh@hushh.ai**. Bind these through `metrics-one-plg-email-from`
and `metrics-one-plg-reply-to`. The mailbox owner's separate Google OAuth consent
grants mail access; GCP IAM only permits use of the stored grant. Customer
delivery additionally requires the feedback grant and canonical permission
release described in `docs/plg-google-mail.md`. The existing One OTP sender
remains restricted to OTP messages.

The current adapter uses Resend. Its runtime secrets are
`metrics-one-plg-resend-api-key` and `metrics-one-plg-resend-webhook-secret`.
Empty containers are not working credentials. Use an organization-authorized
sending account and domain-restricted sending key. Register signed events at
`https://metrics.hussh.ai/integrations/plg/resend`, including sent, delivered,
bounced, complained, failed and suppressed. Preserve receiving MX records.

Repository release variables have separate meanings:

- `ONE_PLG_CONFIGURED=true`: mount the named database and workspace/source keys.
- `ONE_PLG_AUDIENCE_CONFIGURED=true`: mount the independent registered-people reader.
- `ONE_PLG_SENDER_CONFIGURED=true`: mount From and Reply-To secret references.
- `ONE_PLG_DELIVERY_CONFIGURED=true`: enable transport and mount provider secrets.
  Set this only after authorized account/domain setup and a controlled delivery,
  callback and unsubscribe test. It requires workspace and sender configuration.

The candidate workflow validates enabled version metadata and exact secret
bindings. Disabling the workspace explicitly clears workspace/delivery flags and
the source endpoint. A disabled delivery flag overrides retained credential mounts.
The existing zero-traffic candidate and verified promotion procedure remain.

## Automatic cycle

Use an immutable reviewed dashboard image digest as `worker_image`. The existing
Cloud Run job and scheduler are extended rather than replaced:

- Default `automatic_cycles=false` retains the sync-only worker.
- `automatic_cycles=true` runs `node scripts/plg-worker.mjs --cycle` with its
  dedicated cycle key. The worker has no Firestore, enrollment signing, source
  or provider credentials.
- Default `scheduler_enabled=false` keeps scheduled polling paused.
- The endpoint owns a transactional five-minute lease, syncs authoritative
  evidence, then evaluates website automation/campaign pauses, sender, consent,
  suppression, holdout, readiness, publication and contact limits.
- Source failure stops sending. Empty snapshots never prove inactivity.
- The cycle budget is 210 seconds. Provider calls have a 15-second timeout and
  new reservations stop with less than 20 seconds remaining. Worker HTTP timeout
  is 240 seconds; job timeout is 300 seconds. Automatic job retries stay off.
- Replayed requests cannot repeat a reserved journey step. Definitely unattempted
  reservations can be released; ambiguous provider attempts cannot. Signed
  callbacks correlate opaque delivery IDs and reconcile known outcomes without
  downgrading delivery/failure states or repeating sends.
- Website status reports observed heartbeat, sync, cycle, exceptions and capacity.
  A recent heartbeat is not a guarantee of future scheduler execution.

The legacy signed run endpoint shares this cycle, including fresh sync and the
website pause. Prefer `--cycle`; do not combine it with legacy worker flags.

## Apply and activate

1. Use the existing private GCS state with locking. Import existing resources,
   including containers already created by an operator; never recreate them.
2. Run `terraform fmt -check`, `terraform init` and `terraform validate`. Review a
   plan against current cloud state. Keep polling paused during rollout.
3. Preserve existing identities, keys and database. Populate only actual sender
   values/provider credentials through secure stdin; no placeholder versions.
4. Release and promote the reviewed dashboard commit through its existing
   candidate workflow. Apply the immutable worker-image/cycle plan after promotion.
5. Run a controlled cycle and inspect private status. Configure One's existing
   explicit export cohort and permission-backed enrollment source. A registered
   account directory is not marketing permission or complete observation coverage.
6. After successful sync, enable scheduled polling with a reviewed
   `scheduler_enabled=true` plan. Keep outbound transport gated until sender
   testing and content/readiness review are complete. Website controls then manage
   routine operation without per-message operator work.

The pilot admits at most 100 contacts and a 750 KB transactional document. Do not
remove caps or prune deduplication/suppression history to simulate scale. A proven
consent producer, complete coverage for inactivity journeys, mailbox reply handling
and larger-cohort storage remain integration requirements, not inferred capabilities.

## Rollback

Pause automatic follow-ups and campaigns, then polling if required. Disable the
relevant release variables and use the existing candidate/promotion path. Preserve
Firestore, suppression, permanent reservations, signing-key continuity and previous
healthy revision evidence. Do not destroy protected state as application rollback.
