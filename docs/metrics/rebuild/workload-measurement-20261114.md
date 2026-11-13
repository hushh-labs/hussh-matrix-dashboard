# Offline reporting workload measurements

14 November 2026 IST. This is implementation measurement for #186, not accepted
operating policy or native performance/cost evidence. The scenario assumes 25
staff identities; it is **not observed team traffic**. No source, cloud API,
warehouse, task, schedule or email is invoked.

Run from the repository root with its existing locked dependencies:

```sh
node --import tsx scripts/measure-metrics-reporting.ts
```

The harness executes the real publication reader, worker, journaled One adapter
and collection lifecycle against the existing serialized in-memory test store.
Two reader instances have independent bounded caches inside one Node process.
An injected synthetic response supplies aggregates. Global `fetch` throws on
accidental HTTP. All scenarios contain assertions and a failure exits nonzero.
The fixture's policy is printed for reproducibility; it is never an activation
default. No credentials or production environment configuration are required.

## Observed operation counts

Measured reporting implementation: `9510cba79cb2b7c0eaa6d56b831d1e513800c32d`
plus this harness, with the unchanged collection fixture. Local receipt:
`metrics-reporting-offline-workload-expanded-20261114.json`.

| Modeled scenario | Observed logical operation attempts | Source behavior |
| --- | --- | --- |
| Absent publication read | 4 document gets, 1 quota set | No source call or job |
| 25 simultaneous same-period admissions across two readers | 174 gets, 1 job create, 28 sets | One shared job; no source execution during admission |
| Source completes, process interrupts before publication | 8 gets, 1 receipt create, 2 sets | One synthetic source call, completed aggregate journal retained |
| Next worker recovers that job | 16 gets, 1 snapshot create, 5 sets | No repeated source call |
| Two cold-cache reads of the publication | 10 gets, including 2 snapshot gets; 2 quota sets | Same publication |
| 250 warm reads across 25 identities/two caches | 1,000 gets, 250 quota sets, zero snapshot gets | Zero additional source calls |
| 25 explicit refresh admissions | 175 gets, including 25 snapshot gets; 25 quota sets | Reuse publication; no new job/source call |
| 25 completed-job status reads | 175 gets, 25 quota sets | Terminal response stops polling |
| 100 cached reads and one over-quota request | 404 gets, 100 quota sets | Last request rejects; cache does not bypass quota |
| Expired-publication read | 4 gets, 1 quota set | Unavailable; no automatic collection |
| Uncertain source, four deliveries | 50 gets, 2 creates, 12 sets | One source submission; no replay; capacity retained and attention required |

The aggregate publication is 1,116 serialized bytes; each reader cache retains
one entry of that size. Eleven stages made 472 logical transactions, 2,020 gets,
5 creates, 451 sets and zero deletes. Two synthetic source calls are distinct:
one completed/recovered report and one uncertain report. Actual network requests,
BigQuery statements and cloud mutations are zero.

The receipt additionally records stage wall time, process CPU time, heap delta,
RSS, platform and Node version. For this one Windows run the 250-read concurrent
stage took about 145ms, and recovery after the retained result took about 2.4ms.
These are local serialized-store timings including queue wait, not HTTP/browser
latency, native Firestore contention, source execution time, p95 or a service
objective. Heap/RSS include fixture/runtime allocation and garbage collection.
No benchmark threshold is set from this single sample.

## Decisions supported and remaining measurements

- Published reads and refresh reuse avoid repeated provider computation. An
  authority/quota check still performs storage operations. Cached reads are
  therefore **not free**, even when body retrieval is a cache hit.
- In this model, a warm read attempts four gets and one set. Multiply that
  logical mix by a separately measured traffic profile before comparing native
  request costs. Native retries, billing rules, listeners, index/storage costs
  and concurrency are not measured here; these are not billed-operation totals.
- The small synthetic report does not establish the working set or payload
  size of broader reports. Measure their actual aggregate shapes before
  selecting memory, response-size and retention limits.
- Successful and uncertain recovery have different capacity consequences.
  Uncertain source work remains reserved and is not retried merely to improve
  availability. Repeated reads never release that reservation.
- Still measure actual staff requests, production-build render/HTTP latency,
  native Firestore and task behavior, source latency/quota/lag, Cloud Run
  scaling/cold start, logging, images, retention and independently retained PLG
  workloads. Then review source cadence, quotas, concurrency, deadlines,
  capacities, retention, expected costs and alerts with Kushal.

No numerical production targets, recurring savings, zero-hosting-cost claim or
collection approval follows from these modeled measurements. Existing holds,
reservations and paused refresh schedules remain in force.
