# One KPI guide for the team

Start with the selected dates and Production/UAT choice. Every number belongs
to that period and analytics source. Recent numbers can change as data arrives.

## Read the main numbers

| KPI | Simple meaning |
| --- | --- |
| Signed-in accounts | Different account IDs that used this feature. Activity without a signed-in account is excluded. |
| Active devices / browsers | Different app or browser IDs that used this feature. One person can have several IDs. |
| Recorded actions | Feature-use steps logged by the app. Repeated actions count again. |
| Times recorded | How often the row's named activity was logged. This can count views, requests or results. |
| Data status | Whether counts are available, no activity was found, or tracking is missing. |

**Example:** one device opening a shared location five times means
**1 device and 5 recorded views**. Five records do not mean five people.

## Understand each feature row

Read the activity name, then the short explanation. The default view shows
devices/browsers and times recorded. Open **View details** when you need:

- **Results at this step:** successful, canceled/blocked, failed, or result not reported.
- **Average per device:** times recorded divided by device/browser IDs for the whole period.
- **Technical details:** the source events and exact counting rule.

A successful request means that request step succeeded. A successful queued
job means it was accepted. Neither alone proves the whole task finished.

| Agent | What the team should read as activity |
| --- | --- |
| Location | Views, sharing confirmations, requests, Circle activity and safety triggers are separate steps. |
| Finance | Portfolio/recommendation views, analysis starts, import parsing and import saving. |
| Consent | Screen views, submitted choices and their results. Separate preference, unlock, grant and withdrawal measurements are missing. |
| Gmail | Connection starts/results, sync requests, queue results and processing results. |
| Advisor | Verification checks, workspace visits and requests. |
| Marketplace | Profile-view tracking exists; browsing and subscription measurements are missing. |
| Memory | Preparing, saving, editing, deleting and exporting memories. |
| Wallet | Card additions/removals; these do not describe current card inventory. |
| Calendar | Connections, disconnections and assistance opens. |
| KYC | No workflow measurement emitters yet; definitions alone do not establish tracking. |
| CRM | Record creation, updates and deletion. |
| Sign-up & onboarding | Authentication, Google-provider steps, verification and emitted account-setup steps. Profile creation has no separate event. |

## Why the old 6.7k row was confusing

The finalized Sep 8–Oct 7, 2026 audit found **6,653 location-view records**
and **25 sharing-confirmation records**. The old row combined them into
**6,678 (6.7k)** across **12 overlapping device/browser IDs**.

The dashboard now gives views and sharing confirmations their own rows.
These are recorded activities; unique sharing sessions are not measured.
The dated audit is an example, not a fixed live count.

## Three rules for team discussions

1. **Name the unit and dates:** “6,653 location-view records from 11 device/browser IDs during Sep 8–Oct 7.”
2. **Do not add overlapping rows:** one check-in can also create a sharing confirmation; one device can appear in several rows and on several days.
3. **Read 0 and — differently:** 0 means no matching activity was recorded; — means unavailable or not tracked yet.

The counting path is **app activity → analytics record → matching feature → dashboard count**.
Gmail sync results do not fill Mail sign-in, inbox-view or categorization rows.
Calendar rows measure connection/disconnection results and assistance opens;
they do not measure event syncing, creation, changes or deletion.

The October 8 source audit found **17 missing feature measurements**. They
show **Not tracked yet / —**, rather than imply nobody used the feature.
Google sign-in was a mapping issue: current authentication events carry
`action=google`. Its starts and results now appear together in the Google row
and also retain their general authentication rows. Do not add those rows.

For the complete coverage and repeat-check procedure, see
[agent tracking coverage](./one-agent-tracking-coverage.md).
For the exact formulas and data limitations, see the
[measurement contract](./one-subagent-measurement-contract.md).
