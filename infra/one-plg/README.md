# One PLG infrastructure

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
