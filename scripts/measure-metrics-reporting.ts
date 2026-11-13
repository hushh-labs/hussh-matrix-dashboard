import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { digest, type PublishedReport } from '../src/server/reports/contracts';
import { ReportBodyCache } from '../src/server/reports/body-cache';
import { MetricsReports, MetricsReportWorker } from '../src/server/reports/service';
import { MetricsCollection } from '../src/server/reports/lifecycle';
import { OneAdoptionSource } from '../src/server/reports/sources';
import type { ReportStore, ReportTransaction } from '../src/server/reports/store';
import { collectionFixture } from '../tests/helpers/metrics-collection-fixture';

// Offline model, not a load generator against production. This imports no SDK,
// obtains no credentials and supplies only a local synthetic aggregate response.
// Hard failure on accidental HTTP is additional protection, not an egress policy.
const previousFetch = globalThis.fetch;
let attemptedNetworkCalls = 0;
globalThis.fetch = async () => { attemptedNetworkCalls++; throw new Error('Offline measurement forbids network requests.'); };
const counts = { transactions: 0, gets: 0, snapshotGets: 0, creates: 0, sets: 0, deletes: 0 };
const stages: Record<string, unknown>[] = [];
let syntheticSourceCalls = 0;
try {
  const fixture = collectionFixture(); await fixture.initialize();
  const store: ReportStore = { transaction: fn => {
    counts.transactions++;
    return fixture.store.transaction(tx => fn({
      get: async <T>(path: string) => { counts.gets++; if (path.includes('/snapshots/')) counts.snapshotGets++; return tx.get<T>(path); },
      create: (path, value) => { counts.creates++; tx.create(path, value); },
      set: (path, value) => { counts.sets++; tx.set(path, value); },
      delete: path => { counts.deletes++; tx.delete(path); },
    } satisfies ReportTransaction));
  } };
  const caches = [new ReportBodyCache(2, 40_000), new ReportBodyCache(2, 40_000)];
  const readers = caches.map(cache => new MetricsReports(store, fixture.clock, cache));
  const accesses = Array.from({ length: 25 }, (_, index) => ({ ...fixture.access, subjectHash: digest(['modeled-staff', index]) }));
  const source = () => new OneAdoptionSource(store, { sourceGeneration: fixture.binding.sourceGeneration,
    timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat', async (_url, request) => {
      syntheticSourceCalls++;
      const job = [...fixture.store.data.values()].find((v: any) => v?.status === 'running') as Parameters<typeof fixture.result>[0];
      assert.ok(job); assert.deepEqual((request.body as any).period, fixture.result(job).period);
      return Response.json(fixture.result(job));
    }, fixture.clock);
  const collection = new MetricsCollection(store, async () => source(), fixture.clock);
  async function measure<T>(name: string, requests: number, run: () => Promise<T>) {
    const before = { ...counts }, beforeSources = syntheticSourceCalls;
    const cpu = process.cpuUsage(), memory = process.memoryUsage(), started = performance.now();
    const result = await run(); const elapsedMs = performance.now() - started, used = process.cpuUsage(cpu);
    stages.push({ name, requests, elapsedMs, cpuMs: (used.user + used.system) / 1000,
      heapDeltaBytes: process.memoryUsage().heapUsed - memory.heapUsed,
      rssBytesAfter: process.memoryUsage().rss,
      logicalOperations: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value - before[key as keyof typeof before]])),
      syntheticSourceCalls: syntheticSourceCalls - beforeSources });
    return result;
  }
  await measure('absent-publication-read', 1, async () => {
    assert.equal((await readers[0].read(fixture.request, accesses[0])).state, 'unavailable');
    assert.equal(syntheticSourceCalls, 0);
  });
  const intents = await measure('25-modeled-staff-same-period-burst-two-readers', 25, () => Promise.all(accesses.map((access, i) => readers[i % 2].request(fixture.request, access))));
  assert.equal(new Set(intents.map(intent => intent.jobId)).size, 1); assert.equal(syntheticSourceCalls, 0);
  const id = intents[0].jobId!;
  await measure('journal-source-once-interrupt-before-publication', 1, async () => {
    const claim = await new MetricsReportWorker(store, fixture.clock).claim(id, digest('interrupted-modeled-worker'));
    assert.ok(claim); await source().submit(claim.job); assert.equal(syntheticSourceCalls, 1);
  });
  fixture.advance(fixture.policy.leaseMs + 1);
  await measure('recover-completed-journal-without-source-replay', 1, async () => {
    assert.equal((await collection.collect(id, digest('recovery-modeled-worker'))).state, 'completed');
    assert.equal(syntheticSourceCalls, 1);
  });
  let publication: PublishedReport | null = null;
  await measure('two-instance-cache-cold-publication-reads', 2, async () => {
    for (const reader of readers) { const result = await reader.read(fixture.request, accesses[1]); assert.equal(result.state, 'completed'); publication = result.report; }
  });
  await measure('250-warm-reads-25-modeled-staff-two-caches', 250, async () => {
    const values = await Promise.all(Array.from({ length: 250 }, (_, i) => readers[i % 2].read(fixture.request, accesses[i % accesses.length])));
    assert.ok(values.every(value => value.report?.id === id));
  });
  await measure('25-explicit-refresh-admissions-reuse-publication', 25, async () => {
    const values = await Promise.all(accesses.map((access, i) => readers[i % 2].request(fixture.request, access)));
    assert.ok(values.every(value => value.state === 'completed' && value.jobId === null));
  });
  await measure('25-terminal-status-reads-stop-polling', 25, async () => {
    const values = await Promise.all(accesses.map((access, i) => readers[i % 2].status(id, access)));
    assert.ok(values.every(value => value.state === 'completed' && value.retryAfterMs === 0));
  });
  await measure('cached-read-quota-enforced', fixture.policy.readRequests + 1, async () => {
    const access = { ...fixture.access, subjectHash: digest('modeled-quota-case') };
    for (let i = 0; i < fixture.policy.readRequests; i++) await readers[0].read(fixture.request, access);
    await assert.rejects(readers[1].read(fixture.request, access), { code: 'quota' });
  });
  fixture.advance(fixture.control.staleMs + 1);
  await measure('expired-publication-read-does-not-collect', 1, async () => {
    assert.equal((await readers[0].read(fixture.request, accesses[0])).state, 'unavailable');
  });
  await measure('uncertain-source-four-deliveries-one-submission-retains-capacity', 4, async () => {
    const intent = await readers[0].request({ ...fixture.request, startDate: '2026-11-10' }, accesses[0]);
    const uncertain = new MetricsCollection(store, async () => new OneAdoptionSource(store, {
      sourceGeneration: fixture.binding.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000,
    }, 'uat', async () => { syntheticSourceCalls++; throw new Error('Synthetic lost acknowledgement'); }, fixture.clock), fixture.clock);
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = await uncertain.collect(intent.jobId!, digest(['uncertain-modeled-worker', attempt]));
      assert.equal(state.state, 'delayed'); fixture.advance(501);
      if (attempt === 3) { assert.equal(state.needsAttention, true); assert.equal(state.retryAfterMs, 0); }
    }
    assert.deepEqual(await fixture.get('capacity', 'custom'), { active: 1 });
  });
  assert.equal(syntheticSourceCalls, 2); assert.equal(attemptedNetworkCalls, 0);
  assert.equal((stages.find(stage => stage.name === '250-warm-reads-25-modeled-staff-two-caches')!.logicalOperations as typeof counts).snapshotGets, 0);
  console.log(JSON.stringify({ schemaVersion: 1, mode: 'offline-modeled-workload', sourceHead: process.env.METRICS_MEASUREMENT_SOURCE_HEAD ?? 'working-tree',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    scenario: { modeledStaff: 25, readerInstances: 2, source: 'synthetic One aggregate', store: 'serialized in-memory test store',
      fixturePolicy: fixture.policy, observedTeamTraffic: false },
    stages, totals: counts, syntheticSourceCalls, attemptedNetworkCalls, bigQueryQueries: 0,
    cacheUsage: caches.map(cache => cache.usage), publicationBytes: Buffer.byteLength(JSON.stringify(publication)),
    limits: ['Elapsed times include local serialized-store queuing; not HTTP, browser, native Firestore or provider latency.',
      'Logical operation attempts are not billed Firestore operations; native retries/contention/network are not measured.',
      'RSS includes the Node/TypeScript process and fixture store; heap deltas include allocation/GC noise.',
      'Modeled staff and synthetic policy are assumptions for comparison, not observed usage or production targets.',
      'No native compute, storage, task, build, logging or retained PLG costs are measured; no savings or spending cap is established.'],
    productionPolicyAccepted: false, liveSourceAccepted: false }, null, 2));
} finally { globalThis.fetch = previousFetch; }
