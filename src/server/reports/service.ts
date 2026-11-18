import { digest, ReportError, reportKey, validateAccess, validateAggregate, validateControl, validatePolicy,
  validateRequest, type AggregateResult, type PublishedReport, type ReportAccess, type ReportControl,
  type ReportJob, type ReportingPolicy, type ReportRequest } from './contracts';
import { reportPath as path, type ReportStore, type ReportTransaction } from './store';
import type { ReportBodyCache } from './body-cache';
import { periodicPlan } from './periodic-policy';
import { uatTwoSourceChildIds, validateUatTwoSourcePolicies } from './uat-two-source-manifest';
import { validateUatServicePolicy } from './uat-service-policy';
import { validateUatCombinedPublication } from './uat-combined-publication';

type Head = { sequence: number; activeJob: string | null; publication: string | null };
type Capacity = { active: number };
type PeriodicDay = { used: number; limit: number; slotLimit: number; slots: string[] };
type PeriodicCycle = { slotKey: string; policyDigest: string; jobs: string[] };
type PeriodicReceipt = { slotKey: string; planDigest: string; state: 'accepted' | 'running' | 'delayed' | 'completed'; jobId: string | null; reportId: string | null };
function validPeriodicDay(day: PeriodicDay, expectedDay: string) {
  return Object.keys(day).sort().join() === 'limit,slotLimit,slots,used' && Number.isSafeInteger(day.used) && day.used >= 0 && day.used <= 12
    && Number.isSafeInteger(day.limit) && day.limit >= 1 && day.limit <= 12 && Number.isSafeInteger(day.slotLimit) && day.slotLimit >= 1 && day.slotLimit <= 3
    && Array.isArray(day.slots) && day.slots.length <= 3 && new Set(day.slots).size === day.slots.length
    && day.slots.every(slot => typeof slot === 'string' && slot.startsWith(`${expectedDay}:`) && /^\d{4}-\d{2}-\d{2}:\d{1,4}$/.test(slot));
}
type Context = { policy: ReportingPolicy; control: ReportControl; request: ReportRequest; key: string };

/** No source SDK, provider callback or enqueue callback exists in this reader. */
export class MetricsReports {
  constructor(private store: ReportStore, private now: () => number = Date.now, private cache?: ReportBodyCache,
    private detailEnabled = false) {}

  private async context(tx: ReportTransaction, input: unknown, access: ReportAccess, detailRead = false): Promise<Context> {
    validateAccess(access);
    const policy = validatePolicy(await tx.get<ReportingPolicy>(path('policy', 'current')));
    const request = validateRequest(input, policy.maxPeriodDays);
    const control = validateControl(await tx.get<ReportControl>(path('controls', request.reportId)), request, access);
    if (request.reportId === 'one.agent-detail-uat') {
      if (!this.detailEnabled) throw new ReportError('unavailable');
      const [raw,service]=await Promise.all([tx.get(path('policy','one-agent-detail-two-source')),tx.get(path('policy','one-agent-detail-service'))]);
      const source=validateUatTwoSourcePolicies(raw,this.now(),detailRead),approved=validateUatServicePolicy(service,raw,this.now(),detailRead);
      if (approved.scopeDigest!==access.scopeDigest || approved.sourceGeneration!==control.sourceGeneration
        || source.manifest.startDate!==request.startDate || source.manifest.endDate!==request.endDate || source.manifest.timezone!==request.timezone)
        throw new ReportError('unavailable');
    }
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
      if (c.request.reportId === 'one.agent-detail-uat') throw new ReportError('unavailable'); // use the separately authorized detail reader
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
      // Publication age limits retention of provider reports with unknown source
      // freshness. It never establishes an information watermark.
      const age = watermark === null ? now - report.publishedAt : now - watermark;
      if (age > c.control.staleMs) return { state: 'unavailable' as const, report: null };
      this.cache?.put(cacheKey!, report);
      if (watermark === null) return { state: 'unknown_freshness' as const, report };
      return { state: age > c.control.freshnessMs ? 'stale' as const : 'completed' as const, report };
    });
  }

  async request(input: unknown, access: ReportAccess) {
    return this.admit(input, access, 'custom');
  }
  /** Internal scheduler identity only; this method is not exposed to web callers. */
  async requestScheduled(input: unknown, access: ReportAccess) {
    return this.admit(input, access, 'scheduled');
  }
  /** Private fixed-manifest trigger. No policy means no periodic work. */
  async requestPeriodic(entryId: string, access: ReportAccess) {
    return this.admit(null, access, 'scheduled', entryId);
  }
  private async admit(input: unknown, access: ReportAccess, lane: ReportJob['lane'], entryId?: string) {
    const now = this.now();
    const outcome = await this.store.transaction(async tx => {
      const periodicPolicy = lane === 'scheduled' ? await tx.get<unknown>(path('policy', 'periodic')) : null;
      const plan = entryId === undefined ? null : periodicPlan(periodicPolicy, entryId, now);
      // Manual scheduled admission cannot race an enabled periodic cycle.
      if (!plan && lane === 'scheduled' && periodicPolicy && (periodicPolicy as { enabled?: unknown }).enabled !== false) throw new ReportError('unavailable');
      const c = await this.context(tx, plan?.request ?? input, access);
      if (c.request.reportId === 'one.agent-detail-uat' && lane !== 'custom') throw new ReportError('unavailable');
      const head = await tx.get<Head>(path('heads', c.key)) ?? { sequence: 0, activeJob: null, publication: null };
      const publication = head.publication && c.request.reportId !== 'one.agent-detail-uat'
        ? await tx.get<PublishedReport>(path('snapshots', head.publication)) : null;
      const detailId=c.request.reportId==='one.agent-detail-uat'?head.publication:null;
      if (detailId!==null && !/^[a-f0-9]{64}$/.test(detailId)) throw new ReportError('unavailable');
      const [detailPublication,detailJob,detailDraft,detailRaw,detailService]=detailId?await Promise.all([
        tx.get<any>(path('uatCombinedPublications',detailId)),tx.get<ReportJob>(path('jobs',detailId)),
        tx.get<any>(path('uatCombinedDrafts',detailId)),tx.get<any>(path('policy','one-agent-detail-two-source')),
        tx.get<any>(path('policy','one-agent-detail-service'))]):[null,null,null,null,null];
      let detailFresh=false;
      if (detailId) {
        const source=validateUatTwoSourcePolicies(detailRaw,now),ids=uatTwoSourceChildIds(detailId,source.manifestDigest);
        const [feature,location]=await Promise.all([tx.get<any>(path('uatTwoSourceProofs',ids.feature)),tx.get<any>(path('uatTwoSourceProofs',ids.location))]);
        if (!detailJob || detailJob.id!==detailId || detailJob.status!=='completed' || detailJob.key!==c.key
          || digest(detailJob.request)!==digest(c.request) || digest(detailJob.control)!==digest(c.control) || !detailPublication
          || detailPublication.policyDigest!==digest(detailRaw) || detailPublication.servicePolicyDigest!==digest(detailService)
          || detailPublication.manifestDigest!==source.manifestDigest) throw new ReportError('unavailable');
        const checked=validateUatCombinedPublication(detailPublication,detailDraft,{feature,location},detailJob,now,c.policy.maxSnapshotBytes);
        detailFresh=now-checked.computedAt<=c.control.freshnessMs;
      }
      const active = head.activeJob ? await tx.get<ReportJob>(path('jobs', head.activeJob)) : null;
      const slots = await tx.get<Capacity>(path('capacity', lane)) ?? { active: 0 };
      const subjectSlot = path('subjectCapacity', digest([lane, access.subjectHash]));
      const subject = await tx.get<Capacity>(subjectSlot) ?? { active: 0 };
      const receiptRef = plan ? path('periodicReceipts', plan.receiptId) : '';
      const dayRef = plan ? path('periodicDays', plan.day) : '';
      const cycleRef = path('periodicCycles', 'current');
      const receipt = plan ? await tx.get<PeriodicReceipt>(receiptRef) : null;
      const day = plan ? await tx.get<PeriodicDay>(dayRef) : null;
      const cycle = lane === 'scheduled' ? await tx.get<PeriodicCycle>(cycleRef) : null;
      if (cycle && (Object.keys(cycle).sort().join() !== 'jobs,policyDigest,slotKey' || typeof cycle.slotKey !== 'string'
        || !/^\d{4}-\d{2}-\d{2}:\d{1,4}$/.test(cycle.slotKey) || !/^[a-f0-9]{64}$/.test(cycle.policyDigest) || !Array.isArray(cycle.jobs) || cycle.jobs.length > 4
        || new Set(cycle.jobs).size !== cycle.jobs.length || cycle.jobs.some(id => !/^[a-f0-9]{64}$/.test(id)))) throw new ReportError('unavailable');
      if (receipt?.jobId && !/^[a-f0-9]{64}$/.test(receipt.jobId) || receipt?.reportId && !/^[a-f0-9]{64}$/.test(receipt.reportId)) throw new ReportError('unavailable');
      const cycleJobs = cycle ? await Promise.all(cycle.jobs.map(id => tx.get<ReportJob>(path('jobs', id)))) : [];
      const receiptJob = receipt?.jobId ? await tx.get<ReportJob>(path('jobs', receipt.jobId)) : null;
      const receiptPublicationId = receiptJob?.status === 'completed' ? receiptJob.id : receipt?.reportId;
      const receiptPublication = receiptPublicationId ? await tx.get<PublishedReport>(path('snapshots', receiptPublicationId)) : null;
      if (plan && day && !validPeriodicDay(day, plan.day)) throw new ReportError('unavailable');
      let charge: () => void;
      try { charge = await this.quota(tx, access, c.policy, 'compute', now); }
      catch (error) {
        if (plan && day && error instanceof ReportError && error.code === 'quota') {
          const limit = Math.min(day.limit, plan.maxDailyJobs), slotLimit = Math.min(day.slotLimit, plan.maxDailySlots);
          if (limit < day.limit || slotLimit < day.slotLimit) tx.set(dayRef, { ...day, limit, slotLimit });
          return { denied: 'quota' as const };
        }
        throw error;
      }
      const planDigest = plan ? digest([plan.policyDigest, plan.request, c.control, access.scopeDigest]) : '';
      if (plan) {
        if (receipt && (Object.keys(receipt).sort().join() !== 'jobId,planDigest,reportId,slotKey,state'
          || receipt.slotKey !== plan.slotKey || !/^[a-f0-9]{64}$/.test(receipt.planDigest)
          || !['accepted', 'running', 'delayed', 'completed'].includes(receipt.state)
          || (receipt.jobId !== null && (!/^[a-f0-9]{64}$/.test(receipt.jobId) || !receiptJob || receiptJob.id !== receipt.jobId || receiptJob.key !== c.key
            || digest(receiptJob.request) !== digest(c.request) || digest(receiptJob.control) !== digest(c.control)
            || !['accepted', 'running', 'delayed', 'completed', 'failed', 'invalidated'].includes(receiptJob.status)))
          || (receipt.reportId !== null && !/^[a-f0-9]{64}$/.test(receipt.reportId))
          || ((receipt.jobId === null) === (receipt.reportId === null)))) throw new ReportError('unavailable');
        if (cycle && (cycleJobs.length !== cycle.jobs.length || cycleJobs.some((job, index) => !job || job.id !== cycle.jobs[index]))) throw new ReportError('unavailable');
        if (cycle) {
          const [cycleDay, cycleMinute] = cycle.slotKey.split(':'), cycleDate = Date.parse(cycleDay), minute = Number(cycleMinute);
          if (!Number.isFinite(cycleDate) || new Date(cycleDate).toISOString().slice(0, 10) !== cycleDay || !Number.isInteger(minute) || minute < 0 || minute >= 1440
            || (cycle.slotKey !== plan.slotKey && Date.parse(plan.day) + plan.slot * 60_000 <= cycleDate + minute * 60_000)) throw new ReportError('unavailable');
        }
        const limit = Math.min(day?.limit ?? plan.maxDailyJobs, plan.maxDailyJobs), slotLimit = Math.min(day?.slotLimit ?? plan.maxDailySlots, plan.maxDailySlots);
        const persistTighter = () => { if (day && (limit < day.limit || slotLimit < day.slotLimit)) tx.set(dayRef, { ...day, limit, slotLimit }); };
        if (receipt && receipt.planDigest !== planDigest) { persistTighter(); return { denied: 'unavailable' as const }; }
        if (receipt) {
          const published = receiptPublication;
          if (receiptJob?.status === 'completed' || receipt.reportId) {
            if (!published || published.id !== (receiptJob?.id ?? receipt.reportId) || published.key !== c.key
              || digest(published.request) !== digest(c.request) || digest(published.control) !== digest(c.control)
              || !Number.isSafeInteger(published.computedAt) || !Number.isSafeInteger(published.publishedAt)
              || published.computedAt > published.publishedAt || published.publishedAt > now) throw new ReportError('unavailable');
            validateAggregate(published.result, { request: c.request, control: c.control, acceptedAt: 0 } as ReportJob, now, c.policy.maxSnapshotBytes);
          }
          persistTighter(); charge();
          return receiptJob ? { state: receiptJob.status, reportId: receiptJob.status === 'completed' ? receiptJob.id : null, jobId: receiptJob.id }
            : { state: 'completed' as const, reportId: receipt.reportId, jobId: null };
        }
        if (cycle?.slotKey === plan.slotKey && cycle.policyDigest !== plan.policyDigest) { persistTighter(); return { denied: 'unavailable' as const }; }
        if (cycle && cycle.slotKey !== plan.slotKey && cycleJobs.some(job => !['completed', 'failed', 'invalidated'].includes(job!.status))) { persistTighter(); return { denied: 'capacity' as const }; }
        if ((!cycle || cycle.slotKey !== plan.slotKey) && slots.active !== 0) { persistTighter(); return { denied: 'capacity' as const }; }
        if (!day?.slots.includes(plan.slotKey) && (day?.slots.length ?? 0) >= slotLimit) { persistTighter(); return { denied: 'capacity' as const }; }
      }
      if (!plan && lane === 'scheduled' && cycle && (cycleJobs.length !== cycle.jobs.length
        || cycleJobs.some((job, index) => !job || job.id !== cycle.jobs[index] || !['completed', 'failed', 'invalidated'].includes(job.status)))) throw new ReportError('capacity');
      let result: { state: 'accepted' | 'running' | 'delayed' | 'completed'; reportId: string | null; jobId: string | null };
      let jobToCreate: ReportJob | null = null;
      if (detailFresh) {
        result={state:'completed',reportId:detailId!,jobId:null};
      } else if (publication && publication.key === c.key && now - (publication.result.sourceWatermark ?? publication.publishedAt) <= c.control.freshnessMs) {
        if (plan) {
          if (Object.keys(publication).sort().join() !== 'computedAt,control,id,key,publishedAt,request,result'
            || publication.id !== head.publication || digest(publication.request) !== digest(c.request) || digest(publication.control) !== digest(c.control)
            || !Number.isSafeInteger(publication.computedAt) || !Number.isSafeInteger(publication.publishedAt)
            || publication.computedAt > publication.publishedAt || publication.publishedAt > now) throw new ReportError('unavailable');
          validateAggregate(publication.result, { request: c.request, control: c.control, acceptedAt: 0 } as ReportJob, now, c.policy.maxSnapshotBytes);
        }
        result = { state: 'completed', reportId: publication.id, jobId: null };
      } else if (active && ['accepted', 'running', 'delayed'].includes(active.status)) {
        result = { state: active.status as 'accepted' | 'running' | 'delayed', reportId: null, jobId: active.id };
      } else {
        if (!c.policy.computeEnabled) {
          if (plan && day) { tx.set(dayRef, { ...day, limit: Math.min(day.limit, plan.maxDailyJobs), slotLimit: Math.min(day.slotLimit, plan.maxDailySlots) }); return { denied: 'unavailable' as const }; }
          throw new ReportError('unavailable');
        }
        if (!Number.isSafeInteger(slots.active) || slots.active < 0 || slots.active >= c.policy[`${lane}Capacity`]
          || !Number.isSafeInteger(subject.active) || subject.active < 0
          || lane === 'custom' && subject.active >= c.policy.customPerSubjectCapacity) {
          if (plan && day) { tx.set(dayRef, { ...day, limit: Math.min(day.limit, plan.maxDailyJobs), slotLimit: Math.min(day.slotLimit, plan.maxDailySlots) }); return { denied: 'capacity' as const }; }
          throw new ReportError('capacity');
        }
        if (!Number.isSafeInteger(head.sequence) || head.sequence < 0) throw new ReportError('unavailable');
        if (plan && (day?.used ?? 0) >= Math.min(day?.limit ?? plan.maxDailyJobs, plan.maxDailyJobs)) {
          if (day) tx.set(dayRef, { ...day, limit: Math.min(day.limit, plan.maxDailyJobs), slotLimit: Math.min(day.slotLimit, plan.maxDailySlots) });
          return { denied: 'capacity' as const };
        }
        const sequence = head.sequence + 1, id = digest([c.key, sequence]);
        jobToCreate = { id, key: c.key, request: c.request, control: c.control, status: 'accepted', lane, requesterHash: access.subjectHash,
          acceptedAt: now, startedAt: null, completedAt: null, expiresAt: now + c.policy.jobLifetimeMs, fence: 0, leaseUntil: 0,
          nextAttemptAt: 0, needsAttention: false, workerHash: null, providerJobId: `metrics_report_${id}`, dispatchIntent: true, sourceStarted: false };
        result = { state: 'accepted', reportId: null, jobId: id };
      }
      charge();
      if (jobToCreate) {
        tx.create(path('jobs', jobToCreate.id), jobToCreate);
        tx.set(path('heads', c.key), { ...head, sequence: head.sequence + 1, activeJob: jobToCreate.id });
        tx.set(path('capacity', lane), { active: slots.active + 1 });
        tx.set(subjectSlot, { active: subject.active + 1 });
      }
      if (plan) {
        const limit = Math.min(day?.limit ?? plan.maxDailyJobs, plan.maxDailyJobs), slotLimit = Math.min(day?.slotLimit ?? plan.maxDailySlots, plan.maxDailySlots);
        const seen = day?.slots.includes(plan.slotKey) ? day.slots : [...(day?.slots ?? []), plan.slotKey];
        const jobs = cycle?.slotKey === plan.slotKey ? [...cycle.jobs] : [];
        if (result.jobId && !jobs.includes(result.jobId)) jobs.push(result.jobId);
        if (jobs.length > 4) throw new ReportError('capacity');
        tx.set(dayRef, { used: (day?.used ?? 0) + (jobToCreate ? 1 : 0), limit, slotLimit, slots: seen });
        tx.set(cycleRef, { slotKey: plan.slotKey, policyDigest: plan.policyDigest, jobs });
        tx.create(receiptRef, { slotKey: plan.slotKey, planDigest, ...result });
      }
      return result;
    });
    if ('denied' in outcome && outcome.denied) throw new ReportError(outcome.denied);
    return outcome;
  }

  async status(jobId: string, access: ReportAccess) {
    validateAccess(access);
    if (!/^[a-f0-9]{64}$/.test(jobId)) throw new ReportError('invalid');
    const now = this.now();
    return this.store.transaction(async tx => {
      const job = await tx.get<ReportJob>(path('jobs', jobId));
      if (!job) throw new ReportError('unavailable');
      await this.context(tx, job.request, access, job.status === 'completed');
      const policy = validatePolicy(await tx.get<ReportingPolicy>(path('policy', 'current')));
      const charge = await this.quota(tx, access, policy, 'status', now);
      if (job.control.scopeDigest !== access.scopeDigest) throw new ReportError('unauthorized');
      const control = await tx.get<ReportControl>(path('controls', job.request.reportId));
      const dispatch = await tx.get<{ state: string }>(path('dispatches', jobId));
      if (job.request.reportId === 'one.agent-detail-uat' && job.status === 'completed') {
        const [head,pub,draft,raw,service]=await Promise.all([tx.get<Head>(path('heads',job.key)),
          tx.get<any>(path('uatCombinedPublications',jobId)),tx.get<any>(path('uatCombinedDrafts',jobId)),
          tx.get<any>(path('policy','one-agent-detail-two-source')),tx.get<any>(path('policy','one-agent-detail-service'))]);
        const source=validateUatTwoSourcePolicies(raw,now,true),ids=uatTwoSourceChildIds(jobId,source.manifestDigest);
        const [feature,location]=await Promise.all([tx.get<any>(path('uatTwoSourceProofs',ids.feature)),tx.get<any>(path('uatTwoSourceProofs',ids.location))]);
        if (head?.publication!==jobId || !pub || pub.manifestDigest!==source.manifestDigest || pub.policyDigest!==digest(raw)
          || pub.servicePolicyDigest!==digest(service)) throw new ReportError('unavailable');
        const checked=validateUatCombinedPublication(pub,draft,{feature,location},job,now,policy.maxSnapshotBytes);
        if (now-checked.computedAt>job.control.staleMs) throw new ReportError('unavailable');
      }
      charge();
      const needsAttention = job.needsAttention || job.status === 'accepted' && dispatch?.state === 'blocked';
      const state = digest(control) !== digest(job.control) ? 'invalidated' as const
        : job.status === 'accepted' && ['uncertain', 'blocked'].includes(dispatch?.state ?? '') ? 'delayed' as const : job.status;
      return { state, jobId, acceptedAt: job.acceptedAt, needsAttention,
        queueWaitMs: Math.max(0, (job.startedAt ?? now) - job.acceptedAt),
        executionMs: job.startedAt === null ? 0 : Math.max(0, (job.completedAt ?? now) - job.startedAt),
        retryAfterMs: ['completed', 'failed', 'invalidated'].includes(state) || needsAttention ? 0
          : Math.max(policy.leaseMs, job.nextAttemptAt - now) };
    });
  }
}

/** Worker methods are not exported through the reader's HTTP routes. */
export class MetricsReportWorker {
  constructor(private store: ReportStore, private now: () => number = Date.now) {}
  private async invalidate(tx: ReportTransaction, job: ReportJob, now: number, workerHash: string) {
    const head = await tx.get<Head>(path('heads', job.key));
    const slots = await tx.get<Capacity>(path('capacity', job.lane));
    const subjectSlot = path('subjectCapacity', digest([job.lane, job.requesterHash]));
    const subject = await tx.get<Capacity>(subjectSlot);
    if (head?.activeJob !== job.id || !slots || !Number.isSafeInteger(slots.active) || slots.active < 1
      || !subject || !Number.isSafeInteger(subject.active) || subject.active < 1) throw new ReportError('unavailable');
    tx.set(path('heads', job.key), { ...head, activeJob: null });
    tx.set(path('jobs', job.id), { ...job, status: 'invalidated', completedAt: now, fence: job.fence + 1,
      workerHash, leaseUntil: 0, nextAttemptAt: 0, needsAttention: false });
    tx.set(path('capacity', job.lane), { active: slots.active - 1 });
    tx.set(subjectSlot, { active: subject.active - 1 });
    // Source/budget receipts remain immutable evidence of consumed or uncertain work.
  }
  async claim(jobId: string, workerHash: string, maxClaims?: number) {
    if (!/^[a-f0-9]{64}$/.test(jobId) || !/^[a-f0-9]{64}$/.test(workerHash)
      || maxClaims !== undefined && (!Number.isSafeInteger(maxClaims) || maxClaims < 1)) throw new ReportError('invalid');
    const now = this.now();
    return this.store.transaction(async tx => {
      const policy = validatePolicy(await tx.get<ReportingPolicy>(path('policy', 'current')));
      const job = await tx.get<ReportJob>(path('jobs', jobId));
      if (!job) throw new ReportError('unavailable');
      const control = await tx.get<ReportControl>(path('controls', job.request.reportId));
      if (['completed', 'failed', 'invalidated'].includes(job.status) || job.leaseUntil > now) return null;
      if (job.sourceStarted && digest(control) !== digest(job.control)) {
        // A completed journal is a known outcome of the frozen source, even if
        // current publication authority has changed. Settle it without invoking
        // a new source factory or publishing obsolete information. Unknown work
        // keeps capacity and an explicit attention flag; absence is not proof.
        const receipt = await tx.get<{ binding: string; state: string; result: AggregateResult | null }>(path('sourceReceipts', job.id));
        let settled = false;
        try {
          if (!receipt || Object.keys(receipt).sort().join() !== 'binding,result,state' || receipt.state !== 'completed'
            || !/^[a-f0-9]{64}$/.test(receipt.binding) || !receipt.result) throw new ReportError('unavailable');
          validateAggregate(receipt.result, job, now, 900_000);
          settled = true;
        } catch { /* Malformed or uncertain evidence never releases capacity. */ }
        if (settled) await this.invalidate(tx, job, now, workerHash);
        else if (job.status !== 'delayed' || !job.needsAttention || job.leaseUntil !== 0 || job.nextAttemptAt !== 0) {
          tx.set(path('jobs', job.id), { ...job, status: 'delayed', fence: job.fence + 1, workerHash,
            leaseUntil: 0, nextAttemptAt: 0, needsAttention: true });
        }
        return null;
      }
      if (!policy.computeEnabled) throw new ReportError('unavailable');
      if (job.needsAttention || job.nextAttemptAt > now) return null;
      // Expired unstarted work is never dispatched. Uncertain work needs recovery,
      // even after expiry; lease expiry cannot release its capacity/reservation.
      if (!job.sourceStarted && (job.expiresAt <= now || digest(control) !== digest(job.control))) {
        await this.invalidate(tx, job, now, workerHash);
        return null;
      }
      if (maxClaims !== undefined && job.fence >= maxClaims) {
        tx.set(path('jobs', job.id), { ...job, status: 'delayed', leaseUntil: 0, nextAttemptAt: 0, needsAttention: true });
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
      const slots = await tx.get<Capacity>(path('capacity', claim.lane));
      const subjectSlot = path('subjectCapacity', digest([claim.lane, claim.requesterHash]));
      const subject = await tx.get<Capacity>(subjectSlot);
      if (current?.status === 'completed' && head?.publication === claim.id) return claim.id;
      if (!policy.computeEnabled || !current || current.status !== 'running' || current.fence !== claim.fence
        || current.workerHash !== claim.workerHash || current.leaseUntil <= now
        || digest(current.control) !== digest(control) || digest(current.request) !== digest(claim.request)
        || current.lane !== claim.lane || current.requesterHash !== claim.requesterHash
        || head?.activeJob !== claim.id || !slots || !Number.isSafeInteger(slots.active) || slots.active < 1
        || !subject || !Number.isSafeInteger(subject.active) || subject.active < 1) throw new ReportError('stale_worker');
      validateAggregate(result, current, now, policy.maxSnapshotBytes);
      const publication: PublishedReport = { id: claim.id, key: claim.key, request: current.request,
        control: current.control, result, computedAt: now, publishedAt: now };
      tx.create(path('snapshots', claim.id), publication);
      tx.set(path('heads', claim.key), { ...head, activeJob: null, publication: claim.id });
      tx.set(path('jobs', claim.id), { ...current, status: 'completed', leaseUntil: 0, completedAt: now });
      tx.set(path('capacity', claim.lane), { active: slots.active - 1 });
      tx.set(subjectSlot, { active: subject.active - 1 });
      return claim.id;
    });
  }

  async uncertain(claim: ReportJob) {
    return this.defer(claim, 0, false);
  }
  async defer(claim: ReportJob, retryAt: number, needsAttention: boolean) {
    if (!Number.isSafeInteger(retryAt) || retryAt < 0) throw new ReportError('invalid');
    return this.store.transaction(async tx => {
      const job = await tx.get<ReportJob>(path('jobs', claim.id));
      if (!job || job.status !== 'running' || job.fence !== claim.fence || job.workerHash !== claim.workerHash) throw new ReportError('stale_worker');
      tx.set(path('jobs', claim.id), { ...job, status: 'delayed', leaseUntil: 0, nextAttemptAt: retryAt, needsAttention });
      // Do not free capacity, reset providerJobId or refund paid-work reservations.
    });
  }
  async inspect(jobId: string) {
    if (!/^[a-f0-9]{64}$/.test(jobId)) throw new ReportError('invalid');
    return this.store.transaction(tx => tx.get<ReportJob>(path('jobs', jobId)));
  }
  async stopRecovery(jobId: string) {
    const now = this.now();
    if (!/^[a-f0-9]{64}$/.test(jobId)) throw new ReportError('invalid');
    return this.store.transaction(async tx => {
      const job = await tx.get<ReportJob>(path('jobs', jobId));
      if (!job || ['completed', 'failed', 'invalidated'].includes(job.status) || job.leaseUntil > now) return false;
      tx.set(path('jobs', jobId), { ...job, status: 'delayed', leaseUntil: 0, nextAttemptAt: 0, needsAttention: true });
      return true; // Capacity and every source/budget receipt remain retained.
    });
  }
}
