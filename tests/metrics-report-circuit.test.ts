import { describe, expect, it } from 'vitest';
import { digest } from '../src/server/reports/contracts';
import { MetricsSourceCircuit } from '../src/server/reports/circuit';
import { collectionFixture } from './helpers/metrics-collection-fixture';

describe('shared Metrics source circuit', () => {
  it('requires approved source policy and rejects corrupt circuit state', async () => {
    const f = collectionFixture(), circuit = new MetricsSourceCircuit(f.store, f.clock);
    await expect(circuit.acquire(f.binding.sourceGeneration, digest('worker'))).rejects.toMatchObject({ code: 'unavailable' });
    await f.initialize(); await f.put('sourceCircuits', f.binding.sourceGeneration, { phase: 'closed' });
    await expect(circuit.acquire(f.binding.sourceGeneration, digest('worker'))).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('opens after the reviewed threshold, elects only one probe and ignores old completions', async () => {
    const f = collectionFixture(); await f.initialize();
    const a = new MetricsSourceCircuit(f.store, f.clock, () => 1), b = new MetricsSourceCircuit(f.store, f.clock, () => 1);
    const first = await a.acquire(f.binding.sourceGeneration, digest('first'));
    const second = await a.acquire(f.binding.sourceGeneration, digest('second'));
    const late = await b.acquire(f.binding.sourceGeneration, digest('late'));
    await a.complete(first, 'transient'); await a.complete(second, 'transient');
    await b.complete(late, 'healthy'); // cannot close the newer open epoch
    await expect(b.acquire(f.binding.sourceGeneration, digest('early'))).rejects.toMatchObject({ retryAt: f.clock() + 1000 });
    f.advance(1000);
    const probes = await Promise.allSettled([a.acquire(f.binding.sourceGeneration, digest('probe-a')), b.acquire(f.binding.sourceGeneration, digest('probe-b'))]);
    expect(probes.filter(p => p.status === 'fulfilled')).toHaveLength(1);
    const probe = probes.find(p => p.status === 'fulfilled')!;
    if (probe.status !== 'fulfilled') throw new Error('Missing probe');
    await a.complete(probe.value, 'healthy');
    expect((await b.acquire(f.binding.sourceGeneration, digest('after'))).probe).toBe(false);
  });
  it('honors Retry-After even below threshold and beyond ordinary backoff', async () => {
    const f = collectionFixture(); await f.initialize(); const c = new MetricsSourceCircuit(f.store, f.clock, () => 0);
    const ticket = await c.acquire(f.binding.sourceGeneration, digest('worker'));
    await c.complete(ticket, 'transient', 90_000);
    await expect(c.acquire(f.binding.sourceGeneration, digest('next'))).rejects.toMatchObject({ retryAt: f.clock() + 90_000 });
  });
  it('persists a new cooldown after an abandoned probe and fences its late success', async () => {
    const f = collectionFixture(); await f.initialize(); const c = new MetricsSourceCircuit(f.store, f.clock, () => 1);
    await c.complete(await c.acquire(f.binding.sourceGeneration, digest('open')), 'transient', 1000);
    f.advance(1000); const old = await c.acquire(f.binding.sourceGeneration, digest('old-probe'));
    f.advance(1001);
    await expect(c.acquire(f.binding.sourceGeneration, digest('replacement'))).rejects.toMatchObject({ retryAt: f.clock() + 1000 });
    await c.complete(old, 'healthy');
    await expect(c.acquire(f.binding.sourceGeneration, digest('still-wait'))).rejects.toMatchObject({ retryAt: f.clock() + 1000 });
  });
  it('blocks configuration failures until explicit authority repair, independent of elapsed time', async () => {
    const f = collectionFixture(); await f.initialize(); const c = new MetricsSourceCircuit(f.store, f.clock);
    await c.complete(await c.acquire(f.binding.sourceGeneration, digest('bad-key')), 'configuration'); f.advance(1_000_000);
    await expect(c.acquire(f.binding.sourceGeneration, digest('later'))).rejects.toMatchObject({ needsAttention: true, retryAt: 0 });
  });
});
