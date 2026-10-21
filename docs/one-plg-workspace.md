# One PLG workspace

The private workspace is available at `/plg`. It adds a shared queue, enrollment,
follow-up ownership, blocker notes, message editing, newsletter editions, journey
readiness, campaign previews and measured first-value/returning-account counts.
The module starts disabled. Campaigns start paused, journey readiness is false,
and all message templates start as drafts. No contacts are preloaded.

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
starts paused and uses `--sync-only`. No provisioning, deployment, merge or
customer send has been performed for this change.

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
necessary Firestore access. The pilot stores one transactional state document
at `one_plg_pilot/state`; it supports at most 100 enrolled accounts and refuses
writes above 750 KB. It does not trim deduplication or delivery history. Move to
per-account/event/delivery documents before expanding beyond this bounded pilot.

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

The approved sender is Rachel Morgan, `rachel@hushh.ai`, with the same Reply-To.
Its values use Secret Manager bindings. Provider account authentication, domain
verification and controlled callback/unsubscribe testing remain launch requirements.
A business address alone does not authenticate automated sending. See
`infra/one-plg/README.md` for separate sender/delivery release gates.

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

The **Agent people** tab reads the live registered-account directory from One
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
accounts are excluded. Missing fields remain visible, including phone-only users.
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
including after an empty page. No global count is inferred. Cursor signatures
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
this implementation work. For all-agent outcomes, deploy this backward-compatible
Matrix consumer first, then One migration367 and its backend writers/readers.
Receipt capture is prospective, bounded and best effort; older missing receipts
are never backfilled as completions. Failed/truncated sources stay explicit.
Cohort maturity is based on elapsed enrollment/activation time and does not assert
that every day was observed.

## Verify

```sh
npm run lint
npm run build
npm run test:plg
npm run test:ui -- tests/ui/plg.pw.ts
git diff --check
```

Run the existing authentication, aggregate API and production probes before a
deployment. All PLG additions must remain outside aggregate analytics responses.
