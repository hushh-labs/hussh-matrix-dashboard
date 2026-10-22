# Google Workspace mail connection

The approved sender and Reply-To are Neelesh Meena <i-neelesh@hushh.ai>.
This release adds mailbox authorization and seven isolated operator previews.
It does **not** enable customer sending: the deployment refuses a combination
of Google mailbox connection and live customer delivery until its separate
feedback-reconciliation release is verified.

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

## Connect and verify

1. Sign into Matrix as the configured mailbox owner with PLG admin access.
2. Open PLG → Automation → Connect Google mailbox. Read the Google permissions:
   `gmail.send` sends messages and `gmail.metadata` permits headers and labels,
   without message bodies. The receipt check fetches only the
   accepted self-test message's metadata and, when needed, its exact thread for
   a separate received copy. No mailbox search, message bodies, read-state changes
   or arbitrary email endpoint is used.
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

External delivery, read/open activity, replies and verified product outcomes are
not inferred from Gmail acceptance. Customer sending still requires canonical
One permission sync, suppression, content/readiness, campaign and automation
gates, and the pending Google feedback reconciler. Native app binaries need their
own governed release to ship newly bundled preference controls.

Verification: `npm run lint`, `npm test`, `npm run build`, then hosted responsive
UI checks and the existing zero-traffic production candidate probes. Use
`tests/plg-google-mail.test.ts` for owner/origin, OAuth replay, UTF-8 MIME,
ambiguous-send, receipt-correlation and analytics-isolation regressions.

Google references: [sending](https://developers.google.com/workspace/gmail/api/guides/sending),
[OAuth offline authorization](https://developers.google.com/identity/protocols/oauth2/web-server),
[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).
