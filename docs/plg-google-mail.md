# Google Workspace mail connection

The approved sender and Reply-To are Neelesh Meena <i-neelesh@hushh.ai>.
Mailbox connection and seven isolated operator previews can be enabled first.
Customer sending requires a separate feedback flag, expanded Google consent,
canonical One permission sync and the existing campaign readiness gates.
Deployment flags do not grant mailbox access or enroll existing accounts.

## Google resources

- Existing Matrix Google OAuth client and registered `/auth/callback`.
- Gmail API enabled in `hushh-ai-prod`.
- Secret Manager container `metrics-one-plg-google-mail`, with accessor and
  version-adder roles for `metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com`
  on that container only. No service-account key or domain-wide delegation.
- Existing Native Firestore database `one-plg-production`; the dedicated
  `one_plg_mail/control` document is separate from the customer campaign document.
- GitHub variable `ONE_PLG_GOOGLE_MAIL_CONFIGURED=true` enables the connection
  controls through the normal main deployment. `ONE_PLG_DELIVERY_CONFIGURED`
  remains false. Existing production traffic stays under the release owner's control.
- `ONE_PLG_GOOGLE_FEEDBACK_CONFIGURED=true` additionally selects the report
  reconciler and requires `ONE_PLG_SUBSCRIPTIONS_CONFIGURED=true`. Keep customer
  delivery false while completing expanded consent and feedback acceptance.
- The selected transport is `PLG_EMAIL_PROVIDER=google_workspace`. Google
  deployments remove only legacy PLG provider credential mounts; they preserve
  other runtime secrets and do not delete retained Secret Manager containers.

## Connect and verify

1. Sign into Matrix as the configured mailbox owner with PLG admin access.
2. Open PLG → Automation → Connect Google mailbox. Read the Google permissions:
   With the connection-only flag, `gmail.send` sends messages and
   `gmail.metadata` permits headers and labels, without message bodies.
   With the feedback flag, `gmail.readonly` replaces metadata-only access.
   This broader permission requires a new owner grant; an earlier metadata
   grant is insufficient. The application reads message headers and structured
   delivery-failure reports transiently, and never changes mailbox labels,
   read state or messages. The operator receipt check fetches only the
   accepted self-test message's metadata and, when needed, its exact thread for
   a separate received copy. No arbitrary-recipient email endpoint exists.
3. Grant the requested Google access. Google Workspace may require administrator
   approval or OAuth verification; GCP IAM alone does not authorize the mailbox.
   Ordinary dashboard login keeps its identity-only scopes and callback behavior.
4. The callback verifies nonce, verified owner email, both scopes and offline
   refresh access. A purpose-prefixed state and single-use server-side PKCE record
   bind the flow to the signed-in owner and expire after ten minutes.
5. The refresh token is written directly into Secret Manager. Firestore contains
   only its immutable numeric version, generation and connection timestamp.
6. Choose an existing template and send a preview to the fixed work mailbox.
   Repeat for each of the seven steps. No destination override exists. Each step
   has at most one submitted test per rolling day, including ambiguous outcomes.
7. Check receipts: `accepted` means only API acceptance; `inbox_confirmed` requires
   an INBOX copy in the accepted message's exact thread with the same opaque
   Message-ID and exact sender/recipient. Its received provider ID is stored
   separately; Gmail's SENT copy is never assumed to have an INBOX label.
   Missing or failing receipt checks retain the previous known status.

Definite pre-submit failures are `failed` and can be repaired/retried manually.
An ambiguous provider call becomes `unknown`; it is never automatically resent.
All seven previews share a separate test ledger and cannot create a contact,
activity event, completion, subscription, holdout or campaign conversion.
The transport additionally limits this application to 100 attempts per rolling
day. Workspace quota is shared with other mailbox usage and may impose lower
remaining availability; application limits are not a guarantee of Google quota.

Disconnect removes runtime authority and fences in-flight connection refreshes.
It does not revoke the shared Google OAuth client or invalidate normal sign-in.
Secret versions remain under the administrator's retention/revocation policy.

## Customer feedback and recovery

The worker polls Gmail history independently of the campaign pause. Before the
first customer message, it records a mailbox checkpoint. Each cycle processes
at most 20 referenced messages with four bounded readers and a 45-second budget.
Only opaque references, checkpoints and correlated delivery facts are saved;
message bodies are not persisted. Structured report attachments and responses
have byte limits. Partial pages, read failures, changed connections or expired
leases cannot advance the checkpoint or authorize a send.

An expired history cursor (HTTP404) starts a paginated scan of retained mail,
including Spam and Trash, from one day before the oldest retained Google
reservation. A history checkpoint taken before that scan catches later arrivals
in a subsequent incremental poll. Customer sending remains held until recovery
and catch-up finish. Other provider failures never reset the cursor. A referenced
message that is permanently deleted or cannot be read remains a visible blocked
cycle: the system cannot reconstruct deleted reports or claim complete evidence.

The reconciler accepts only these facts:

- A SENT message with the exact opaque reservation Message-ID, configured
  sender and immutable recipient hash repairs a lost submission response.
  It proves submission only and never resends an uncertain reservation.
- A structured RFC3464 hard-failure report must match the exact unpredictable
  reservation and recipient hash. A matching failure suppresses that contact.
  Temporary delays, positive reports and arbitrary text do not become bounces.
- Replays are idempotent. Erased contacts and deliveries are never recreated,
  and terminal complaint/bounce states are not reversed by later SENT evidence.

Google mailbox reports are not signed provider webhooks. Their coverage depends
on reports retained in the connected mailbox. External delivery, opens, replies,
spam complaints and verified product outcomes are **not inferred** from acceptance
or the absence of a failure report. Product outcomes retain their own backend
proofs. No universal delivery or complaint coverage is claimed.

Before each customer send, credentials are prepared, then One verifies the
current recipient and permission revision/generation, followed by a local
eligibility recheck. The transport checks the same saved connection generation
and a complete feedback checkpoint no older than 20 minutes. Missing canonical
permission, feedback authorization, a backlog or an outage holds sending.
Preference links keep their signed, generation-bound unsubscribe/revocation path.

Only after owner previews, feedback/cursor recovery, canonical enrollment,
production-only source checks and campaign content/readiness pass may the normal
deployment set `ONE_PLG_DELIVERY_CONFIGURED=true`. Campaign pause, per-journey
readiness, template publishing, holdouts, frequency caps and automation switches
still apply. The current campaign store is a **100-contact pilot**; increasing
that capacity requires its own storage change. Native app binaries require their
own governed release to ship newly bundled preference controls.

Verification: `npm run lint`, `npm test`, `npm run build`, then hosted responsive
UI checks and the existing zero-traffic production candidate probes. Use
`tests/plg-google-mail.test.ts` for owner/origin, OAuth replay, UTF-8 MIME,
ambiguous-send, receipt-correlation and analytics-isolation regressions.
The same suite covers canonical permission-to-provider order, correlated
suppression, partial page fencing and expired-history recovery. Synthetic
mailboxes and provider mocks are local only; production acceptance uses the
explicitly authorized fixed work mailbox without customer analytics changes.

Google references: [sending](https://developers.google.com/workspace/gmail/api/guides/sending),
[OAuth offline authorization](https://developers.google.com/identity/protocols/oauth2/web-server),
[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
[history and full synchronization](https://developers.google.com/workspace/gmail/api/guides/sync),
[message listing and its metadata-scope restriction](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).
