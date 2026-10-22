# One PLG workspace

The private workspace is available at `/plg`. It adds a shared queue, enrollment,
follow-up ownership, blocker notes, message editing, newsletter editions, journey
readiness, campaign previews and measured first-value/returning-account counts.
The module starts disabled. Campaigns start paused, journey readiness is false,
and all message templates start as drafts. No contacts are preloaded.

## Reading the workspace

The default **Users & drop-offs** view reads the authorized live One directory;
it is independent of campaign enrollment. **Messages** holds reviewed content,
**Results** separates app-wide usage from campaign outcomes, and **Automation**
shows worker health, setup blockers and pause controls. The campaign follow-up
queue and agent/action coverage remain available inside their related views.

Results loads the existing `/api/analytics/one/app` aggregate only when opened,
using the shared session-scoped metrics resource. The reporting period supports
7, 30 and 90 days. Registered totals require an available, isolated production
registry. They describe current account records, including disabled accounts;
deleted accounts are absent. New accounts are current records created during
the requested dates, not a historical signup ledger.

App-wide signed-in accounts and device/browser IDs are separate counting units.
DAU/WAU/MAU use the latest finalized GA4 measurement day with 1/7/30-day windows,
which can precede the selected end date. The source snapshot time does not make
these realtime. Each activity query carries its own availability; failed,
missing or malformed reads remain unavailable even if other sources succeeded.
Older API responses without that proof cannot populate the new PLG activity
cards. Selected-range signed-in totals have independent query health.

Automation also distinguishes the last catalog/source refresh from the last
enrolled-account evidence read. An empty cohort can refresh its action catalog
without reaching the campaign evidence endpoint; it must not advance the
evidence timestamp. Existing timestamps are not backfilled into this new proof.

Campaign activation and retention cover enrolled accounts only. Audience page
matches are not global totals, signup-to-activation conversion is not obtained
by dividing independently scoped counts, and observed later usage is not proof
that an email caused a return. Click and authenticated-return attribution still
require their own recorded evidence. Seven-day best-effort attempt observations
cannot reconstruct missing historical activity or prove complete collection.

## Backend evidence and release status

The companion One backend exposes server-only `POST /api/one/plg/snapshot`.
The dashboard's signed `POST /integrations/plg/sync` polls that route for
already-enrolled accounts in batches of five (backend maximum 20). Configure `PLG_ONE_SOURCE_URL` and
a dedicated `PLG_ONE_SOURCE_SECRET` matching backend `ONE_PLG_EXPORT_SECRET`.
Requests authenticate `snapshot\n<TIMESTAMP_MS>\n<EXACT_RAW_JSON_BODY>` with
HMAC-SHA256, a five-minute replay window and no redirects. No browser receives
the credential or source response.

The dashboard sync endpoint and worker use a separate `PLG_SYNC_SECRET`.
That credential cannot authenticate enrollment events, delivery runs or
preference links; the sync job never receives `PLG_SIGNING_SECRET`.

The backend requires production runtime identity, an enabled flag and an
independent private allowlist of at most 100 pilot UIDs. Version1 queries
confirmed Memory mutations and provider-confirmed Mail sends. Version2 adds
the public-agent domain outcome contracts documented below, exporting compact
counts, timestamps and UTC days rather than effect IDs. The bridge validates every batch before committing and
deduplicates repeated queries. No prompts, content, domains, recipients or email
bodies are exported.

Memory requires explicit owner confirmation and an exact plan/commit binding.
Older writes without authorization-mode provenance remain unclassified.
Automatic saves, upgrades, source refreshes and scheduled Mail sends cannot
inflate returning-usage counts.

Retained task rows prove positive outcomes only. Empty snapshots never emit
`observation_completed`, infer inactivity or create a new-signup cohort.
`observationAt` is independent of `telemetryAt`; records without an explicit
complete observation remain unknown for behavioral reminders. Setup, failures,
support and enrollment remain separate trusted producers. Enrollment and
messaging permission still require the reviewed workspace or signed producer.

An authoritative account-deletion tombstone removes the contact, its delivery
records and UID-bearing action keys. A UID hash blocks delayed re-enrollment;
opaque deduplication hashes remain. A sync failure commits no partial evidence
and aborts a worker's `--sync-first --send` sequence. Sync itself sends no email.

Production now requires `PLG_FIRESTORE_DATABASE=one-plg-production`, a named
Native database: the project's existing default is Datastore mode. See
[infrastructure and release procedure](../infra/one-plg/README.md). Its scheduler
starts paused and uses `--sync-only` until the separate reviewed automation
configuration is enabled. Source code and provisioning defaults do not attest
to live deployment or sender readiness; verify the release and runtime flags.

The team must confirm its marketing provider/account, verified From, display
name, Reply-To and signed bounce/complaint callback. GCP secret-name inventories
were inspected; no marketing credential was identified. The OTP sender is not
campaign authority. The Resend adapter is retained without a provider binding;
another existing provider needs its matching adapter. Live sender verification
and a controlled recipient test remain release prerequisites.

## Run locally

Use the existing dashboard Google sign-in. Set the following local configuration
in the ignored `.env.local`; do not commit credentials or customer data:

```dotenv
PLG_ENABLED=true
PLG_STORAGE=local
PLG_DATA_DIR=.plg-data
PLG_PUBLIC_ORIGIN=http://localhost:3001
PLG_ADMIN_EMAILS=
PLG_OPERATOR_EMAILS=
PLG_DELIVERY_ENABLED=false
```

Fill the allowlists with the actual signed-in team accounts. Ordinary dashboard
authorization never grants private PLG access. Admins can edit and publish
messages and change readiness/pause settings. Operators can enroll accounts,
manage assistance and preferences, and preview due messages. There is no local
authentication bypass. Run `npm start` and `npm run dev` using the repository's
normal development setup; ensure requests originate from the configured PLG
origin (use the Express-served production build locally, or set the origin to
the Vite origin when using its proxy).

Local storage persists across restarts and uses an exclusive file lock plus
atomic replacement. It is development-only and rejected for a production app.
After an unclean process exit, check that no worker is running before removing
a stale `state.json.lock` directory. Windows permissions should restrict the
data directory to the developer account.

## Production configuration

Use `PLG_STORAGE=firestore` and `PLG_FIRESTORE_PROJECT` for the approved project.
Provision a Firestore database and grant the runtime service account the
necessary Firestore access. The compatibility release keeps the legacy state at
`one_plg_pilot/state` authoritative until an explicit operator migration. The
bridge consults `one_plg_storage/control` in each consistent read/write transaction.
Existing enrollment and 750 KB materialization limits remain; history is never
trimmed to make a write succeed. This release is a normalized persistence
foundation, not an unrestricted enrollment or throughput rollout.

### Staged normalized storage

`PlgStorageMigration` in `src/server/plg/firestore-storage.ts` is an operator
library with no HTTP route or automatic cutover. Deploying the bridge does not
start migration. The existing `PlgStore.read/transaction` facade stays compatible.
New generations use `one_plg_generations/<generation>/one_plg_records/<opaque-id>`
for individual contacts, deliveries, event/dedup keys, erasure tombstones,
generation-bound revocations and subscription revision fences. Settings, catalog
and the optional-field shape remain in the separate generation metadata document.
Documents represent entities; they are not chunks of the previous payload.
Array order, duplicate legacy values and optional-field presence round-trip exactly.

Prepare and capture bridge-compatible **serving and rollback** revisions before
copying private data. Pause campaigns and the automatic worker and quiesce its scheduler/job;
pausing email alone does not stop evidence writes. Keep customer sending off.
Allow at least five minutes for existing writers to drain. Resolve any active
lease or `sending` reservation first; preserve accepted and uncertain records.
The operator must verify the actual revision images/source and record the
protocol-1 serving/rollback attestation. The library validates that explicit
attestation's shape and freshness; it does not independently inspect Cloud Run.

Run `begin(attestation)`, then `step(stage, batchSize)` until every record is copied.
Batches contain at most 100 entity writes and advance their cursor atomically.
The generation is bound to both the exact legacy document `updateTime` and a
canonical complete-state hash. A failed/interrupted batch resumes from its last
committed cursor. Legacy remains authoritative throughout copying. Any legacy
writer, including a rollback binary, can invalidate that snapshot; it cannot
silently update or activate it. Explicitly call `cleanup()` in bounded batches
to discard a stale stage before beginning another one. Interrupted cleanup
keeps the generation fenced from activation.

`verify(stage)` reconstructs the complete state and checks exact canonical parity.
`activate(stage, attestation)` repeats source-version, parity, quiescence and
writer-drain checks inside its authority-changing transaction. It then changes
the control authority and replaces the v1 payload with a version-2 fence without
private state. An old v1 writer fails validation or retries against that fence;
it cannot commit a stale snapshot. **Revision 313 and other pre-bridge binaries
cannot be a traffic rollback after normalized cutover.** Replace the captured
rollback before staging; legacy data remains valid for old binaries, but their
unguarded writes are not safe for a private staged copy.

Normalized operations read one consistent generation and atomically update only
changed/deleted entity records plus metadata/control. This facade still
materializes the bounded cohort and serializes mutations through a control
document. Per-request materialization and enrollment policy require separate
qualification before capacity grows. Ordinary changes exceeding 400 document
writes or the conservative 2 MB encoded budget fail before any authoritative
write. An over-budget account erasure instead atomically publishes its complete
redacted state in the fenced legacy layout and tracks the old normalized
generation for bounded cleanup. It returns pending and withholds the canonical
acknowledgement until that entire retained copy is gone and a source retry succeeds.
Only erasure effects commit during this fallback; unrelated changes in the same
caller callback wait for its successful retry, avoiding duplicate template/audit
or other mutations after a committed pending response.
Migration is also capped at 20,000 records, without changing legacy read/write
compatibility. Missing/corrupt/extra records fail parity rather than becoming
empty data. Firestore's own transaction/index limits remain additional gates;
see [Firestore transactions](https://docs.cloud.google.com/firestore/native/docs/manage-data/transactions)
and [request/index limits](https://docs.cloud.google.com/firestore/quotas).
Review index exemptions for the entity `json` field on the owned
`one_plg_records` collection group during cloud qualification; queries use the
collection/document identity rather than private payload fields.

A traffic rollback uses a qualified bridge binary and keeps the current authority.
For a deliberate data-format rollback, quiesce writers again and call
`rollback(attestation, expectedGeneration)`. It atomically exports the **latest**
normalized facts to the legacy layout inside a version-2 carrier; it never
restores the pre-migration backup. The carrier and authority keep old version-1
writers fenced after both rollback and erasure recovery. Finish bounded `cleanup()` of its
tracked retired generation before unpausing or beginning another migration.
Active generations cannot be cleaned up. Retired/stale private copies must not
be silently orphaned. Actual cloud migration, cleanup, index configuration,
cutover and traffic changes remain explicit release-owner operations.

If an activation or rollback commits but its response is lost, retrying the same
recorded transition returns read-only `alreadyActive` or `alreadyRolledBack`
receipts. These require the intended generation (and original source identity
for activation), recompute the current state hash and do not rewrite control.
An untouched legacy store or an erasure recovery cannot report a completed
rollback. A different generation fails rather than pretending that retry succeeded.

Account erasure is also fenced against inactive private copies. A bridge-store
erasure encountering staged/retired data first deletes at most 100 inactive
records and commits its cleanup cursor. If more remain, control records a durable
`cleanupRequired` intent and fences the stage from activation. The authoritative
erasure is held and returns an explicit pending error, even when that batch
removes the final inactive record. Subsequent store/source retries continue the
same cleanup; only a later retry after every inactive record and metadata copy
is gone applies the erasure. The canonical source projection stays unacknowledged
while held, so an interrupted process cannot turn cleanup into a completed
erasure. The operator helper can drain the same intent. Never acknowledge that
pending error as success or re-enable a pre-bridge writer during staging.

While cleanup remains pending, store retries advance at most one bounded cleanup
batch before evaluating the caller. Ordinary mutations and new reservations
are rejected without applying them. The sole mutation exception is a strictly
recognized positive receipt for an existing durable delivery, including the real
acceptance pause and sent-timeline effects. Its result is returned as success;
unrelated template, consent, suppression or other state changes remain blocked.
This preserves an in-flight provider response without treating arbitrary caller
callbacks as safe to replay after a committed error.

The dedicated `verify-plg-storage` CI job runs native Firestore transactions on
the loopback-only `demo-plg-storage` project and isolated `demo-` databases. It downloads
official emulator 1.22.0 with the SHA256 recorded by
[Firebase's emulator metadata](https://github.com/firebase/firebase-tools/blob/master/src/emulator/downloadableEmulatorInfo.json).
Missing emulator mode, unsafe host, skipped cases, parity failures or races fail
the job. No GCP credentials or production fixtures are used. For the same local
suite, set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8189` and
`PLG_STORAGE_EMULATOR_TESTS=true`, then run
`npx vitest run tests/plg.test.ts -t 'normalized Firestore storage'`.

Wire all runtime configuration through Google Secret Manager, following
`.codex/skills/gcp-secret-manager/SKILL.md`. Preserve existing Cloud Run bindings.
New configuration names are:

| Variable | Purpose |
| --- | --- |
| `PLG_ENABLED` | Enable the module; default false |
| `PLG_STORAGE`, `PLG_FIRESTORE_PROJECT` | Durable production storage |
| `PLG_PUBLIC_ORIGIN` | Canonical HTTPS origin, CSRF check and preference links |
| `PLG_ADMIN_EMAILS`, `PLG_OPERATOR_EMAILS` | Explicit, comma-separated team allowlists |
| `PLG_SIGNING_SECRET` | At least 32 characters; service requests and opaque preference links |
| `PLG_DELIVERY_ENABLED` | Explicit sending switch; default false |
| `PLG_RESEND_API_KEY` | Server-only Resend API key |
| `PLG_RESEND_WEBHOOK_SECRET` | Server-only Svix signing secret for callbacks |
| `PLG_EMAIL_FROM`, `PLG_REPLY_TO` | Verified sender and monitored reply mailbox |

Use a verified sender domain and configure the signed Resend webhook at
`/integrations/plg/resend` for delivered, bounced and complained events. Never
forward the runtime secrets to the frontend. Integration endpoints deliberately
sit outside cookie-authenticated `/api` routes and enforce their own signatures.

## Integrate One product events

This repository cannot establish task completion on behalf of the One product.
The One backend must send trusted, content-free milestones after checking the
authenticated Firebase account and the actual task result. Do not put the PLG
signing secret in web or mobile clients. Account enrollment uses the same
immutable Firebase UID. Only enrolled production customers are accepted;
internal and UAT traffic is rejected. No bulk contact export has been added.

Send JSON to `POST /integrations/plg/events`:

```json
{
  "eventId": "globally-unique-event-id",
  "accountId": "firebase-account-uid",
  "environment": "production",
  "internal": false,
  "journey": "memory",
  "kind": "task_completed",
  "occurredAt": "2026-10-19T10:00:00.000Z",
  "actionId": "stable-task-id",
  "result": "success",
  "deliberate": true,
  "verified": true
}
```

Supported kinds: `activity_observed`, `setup_started`, `task_completed`,
`task_failed`, `help_requested` and `observation_completed`. The last kind means
the trusted backend completed a source check for the account; it requires
`verified=true` and must not be emitted if source coverage is missing or stale.
It is not a claim that the user performed an action. Inactivity-based emails
need a complete observation within 24 hours. Event timestamps must fall after
enrollment and within seven days; replayed event IDs and successful action IDs
are deduplicated. Historical pre-enrollment success is not backfilled by this
pilot, so first value means first verified value since enrollment.
Neutral welcome messages and explicitly subscribed newsletters can run while
activity is unknown; they must not claim the user was inactive. Behavioral
reminders remain blocked until the product observation is complete and fresh.

For event requests, set `X-PLG-Timestamp` to Unix milliseconds and
`X-PLG-Signature` to the hexadecimal HMAC-SHA256 of:

```text
events\n<TIMESTAMP>\n<EXACT_RAW_JSON_BODY>
```

The separators are actual newline characters. Requests expire after five
minutes; retries use a fresh request timestamp and the same event/action ID.
The API records only allowed milestone fields, not product content.

For automatic new signups, use the same signed endpoint with
`kind=account_enrolled`, a stable `eventId`, `occurredAt`, `accountId`, `email`,
`name`, `cohort=new`, `journey`, `frequency`, `consent`, `consentSource`,
`environment=production` and `internal=false`. Enrollment is idempotent by
event/account. Permission must come from the actual preference choice; it must
not be inferred from registration. This event does not establish task activity.
Deliver enrollment before subsequent task events, using a background outbox in
the One backend so a PLG outage never prevents a customer signing up.

## Operate campaigns

1. Enroll an eligible production account and record messaging permission source.
   Assignment to the 20 percent comparison group is stable by account UID.
2. Verify each promoted task end to end in the released product and mark its
   journey ready. Replace draft copy and root links with reviewed task guidance.
3. Publish relevant messages. Newsletter version changes represent new editions;
   one edition can be sent at most once per account.
   Optional resource links support reviewed guides or videos on One, Hushh,
   YouTube, Instagram and X. The primary task action stays on `one.hushh.ai`.
4. Preview the next messages. Preview ignores the global pause only; it still
   enforces readiness, permission, suppression, preferences and contact limits.
5. Enable live delivery configuration and unpause only when launch is authorized.
   Use the website's automatic follow-up control and the approved scheduled
   `npm run plg:worker -- --cycle` job every 15 minutes. The server owns evidence
   sync, a transactional lease and bounded sending in one cycle. Browsing and
   previewing never send email; enabling future cycles can send eligible content.
   Each run processes at most ten due messages to bound worker duration.

Daily subscribers are limited to one promotional email per 24 hours. Weekly
subscribers can receive a weekly digest and up to three total promotional
emails per seven days. Updates-only subscribers receive no automated lifecycle
messages in this release. A due lifecycle message takes priority over the
newsletter. Assistance requests, suppression and comparison-group membership
block campaign sends. Following feedback, a 30-day promotional pause applies.

Preference and unsubscribe links are opaque and signed. GET opens a form and
never unsubscribes; explicit POST supports confirmation and one-click removal.
Preferences cannot clear a suppression, and no resubscribe bypass is exposed.
Preserve signing-key continuity so links in delivered emails remain valid.

Reservations are atomic across workers. Email payloads are immutable once
reserved; a Resend idempotency key is attached. Failed or ambiguous requests
remain `uncertain` and are never automatically retried. Review them against the
provider dashboard, including reservations stuck in `sending` after a process
crash. This is intentionally conservative because provider deduplication keys
expire after 24 hours. Eligibility is checked again before the external send;
an email already accepted by the provider cannot be recalled by a later event.

## Current release boundaries

### Optional One email preference connector (disabled until paired release)

One's separately validated preference producer records an explicit, unchecked-by-default
email choice in signed-in setup and account settings. Registration does not subscribe
an account. Matrix can pull its bounded production-only projection with a dedicated
credential, commit changes atomically, then acknowledge only exact revisions. Duplicate
projections replay safely; hash-only revision fences also cover absent contacts.

Automatic enrollments use the generic One journey from the validated catalog; they
do not assume that a person tried Memory. Original enrollment cohort and experiment
assignment remain stable. Current address, name, permission and frequency reconcile
without replacing historical task measurements. Turning permission off or temporarily
losing a verified recipient blocks delivery. Backend unavailability is a failed cycle,
never an inferred opt-out or successful send.

Unsubscribe suppresses immediately and commits a hash-only, generation-bound revocation
outbox in the same transaction. Scheduled cycles retry that intent before enrollment or
sending. An old-generation link cannot cancel a later explicit re-opt-in. Provider
bounce, complaint and suppression survive re-opt-in. Canonical frequency changes stay
in One account settings. Each outbound attempt checks the current revision, generation
and verified address with One, then rechecks local eligibility before the provider call.
Positive evidence fetched before a concurrent opt-out is discarded; authoritative
deletion still erases the account. Already accepted provider requests cannot be recalled.

Configuration is `PLG_ONE_SUBSCRIPTION_ENABLED`, the exact production
`PLG_ONE_SUBSCRIPTION_URL=https://api.hushh.ai/api/one/plg/subscriptions`, and
Secret Manager-backed `PLG_ONE_SUBSCRIPTION_SECRET`, matching backend
`ONE_PLG_SUBSCRIPTION_SECRET`. The deploy flag `ONE_PLG_SUBSCRIPTIONS_CONFIGURED`
defaults disabled and clears the endpoint when disabled. Terraform owns the dashboard
and backend secret containers and their scoped runtime accessors; the backend binder
mounts the enabled backend credential version.
The cycle worker receives neither credential.

This connector retains the existing **100-contact / 750KB pilot limit**. At capacity
the transaction fails without acknowledging the new projection or sending messages.
Normalized scalable persistence, backend migration/production release, paired permission
acceptance and authenticated delivery/callback acceptance remain release prerequisites.
Do not enable broad enrollment or call this connector an unlimited rollout.

### All-agent observation pilot

The **Agents and actions** tab discovers the authored product agents, generated
capability actions, registered agent/tool calls and closed frontend feature
events from One's signed version 2 source. Refresh works before enrollment to
load the catalog. Public, available agents become selectable journeys; their
new message templates stay drafts and readiness stays false until reviewed.
Internal or unavailable agents remain visible for coverage without enabling them.

For enrolled accounts, the workspace stores compact per-agent reports,
execution returns, errors and observed UTC days. Selecting an account fetches
action-level started/returned/failed/blocked counts on demand. Raw prompts,
arguments, responses, locations, financial information and private MCP tool
names never enter this pipeline. Only compact rollups persist in the existing
bounded 750KB pilot document; detailed action rows do not grow that document.
Refreshing or inspecting activity cannot enroll users or send email.

App reports and SDK returns establish **observed activity**, not a verified
business result. Such accounts display **Agent activity observed**. They never
inflate first value or retention. All twelve public agents now declare a narrow
domain outcome proof: confirmed Memory saves, Mail sends, Calendar changes,
saved Kai analysis, reviewed Career resumes, saved Wallet cards, information-request
replies, explicit Nav decisions, Location effects, approved document sharing and
CRM provider readback. One uses the backend's distinct-effect union, so a shared
Mail/KYC send or Memory/Kai save is counted once. Internal stages are shown as
internal; unavailable agents remain unavailable. Saved analysis does not mean a
trade, and an information-request reply does not mean identity verification.
The catalog table and each audience row show the precise value definition.

The client requests version 2 in five-account batches, validates the full
catalog, ownership, source, phase, window and aggregate limits, and commits only
after every batch validates. New proof identifiers must match the declared agent's
allowlisted domain contract; missing/cross-agent/unknown proofs fail atomically.
Generic event ingestion still cannot assert a new agent's business completion.
Version 1 remains supported for Memory/Mail; a
downgrade cannot activate a newly added agent. Repeated snapshots replace
compact activity and merge verified UTC days without adding duplicate events.
Inspection also honors authoritative account deletion and erases local records.
Each fetch has a 30-second maximum within a shared 135-second sync budget,
below the worker's 180-second HTTP timeout. Slow or over-budget snapshots
abort before any pilot state is changed.

Collection requires One migration365 and its independent off-by-default
`ONE_PLG_ACTIVITY_ENABLED` flag, production identity and explicit pilot UID
allowlist. It is prospective, best effort, limited to 500 observations per
owner per UTC day, and retained for seven days. Unknown/not-started/disabled
collection is shown as unavailable; missing rows never prove inactivity. A
capacity or retired-contract warning means incomplete retained coverage.
This view is not a complete app-wide DAU measure or historical backfill.
Account switches and same-owner resets fence delayed callbacks before transport;
reset/deletion also fence and erase the backend metadata.

The approved Google Workspace From is `Neelesh Meena <i-neelesh@hushh.ai>`,
with Reply-To `i-neelesh@hushh.ai`. Sender values use Secret Manager bindings;
mailbox authority comes from the owner's separate Google OAuth consent. GCP IAM
permits access to the stored grant and does not grant mailbox consent itself.
Customer delivery still requires feedback authorization, canonical One permission
sync and controlled delivery/unsubscribe acceptance. See `docs/plg-google-mail.md`
and `infra/one-plg/README.md` for the separate connection and delivery gates.

### Automatic operation from Matrix

The **Automatic follow-ups** panel shows sender configuration, last observed
worker heartbeat, successful sync, completed cycle, eligibility, exceptions and
pilot limits. Only a PLG administrator can enable or pause automatic follow-ups;
same-origin session checks apply. Campaign pause, readiness, template publication,
permission, frequency, holdout, suppression and support-open rules remain
authoritative. Routine cycles need no per-message operator action. Sync continues
while sending is paused. Legacy signed workers use the same sync and pause gates.

Failed sync prevents delivery. Missing complete observation coverage stays unknown
and blocks behavioral inactivity reminders; neutral welcome and explicitly
subscribed published newsletters retain their existing rules. Registered people
are not automatically assigned marketing permission. Callback delivery states and
product completion metrics stay separate. Failed cycle totals can be unknown after
a partial send; inspect delivery history rather than treating unknown as zero.

An empty workspace refreshes its catalog from one bounded page of the existing
private registered-people contract and discards all identity rows. This loads agent
coverage without a campaign cohort, enrollment or inferred activity. Once any
account is enrolled, synchronization requires the strict cohort snapshot exporter;
it never falls back to directory metadata after a source failure.

The workspace sends email only. WhatsApp/SMS delivery, automatic Firebase
audience import, monitored reply ingestion, individual product-update broadcasts,
and content/video production remain separate integrations. The queue captures
support requests from signed product events or manual PLG updates. Record any
external promotional email or WhatsApp follow-up in the account detail form so
it counts toward the shared contact limit. Recording a contact does not send it.
External messages are not discovered automatically; the team must record them
immediately and check eligibility before sending outside the workspace.
Metrics show verified observed accounts and completed cohort windows, not the
entire registered audience. Second-week retention uses complete UTC days 8-14
after the UTC activation date; allow the end of day 14 to pass before reporting.
Existing/new and treatment/control records remain visible in the private data.

## Registered people by agent

The default **People and usage** tab reads the live registered-account directory from One
through private `POST /api/plg/audience`. It requires an authenticated PLG
admin/operator, same-origin request and `PLG_ENABLED=true`; public aggregate
analytics and machine sync credentials cannot access it. Server configuration:

```dotenv
PLG_ONE_AUDIENCE_URL=https://api.hushh.ai/api/one/plg/audience
PLG_ONE_AUDIENCE_SECRET=
```

Bind the separate `metrics-one-plg-audience-secret` in `hushh-ai-prod` to
`PLG_ONE_AUDIENCE_SECRET`, matching backend `ONE_PLG_AUDIENCE_SECRET` in
`hushh-pda`. The Terraform additions provision containers/scoped IAM only and
have not been applied. The sync worker does not receive the audience credential.
Backend migration366, production/project gates and explicit default-off
`ONE_PLG_AUDIENCE_ENABLED` are prerequisites. Expanded collection additionally
needs `ONE_PLG_ACTIVITY_ENABLED` and `ONE_PLG_ACTIVITY_ALL_REGISTERED`; normal
identity warmup must establish canonical registered-contact evidence before an
account can be admitted. Auth-only accounts can still appear without a baseline.

Select any catalog agent, evidence segment, name/email/international-phone search
and no-terminal interval. Rows show current name, email, verified full E.164
phone where present, evidence coverage, observed counts and timestamps. Saved
One identity wins as a whole row, including intentionally cleared fields.
Missing canonical rows may use current provider contact getters; transferred
phone claims are checked. Disabled, deprovisioned, unclassified and deleted
accounts are excluded. These source eligibility rules do not establish a complete
staff/test exclusion list or a customer-only production cohort. The UI states that
limitation explicitly. Missing fields remain visible, including phone-only users.
Passwords, SDK records, tokens and provider diagnostics never reach the browser.

Segments include possible incomplete, recent starts, observed failures, blocked,
cancelled, returned, verified value and unknown/partial evidence. A **possible
incomplete** observation is a correlated start with no matching terminal after
15 minutes–24 hours (default one hour). It can mean a running call or missing
telemetry; it is not confirmed abandonment. Counts combine distinct browser
reports and SDK observations, so one user action can appear more than once.
Tools and historical uncorrelated reports do not fabricate paired attempts.
Verified outcomes use the public-agent proof contracts above. The older backend's
catalog remains compatible and only claims its original Memory/Mail support.
Disabled/not-started execution coverage is unknown,
not a zero-use assertion. This view does not change aggregate DAU/retention.

The API reads 25 source accounts per page over the retained seven-day activity
window. Search/segments filter each page; later pages can contain more matches,
including after an empty page. Filtered searches automatically continue past empty
pages, stopping at a match, source exhaustion, six pages or a 20-second elapsed
budget checked between requests. A slow request can exceed that elapsed budget.
The continuation remains available when the bounded search stops early. The UI
shows how many source accounts it checked and does not turn a partial traversal
into a global zero. Changing filters hides the previous result until applied.
No global count is inferred. Cursor signatures
bind all filters and the activity anchor and expire after 15 minutes; refreshing
starts a new traversal. The live directory may change during browsing.
This bounded read avoids copying every registered person into the 750KB pilot
campaign document. It never automatically enrolls a person, changes campaign
recipient addresses, grants consent or sends a message. **Open follow-up** is
available for an existing enrollment; other rows show **Not enrolled in campaigns**.
Campaign enrollment, delivery prerequisites and existing pilot limits remain.

The earlier reference to automatic Firebase audience import concerns campaign
enrollment; live identity projection is now provided by this separate read.
Roll out backend and Matrix PRs separately, provision secret versions, verify
the private source, then separately enable the reader/collection flags. Disable
the flags to roll back. Never drop operation-key schema while a compatible
writer still references it. No new PR is merged or live collection enabled by
this implementation work. All-agent outcomes need One migration367 and its backend
writers/readers. The customer reporting policy below additionally requires the
backend policy proof before the strict Matrix consumer is promoted.
Receipt capture is prospective, bounded and best effort; older missing receipts
are never backfilled as completions. Failed/truncated sources stay explicit.
Cohort maturity is based on elapsed enrollment/activation time and does not assert
that every day was observed.

## Workspace navigation and live audit

Customer reporting requires the backend's signed `production_registered_contacts`
policy proof. People and usage excludes confirmed staff/test/reviewer identities
using exact accounts, company domains, current/provider emails and verified aliases.
A canonical production contact is required; an account present only in shared
authentication is withheld. Names alone are never evidence of a fake account.

Snapshots request `customerReporting:true`. Only current eligible proofs enter
campaign reports, queues or delivery candidates. Missing, excluded, expired
(24 hours) or old-policy proofs are held; recipient changes invalidate proof and
concurrent stale reads cannot restore it. Stored accounts and delivery records
remain intact. Storage capacity and delivery reconciliation use the full stored
ledger, even when customer reports exclude its records. These are account counts,
not proven unique people or comprehensive historical activity.

App-wide production analytics reads the private signed `/api/one/plg/customer-cohort`
projection, using the same exclusions and positive canonical backend membership.
It fully traverses bounded pages before publishing a cohort, rejects changing
policy revisions, duplicate IDs, truncated/failed pages and expired proofs, and
keeps the hash directory server-only. Membership expires after at most five
minutes in Matrix (the source traversal expires after ten). There is no stale
membership fallback. Aggregate cache keys include the cohort revision and hard
expiry is rechecked before a response. Production registration counts use Firebase
creation dates for these eligible contacts, not database shadow creation dates;
their scope is `production_contacts`, which does not claim Firebase login realms
were moved. UAT keeps its separate sources. Current disabled/deleted accounts are
excluded; unknown registration timestamps withhold registration totals.

Production GA4 queries apply eligible hashed `user_id` membership to the event
before aggregation. Anonymous events are excluded and are never attached through
a shared device. Devices associated with eligible events remain explicitly
device counts. This is a narrower reporting population than historical totals,
not proof of all unique humans. The aggregate production feed uses its bounded
raw-event SELECT with this filter because a preaggregated legacy view cannot be
filtered by account afterwards. No warehouse write grant or view mutation is
needed. Explicit collection diagnostics, store reports and referral standings
are separate source measurements and must not be presented as customer adoption.
The separate all-One authentication registry introduced on main is preserved;
its detailed view explicitly includes Main, Test and staff accounts. It is never
used as a fallback for the selected environment's customer registration cards.

Release the companion backend with its Secret Manager reporting policy, verify
the private source contract, then deploy this strict consumer. An older backend
without policy proofs fails closed. Do not promote Matrix PR #133 until the
backend proof is verified in production. No source response or raw roster enters
the public aggregate analytics API.

**Users & drop-offs** opens first. Its follow-up queue is a separate view for
enrolled campaign accounts; empty enrollment does not mean the app has no users.
**Messages** contains draft messages with a journey filter and bounded initial
list. **Automation** contains sending controls. **Results** separates app-wide
measurements from enrolled campaign results and links to tracking coverage.
Internal/unavailable agents are
hidden in the primary agent lists unless requested. Missing collection baselines
and unsupported completions remain distinct from measured zero. Legacy completion
coverage appears once for the selected agent rather than on every account row.

Read-only production inspection on 2026-10-22 IST covered all five live tabs,
recent-start filtering, queue filtering, action filtering, and a draft editor:

- The stored campaign cohort had no enrolled accounts, delivery history or
  published messages; all 56 message templates were drafts.
- The first directory page returned 25 registered accounts with no collection
  baseline. The recent-start filter returned an empty first page with a live next
  cursor. Neither result establishes app-wide zero usage.
- The connected legacy catalog had 19 authored agents and 521 action identifiers.
  Its completion contract supports Memory/Mail only. The broader outcome adapters
  require the separate One backend release and verification.
- The directory visibly included a reviewer account. Do not report its counts as
  verified external customers or certify all staff/test identities excluded.
- Automatic follow-ups reported a blocked cycle, live delivery disabled, missing
  provider authentication/callback setup, and no enrolled permission-backed cohort.

No production account, permission, template, enrollment, sending setting or
customer data was changed during this audit. Local browser tests use synthetic
fixtures and establish UI behavior, not completeness of production telemetry.

## Verify

PLG Results requests `/api/analytics/one/app?environment=production` with its
selected dates. That API reads only production; UAT is not fetched and cannot
replace a failed production source. The default API comparison contract remains
available to the separate One analytics page. PLG checks the response scope and
does not fetch the shared registration directory for its production-only read. It
withholds mismatched or mixed-environment app aggregates. Private audience,
snapshot and permission connectors continue to require the canonical production
backend origin and an explicit production response. Shared Firebase sign-in
identities do not turn UAT activity into production activity; registry totals
remain unavailable where environment membership cannot be verified.

```sh
npm run lint
npm run build
npm run test:plg
npm run test:ui -- tests/ui/plg.pw.ts
git diff --check
```

Run the existing authentication, aggregate API and production probes before a
deployment. All PLG additions must remain outside aggregate analytics responses.
