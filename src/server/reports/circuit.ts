import { ReportError } from './contracts';
import { reportPath as path, type ReportStore } from './store';

export type SourceCircuitPolicy = { approved: boolean; failureThreshold: number; baseBackoffMs: number;
  maxBackoffMs: number; probeLeaseMs: number };
type CircuitState = { phase: 'closed' | 'open' | 'probe' | 'blocked'; epoch: number; failures: number;
  nextAllowedAt: number; probeOwner: string | null; probeUntil: number };
export type CircuitTicket = { source: string; epoch: number; owner: string; probe: boolean };
export class SourceCircuitClosed extends ReportError {
  constructor(public retryAt: number, public needsAttention: boolean) { super('unavailable'); }
}
const empty = (): CircuitState => ({ phase: 'closed', epoch: 0, failures: 0, nextAllowedAt: 0, probeOwner: null, probeUntil: 0 });
function policy(value: SourceCircuitPolicy | null) {
  if (!value || Object.keys(value).sort().join() !== 'approved,baseBackoffMs,failureThreshold,maxBackoffMs,probeLeaseMs'
    || value.approved !== true || ![value.failureThreshold, value.baseBackoffMs, value.maxBackoffMs, value.probeLeaseMs]
      .every(v => Number.isSafeInteger(v) && v > 0) || value.baseBackoffMs > value.maxBackoffMs) throw new ReportError('unavailable');
  return value;
}
function stateValue(value: CircuitState | null) {
  if (!value) return empty();
  if (Object.keys(value).sort().join() !== 'epoch,failures,nextAllowedAt,phase,probeOwner,probeUntil'
    || !['closed', 'open', 'probe', 'blocked'].includes(value.phase)
    || ![value.epoch, value.failures, value.nextAllowedAt, value.probeUntil].every(v => Number.isSafeInteger(v) && v >= 0)
    || (value.phase === 'probe' ? !/^[a-f0-9]{64}$/.test(value.probeOwner ?? '') || !value.probeUntil
      : value.probeOwner !== null || value.probeUntil !== 0)) throw new ReportError('unavailable');
  return value;
}
/** Shared source health; no source request or paid reservation is retried here. */
export class MetricsSourceCircuit {
  constructor(private store: ReportStore, private now: () => number = Date.now, private random: () => number = Math.random) {}
  async acquire(source: string, owner: string) {
    if (![source, owner].every(v => /^[a-f0-9]{64}$/.test(v))) throw new ReportError('invalid');
    const now = this.now();
    const result = await this.store.transaction(async tx => {
      const p = policy(await tx.get<SourceCircuitPolicy>(path('sourcePolicies', source)));
      const state = stateValue(await tx.get<CircuitState>(path('sourceCircuits', source)));
      if (state.phase === 'blocked') return { retryAt: 0, needsAttention: true };
      if (state.phase === 'closed') return { ticket: { source, epoch: state.epoch, owner, probe: false } };
      if (state.phase === 'probe') {
        if (state.probeUntil > now) return { retryAt: state.probeUntil, needsAttention: false };
        const retryAt = now + p.baseBackoffMs;
        tx.set(path('sourceCircuits', source), { ...state, phase: 'open', epoch: state.epoch + 1,
          nextAllowedAt: retryAt, probeOwner: null, probeUntil: 0 });
        return { retryAt, needsAttention: false };
      }
      if (state.nextAllowedAt > now) return { retryAt: state.nextAllowedAt, needsAttention: false };
      const epoch = state.epoch + 1;
      tx.set(path('sourceCircuits', source), { ...state, phase: 'probe', epoch, probeOwner: owner, probeUntil: now + p.probeLeaseMs });
      return { ticket: { source, epoch, owner, probe: true } };
    });
    if (result.ticket) return result.ticket;
    throw new SourceCircuitClosed(result.retryAt!, result.needsAttention!);
  }
  async complete(ticket: CircuitTicket, outcome: 'healthy' | 'transient' | 'configuration', retryAfterMs = 0) {
    const now = this.now();
    // Sample once outside a transaction callback that may be retried.
    const sample = this.random(), jitter = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0;
    await this.store.transaction(async tx => {
      const p = policy(await tx.get<SourceCircuitPolicy>(path('sourcePolicies', ticket.source)));
      const state = stateValue(await tx.get<CircuitState>(path('sourceCircuits', ticket.source)));
      if (state.epoch !== ticket.epoch || (ticket.probe
        ? state.phase !== 'probe' || state.probeOwner !== ticket.owner || state.probeUntil <= now : state.phase !== 'closed')) return;
      if (outcome === 'healthy') { tx.set(path('sourceCircuits', ticket.source), { ...empty(), epoch: state.epoch }); return; }
      const failures = state.failures + 1;
      const wait = Math.min(p.maxBackoffMs, p.baseBackoffMs * 2 ** Math.min(30, Math.max(0, failures - p.failureThreshold)));
      const delay = Math.max(Math.floor(wait * (0.5 + jitter / 2)),
        Number.isSafeInteger(retryAfterMs) ? Math.max(0, retryAfterMs) : 0);
      const phase = outcome === 'configuration' ? 'blocked' : ticket.probe || failures >= p.failureThreshold || retryAfterMs > 0 ? 'open' : 'closed';
      tx.set(path('sourceCircuits', ticket.source), { phase, epoch: state.epoch + (phase !== 'closed' ? 1 : 0), failures,
        nextAllowedAt: phase === 'open' ? now + delay : 0, probeOwner: null, probeUntil: 0 });
    });
  }
}
