import { reportPath, type ReportStore } from '../reports/store';

/** This is an admission primitive only: no route, policy or schedule is enabled. */
type Policy = { approved: true; enabled: true; revision: number; dailyGlobal: number; dailyViewer: number; concurrentGlobal: number; concurrentViewer: number };
type Counter = { used: number; limit: number };
type Active = { count: number; limit: number };
type Claim = { viewer: string; day: string; state: 'open' | 'complete'; policyRevision: number };
const unavailable = () => new Error('UAT audience admission unavailable');
const hex = (s: string) => /^[a-f0-9]{64}$/.test(s);
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0;
function policy(raw: unknown): Policy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw unavailable();
  const p = raw as Policy;
  if (Object.keys(p).sort().join() !== 'approved,concurrentGlobal,concurrentViewer,dailyGlobal,dailyViewer,enabled,revision'
      || p.approved !== true || p.enabled !== true || !positive(p.revision) || !positive(p.dailyGlobal)
      || !positive(p.dailyViewer) || !positive(p.concurrentGlobal) || !positive(p.concurrentViewer)
      || p.dailyViewer > p.dailyGlobal || p.concurrentViewer > p.concurrentGlobal
      || p.concurrentGlobal > p.dailyGlobal || p.concurrentViewer > p.dailyViewer) throw unavailable();
  return p;
}
function counter(raw: Counter | null, configured: number): Counter {
  if (raw && (Object.keys(raw).sort().join() !== 'limit,used' || !Number.isSafeInteger(raw.used) || raw.used < 0 || !positive(raw.limit))) throw unavailable();
  return { used: raw?.used ?? 0, limit: Math.min(raw?.limit ?? configured, configured) };
}
function active(raw: Active | null, configured: number): Active {
  if (raw && (Object.keys(raw).sort().join() !== 'count,limit' || !Number.isSafeInteger(raw.count) || raw.count < 0 || !positive(raw.limit))) throw unavailable();
  return { count: raw?.count ?? 0, limit: Math.min(raw?.limit ?? configured, configured) };
}
/** Caller must first verify current viewer authority and supply a keyed, non-PII digest.
 * The clock must be trusted server time, never a client value. One unique operation per upstream page. Uncertain or failed sends remain charged
 * and open until separately reconciled; this module never retries or expires them. */
export async function admitUatAudiencePage(store: ReportStore, viewer: string, operation: string, now: number): Promise<void> {
  if (!hex(viewer) || !hex(operation) || !Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) throw unavailable();
  const day = new Date(now).toISOString().slice(0, 10);
  const admitted = await store.transaction(async tx => {
    const p = policy(await tx.get(reportPath('policy', 'uat-audience-admission')));
    const claimPath = reportPath('uatAudienceClaims', operation);
    const globalDay = reportPath('uatAudienceDays', day), viewerDay = reportPath('uatAudienceViewerDays', `${day}-${viewer}`);
    const globalActive = reportPath('uatAudienceActive', 'global'), viewerActive = reportPath('uatAudienceActive', viewer);
    const [claim, gd, vd, ga, va] = await Promise.all([tx.get<Claim>(claimPath), tx.get<Counter>(globalDay), tx.get<Counter>(viewerDay), tx.get<Active>(globalActive), tx.get<Active>(viewerActive)]);
    if (claim) throw unavailable();
    const g = counter(gd, p.dailyGlobal), v = counter(vd, p.dailyViewer), a = active(ga, p.concurrentGlobal), b = active(va, p.concurrentViewer);
    if (g.used >= g.limit || v.used >= v.limit || a.count >= a.limit || b.count >= b.limit) {
      tx.set(globalDay, g); tx.set(viewerDay, v); tx.set(globalActive, a); tx.set(viewerActive, b);
      return false;
    }
    tx.set(globalDay, { ...g, used: g.used + 1 }); tx.set(viewerDay, { ...v, used: v.used + 1 });
    tx.set(globalActive, { ...a, count: a.count + 1 }); tx.set(viewerActive, { ...b, count: b.count + 1 });
    tx.create(claimPath, { viewer, day, state: 'open', policyRevision: p.revision });
    return true;
  });
  if (!admitted) throw unavailable();
}
/** Call only after a terminal, fully received provider response; not on timeout or abort. */
export async function finishUatAudiencePage(store: ReportStore, viewer: string, operation: string): Promise<void> {
  if (!hex(viewer) || !hex(operation)) throw unavailable();
  await store.transaction(async tx => {
    const claimPath = reportPath('uatAudienceClaims', operation), gp = reportPath('uatAudienceActive', 'global'), vp = reportPath('uatAudienceActive', viewer);
    const [claim, g, v] = await Promise.all([tx.get<Claim>(claimPath), tx.get<Active>(gp), tx.get<Active>(vp)]);
    if (!claim || claim.viewer !== viewer || claim.state !== 'open' || !g || !v || !positive(g.count) || !positive(v.count) || !positive(g.limit) || !positive(v.limit)) throw unavailable();
    tx.set(gp, { ...g, count: g.count - 1 }); tx.set(vp, { ...v, count: v.count - 1 });
    tx.set(claimPath, { ...claim, state: 'complete' });
  });
}

/** Integration constraints: the caller must verify and recheck viewer authority,
 * bind the UAT source and operation to the authorized scope, and use trusted
 * server time. A dispatched request can complete after cancellation. Persistent
 * active limits only tighten; increasing them requires a reviewed migration.
 * These counters limit page admissions, not upstream reads or monetary cost. */
