# One PLG workspace

The private workspace is available at `/plg`. It adds a shared queue, enrollment,
follow-up ownership, blocker notes, message editing, newsletter editions, journey
readiness, campaign previews and measured first-value/returning-account counts.
The module starts disabled. Campaigns start paused, journey readiness is false,
and all message templates start as drafts. No contacts are preloaded.

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
   No UI action sends email. Run `npm run plg:worker -- --send` from an approved
   scheduler every 15 minutes. Without `--send` the command exits without sending.
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
