import { digest, ReportError, reportKey, validateAccess, validateAggregate, validateControl, validatePolicy,
  validateRequest, type AggregateResult, type PublishedReport, type ReportAccess, type ReportControl,
  type ReportJob, type ReportingPolicy, type ReportRequest } from './contracts';
import { reportPath as path, type ReportStore, type ReportTransaction } from './store';
import type { ReportBodyCache } from './body-cache';

type Head = { sequence: number; activeJob: string | null; publication: string | null };
type Capacity = { active: number };
type Context = { policy: ReportingPolicy; control: ReportControl; request: ReportRequest; key: string };

/** No source SDK, provider callback or enqueue callback exists in this reader. */
export class MetricsReports {
  constructor(private store: ReportStore, private now: () => number = Date.now, private cache?: ReportBodyCache) {}

  private async context(tx: ReportTransaction, input: unknown, access: ReportAccess): Promise<Context> {
    validateAccess(access);
    const policy = validatePolicy(await tx.get<ReportingPolicy>(path('policy', 'current')));
    const request = validateRequest(input, policy.maxPeriodDays);
    const control = validateControl(await tx.get<ReportControl>(path('controls', request.reportId)), request, access);
    return { policy, request, control, key: reportKey(request, control) };
  }

  private async quota(tx: ReportTransaction, access: ReportAccess, policy: ReportingPolicy,
    kind: 'read' | 'status' | 'compute', now: number) {
    const key = digest([access.subjectHash, kind, Math.floor(now / policy.quotaWindowMs)]);
    const ref = path('quotas', key);
    const previous = await tx.get<{ count: number }>(ref);
    const count = previous?.count ?? 0;
    if (!Number.isSafeInteger(count) || count < 0 || count >= policy[`${kind}Requests`]) throw new ReportError('quota');
    // Return intent; all transaction reads must precede writes.
    return () => tx.set(ref, { count: count + 1, windowEndsAt: (Math.floor(now / policy.quotaWindowMs) + 1) * policy.quotaWindowMs });
  }

  async read(input: unknown, access: ReportAccess) {
    const now = this.now();
    return this.store.transaction(async tx => {
      const c = await this.context(tx, input, access);
      const head = await tx.get<Head>(path('heads', c.key));
      const cacheKey = head?.publication ? `${c.key}:${head.publication}` : null;
      const report = head?.publication ? this.cache?.get<PublishedReport>(cacheKey!)
        ?? await tx.get<PublishedReport>(path('snapshots', head.publication)) : null;
      const charge = await this.quota(tx, access, c.policy, 'read', now);
      charge();
      if (!report) return { state: 'unavailable' as const, report: null };
      if (Object.keys(report).sort().join() !== 'computedAt,control,id,key,publishedAt,request,result'
        || report.key !== c.key || report.id !== head!.publication || digest(report.control) !== digest(c.control)
        || digest(report.request) !== digest(c.request) || !Number.isSafeInteger(report.computedAt)
        || !Number.isSafeInteger(report.publishedAt) || report.publishedAt > now || report.computedAt > report.publishedAt) throw new ReportError('unavailable');
      validateAggregate(report.result, { request: c.request, control: c.control, acceptedAt: 0 } as ReportJob, now, c.policy.maxSnapshotBytes);
      const watermark = report.result.sourceWatermark;
      const age = watermark === null ? Infinity : now - watermark;
      if (age > c.control.staleMs) return { state: 'unavailable' as const, report: null };
      this.cache?.put(cacheKey!, report);
      return { state: age > c.control.freshnessMs ? 'stale' as const : 'completed' as const, report };
    });
  }

  async request(input: unknown, access: ReportAccess) {
    const now = this.now();
    return this.store.transaction(async tx => {
      const c = await this.context(tx, input, access);
      const head = await tx.get<Head>(path('heads', c.key)) ?? { sequence: 0, activeJob: null, publication: null };
      const publication = head.publication ? await tx.get<PublishedReport>(path('snapshots', head.publication)) : null;
      const active = head.activeJob ? await tx.get<ReportJob>(path('jobs', head.activeJob)) : null;
      const slots = await tx.get<Capacity>(path('capacity', 'custom')) ?? { active: 0 };
      const charge = await this.quota(tx, access, c.policy, 'compute', now);
      if (publication && publication.key === c.key && publication.result.sourceWatermark !== null
        && now - publication.result.sourceWatermark <= c.control.freshnessMs) {
        charge(); return { state: 'completed' as const, reportId: publication.id, jobId: null };
      }
      if (active && ['accepted', 'running', 'delayed'].includes(active.status)) {
        charge(); return { state: active.status, reportId: null, jobId: active.id };
      }
      if (!c.policy.computeEnabled) throw new ReportError('unavailable');
      if (!Number.isSafeInteger(slots.active) || slots.active < 0 || slots.active >= c.policy.customCapacity) throw new ReportError('capacity');
      if (!Number.isSafeInteger(head.sequence) || head.sequence < 0) throw new ReportError('unavailable');
      const sequence = head.sequence + 1, id = digest([c.key, sequence]);
      const job: ReportJob = { id, key: c.key, request: c.request, control: c.control, status: 'accepted',
        acceptedAt: now, startedAt: null, completedAt: null,
        expiresAt: now + c.policy.jobLifetimeMs, fence: 0, leaseUntil: 0,
        workerHash: null, providerJobId: `metrics_report_${id}`, dispatchIntent: true, sourceStarted: false };
      charge();
      tx.create(path('jobs', id), job);
      tx.set(path('heads', c.key), { ...head, sequence, activeJob: id });
      tx.set(path('capacity', 'custom'), { active: slots.active + 1 });
      return { state: 'accepted' as const, reportId: null, jobId: id };
    });
  }

  async status(jobId: string, access: ReportAccess) {
    validateAccess(access);
    if (!/^[a-f0-9]{64}$/.test(jobId)) throw new ReportError('invalid');
    const now = this.now();
    return this.store.transaction(async tx => {
      const job = await tx.get<ReportJob>(path('jobs', jobId));
      if (!job) throw new ReportError('unavailable');
      await this.context(tx, job.request, access);
      const policy = validatePolicy(await tx.get<ReportingPolicy>(path('policy', 'current')));
      const charge = await this.quota(tx, access, policy, 'status', now);
      if (job.control.scopeDigest !== access.scopeDigest) throw new ReportError('unauthorized');
      const control = await tx.get<ReportControl>(path('controls', job.request.reportId));
      const dispatch = await tx.get<{ state: string }>(path('dispatches', jobId));
      charge();
      const needsAttention = job.status === 'accepted' && dispatch?.state === 'blocked';
      const state = digest(control) !== digest(job.control) ? 'invalidated' as const
        : job.status === 'accepted' && ['uncertain', 'blocked'].includes(dispatch?.state ?? '') ? 'delayed' as const : job.status;
      return { state, jobId, acceptedAt: job.acceptedAt, needsAttention,
        queueWaitMs: Math.max(0, (job.startedAt ?? now) - job.acceptedAt),
        executionMs: job.startedAt === null ? 0 : Math.max(0, (job.completedAt ?? now) - job.startedAt),
        retryAfterMs: ['completed', 'failed', 'invalidated'].includes(state) || needsAttention ? 0 : policy.leaseMs };
    });
  }
}

/** Worker methods are not exported through the reader's HTTP routes. */
export class MetricsReportWorker {
  constructor(private store: ReportStore, private now: () => number = Date.now) {}
  async claim(jobId: string, workerHash: string) {
    if (!/^[a-f0-9]{64}$/.test(jobId) || !/^[a-f0-9]{64}$/.test(workerHash)) throw new ReportError('invalid');
    const now = this.now();
    return this.store.transaction(async tx => {
      const policy = validatePolicy(await tx.get<ReportingPolicy>(path('policy', 'current')));
      const job = await tx.get<ReportJob>(path('jobs', jobId));
      if (!job) throw new ReportError('unavailable');
      const control = await tx.get<ReportControl>(path('controls', job.request.reportId));
      if (!policy.computeEnabled) throw new ReportError('unavailable');
      if (['completed', 'failed', 'invalidated'].includes(job.status) || job.leaseUntil > now) return null;
      // Expired unstarted work is never dispatched. Uncertain work needs recovery,
      // even after expiry; lease expiry cannot release its capacity/reservation.
      if (!job.sourceStarted && (job.expiresAt <= now || digest(control) !== digest(job.control))) {
        const head = await tx.get<Head>(path('heads', job.key));
        const slots = await tx.get<Capacity>(path('capacity', 'custom'));
        if (head?.activeJob !== job.id || !slots || !Number.isSafeInteger(slots.active) || slots.active < 1) throw new ReportError('unavailable');
        tx.set(path('heads', job.key), { ...head, activeJob: null });
        tx.set(path('jobs', job.id), { ...job, status: 'invalidated' });
        tx.set(path('capacity', 'custom'), { active: slots.active - 1 });
        return null;
      }
      if (digest(control) !== digest(job.control)) throw new ReportError('unavailable');
      const claimed: ReportJob = { ...job, status: 'running', fence: job.fence + 1,
        leaseUntil: now + policy.leaseMs, workerHash, sourceStarted: true, startedAt: job.startedAt ?? now };
      tx.set(path('jobs', jobId), claimed);
      return { job: claimed, recoverOnly: job.sourceStarted };
    });
  }

  async publish(claim: ReportJob, result: AggregateResult) {
    const now = this.now();
    return this.store.transaction(async tx => {
      const policy = validatePolicy(await tx.get<ReportingPolicy>(path('policy', 'current')));
      const current = await tx.get<ReportJob>(path('jobs', claim.id));
      const control = await tx.get<ReportControl>(path('controls', claim.request.reportId));
      const head = await tx.get<Head>(path('heads', claim.key));
      const slots = await tx.get<Capacity>(path('capacity', 'custom'));
      if (current?.status === 'completed' && head?.publication === claim.id) return claim.id;
      if (!policy.computeEnabled || !current || current.status !== 'running' || current.fence !== claim.fence
        || current.workerHash !== claim.workerHash || current.leaseUntil <= now
        || digest(current.control) !== digest(control) || digest(current.request) !== digest(claim.request)
        || head?.activeJob !== claim.id || !slots || !Number.isSafeInteger(slots.active) || slots.active < 1) throw new ReportError('stale_worker');
      validateAggregate(result, current, now, policy.maxSnapshotBytes);
      const publication: PublishedReport = { id: claim.id, key: claim.key, request: current.request,
        control: current.control, result, computedAt: now, publishedAt: now };
      tx.create(path('snapshots', claim.id), publication);
      tx.set(path('heads', claim.key), { ...head, activeJob: null, publication: claim.id });
      tx.set(path('jobs', claim.id), { ...current, status: 'completed', leaseUntil: 0, completedAt: now });
      tx.set(path('capacity', 'custom'), { active: slots.active - 1 });
      return claim.id;
    });
  }

  async uncertain(claim: ReportJob) {
    return this.store.transaction(async tx => {
      const job = await tx.get<ReportJob>(path('jobs', claim.id));
      if (!job || job.status !== 'running' || job.fence !== claim.fence || job.workerHash !== claim.workerHash) throw new ReportError('stale_worker');
      tx.set(path('jobs', claim.id), { ...job, status: 'delayed', leaseUntil: 0 });
      // Do not free capacity, reset providerJobId or refund paid-work reservations.
    });
  }
}
