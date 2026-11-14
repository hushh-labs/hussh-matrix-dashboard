# Recovery and retained-link review

Follow-up to [Kushal's post-merge review of PR186](https://github.com/hushh-labs/hussh-matrix-dashboard/pull/186#issuecomment-6876372361).
The publication/collector architecture is retained. These changes do not activate
collection, change release tooling, modify source budgets or release the warehouse hold.

## Interrupted collection and changed authority

An expired worker lease can now settle a validated completed journal for the frozen
job after its control changes. One transaction fences the old worker, marks the job
invalidated, clears its active head and releases both capacity counters exactly once.
It cannot publish the obsolete aggregate, invoke a source factory or submit another
provider request. The original source and budget receipts remain retained.

Uncertain or malformed evidence keeps capacity and records an explicit attention
state. If the original in-flight request later records a valid outcome, recovery
can settle it even after the retry/attention limit. Concurrent recovery is fenced.
Same-control recovery still publishes the original journal once.

## Daily allowance

Normal website read-quota depletion is a timed admission limit until the next UTC
budget day, rather than a permanently broken source. It does not increment source
health failures, refund consumed allowances or authorize an extra request. The
new day still has its own transactionally enforced retained ceiling. Missing or
invalid budget configuration remains an attention-worthy configuration failure.

## Existing preference links

Only GET/HEAD requests on the retained signed unsubscribe/preferences paths may
redirect to the exact existing One destinations. Unsubscribe must retain the same
token; account preferences must retain the exact approved fragment. Extra query
parameters, other hosts/paths/tokens and POST redirects remain denied. The proxy
preserves the retained handler's stricter `no-referrer` policy and private caching.
The actual PLG Express redirect handler is tested through the proxy.

## Verification and release boundary

The unchanged-source negative control reproduces all three reported defects while
preserving the successful comparison cases. Regression tests cover concurrency,
late outcomes, malformed receipts, cap reset, redelivery and redirect denial.
The existing hosted native Firestore probe is extended to exercise recovery and
budget reset across native transactions without contacting any provider. Existing
warehouse reservations are checked by its containing qualification lane.

Local and hosted results belong to the exact follow-up commit, recorded in its PR
and issue184; prior PR186 evidence is not substituted. Live source reconciliation,
operating-policy acceptance, IAM, session/routing, serving and rollback remain
separate prerequisites. No live incident or reviewer approval is inferred.
