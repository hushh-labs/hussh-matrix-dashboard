import { digest, ReportError, reportingTimezone, validatePolicy, type AggregateResult, type MetricValue, type ReportJob,
  type ReportControl, type ReportingPolicy } from './contracts';
import type { AggregateReportSource } from './collector';
import { reportPath, type ReportStore, type ReportTransaction } from './store';
import { providerRetryAfter, SourceRequestFailure } from './source-errors';
import { withinDeadline } from './deadline';
import { hasGa4WebsiteScope, websiteSourceOrigins, type Ga4WebsiteScope } from './bindings';

type SourceCall = { binding: string; state: 'reserved' | 'completed'; result: AggregateResult | null };
type SourcePolicy = { sourceGeneration: string; timeoutMs: number; maxResponseBytes: number };
export type AggregateFetch = (url: string, options: { body: unknown; signal: AbortSignal }) => Promise<Response>;

/** Native read APIs do not have a recoverable query job. Reserve once before
 * I/O and persist validated aggregates. A lost acknowledgement stays uncertain;
 * redelivery never starts a second provider request. No raw response is stored. */
abstract class JournaledSource implements AggregateReportSource {
  constructor(protected store: ReportStore, protected policy: SourcePolicy, protected now: () => number = Date.now) {
    if (!/^[a-f0-9]{64}$/.test(policy.sourceGeneration)
      || !Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs <= 0
      || !Number.isSafeInteger(policy.maxResponseBytes) || policy.maxResponseBytes <= 0 || policy.maxResponseBytes > 900_000) throw new ReportError('invalid');
  }
  protected abstract binding(job: ReportJob): string;
  protected abstract collect(job: ReportJob): Promise<AggregateResult>;
  protected async sourceBudget(_tx: ReportTransaction, _job: ReportJob): Promise<() => void> { return () => {}; }
  async submit(job: ReportJob) {
    if (job.control.sourceGeneration !== this.policy.sourceGeneration) throw new ReportError('invalid');
    const ref = reportPath('sourceReceipts', job.id), binding = this.binding(job);
    const admission = await this.store.transaction(async tx => {
      const current = await tx.get<SourceCall>(ref);
      const liveJob = await tx.get<ReportJob>(reportPath('jobs', job.id));
      const control = await tx.get<ReportControl>(reportPath('controls', job.request.reportId));
      const policy = validatePolicy(await tx.get<ReportingPolicy>(reportPath('policy', 'current')));
      if (!policy.computeEnabled || !liveJob || liveJob.status !== 'running' || liveJob.fence !== job.fence
        || liveJob.workerHash !== job.workerHash || liveJob.leaseUntil <= this.now()
        || digest(control) !== digest(job.control)) throw new ReportError('stale_worker');
      if (current) {
        if (current.binding !== binding) throw new ReportError('invalid');
        return { admitted: false, result: current.result };
      }
      const reserve = await this.sourceBudget(tx, job);
      reserve();
      tx.create(ref, { binding, state: 'reserved', result: null });
      return { admitted: true, result: null };
    });
    if (!admission.admitted) return admission.result;
    const result = await this.collect(job);
    // Validate before storing the receipt, as well as before publication.
    const { validateAggregate } = await import('./contracts');
    validateAggregate(result, job, this.now(), this.policy.maxResponseBytes);
    await this.store.transaction(async tx => {
      const current = await tx.get<SourceCall>(ref);
      if (!current || current.binding !== binding || current.state !== 'reserved') throw new ReportError('invalid');
      tx.set(ref, { binding, state: 'completed', result });
    });
    return result;
  }
  async recover(job: ReportJob) {
    if (job.control.sourceGeneration !== this.policy.sourceGeneration) throw new ReportError('invalid');
    const receipt = await this.store.transaction(tx => tx.get<SourceCall>(reportPath('sourceReceipts', job.id)));
    // With no journal, no source call was admitted. The same fenced reservation
    // path safely admits the first call and rejects a late obsolete worker.
    if (!receipt) return this.submit(job);
    if (receipt.binding !== this.binding(job)) return null;
    return receipt.state === 'completed' ? receipt.result : null;
  }
  protected async boundedJson(response: Response, signal: AbortSignal) {
    if (!response.ok) throw new SourceRequestFailure([400, 401, 403, 404, 422].includes(response.status) ? 'configuration' : 'transient',
      providerRetryAfter(response.headers.get('retry-after'), this.now()));
    if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new SourceRequestFailure('configuration');
    if (Number(response.headers.get('content-length')) > this.policy.maxResponseBytes) throw new SourceRequestFailure('configuration');
    const stream = response.body?.getReader();
    if (!stream) throw new SourceRequestFailure('configuration');
    let bytes = 0, body = ''; const decoder = new TextDecoder();
    try {
      while (true) {
        const part = await withinDeadline(stream.read(), signal); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > this.policy.maxResponseBytes) throw new SourceRequestFailure('configuration');
        body += decoder.decode(part.value, { stream: true });
      }
      try { return JSON.parse(body + decoder.decode()); }
      catch { throw new SourceRequestFailure('configuration'); }
    } finally { await stream.cancel(); }
  }
}

export class Ga4AcquisitionSource extends JournaledSource {
  constructor(store: ReportStore, policy: SourcePolicy, private config: Ga4WebsiteScope & {
    propertyId: string; timezone: string; informationWatermark: number | null;
  }, private fetch: AggregateFetch, now?: () => number) {
    super(store, policy, now);
    if (!/^\d{3,20}$/.test(config.propertyId) || !hasGa4WebsiteScope(config)) throw new ReportError('invalid');
    this.config = { ...config, hostnames: [...config.hostnames], timezone: reportingTimezone(config.timezone) };
  }
  protected binding(job: ReportJob) { return digest([job.key, this.config, this.policy.sourceGeneration]); }
  protected async collect(job: ReportJob): Promise<AggregateResult> {
    if (job.request.reportId !== 'hushhai.acquisition' || job.request.timezone !== this.config.timezone) throw new ReportError('invalid');
    const signal = AbortSignal.timeout(this.policy.timeoutMs);
    const data = await this.boundedJson(await this.fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${this.config.propertyId}:runReport`, {
      body: { dateRanges: [{ startDate: job.request.startDate, endDate: job.request.endDate }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagedSessions' }, { name: 'keyEvents' }],
        dimensionFilter: { andGroup: { expressions: [
          { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: this.config.streamId, caseSensitive: true } } },
          { filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'web', caseSensitive: true } } },
          { filter: { fieldName: 'hostName', inListFilter: { values: this.config.hostnames, caseSensitive: false } } },
        ] } },
        returnPropertyQuota: true, limit: '1' }, signal,
    }), signal);
    let propertyTimezone: string;
    try { propertyTimezone = reportingTimezone(data?.metadata?.timeZone); }
    catch { throw new SourceRequestFailure('configuration'); }
    const names = ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents'];
    const emptyRows = data.rows === undefined || Array.isArray(data.rows) && data.rows.length === 0;
    const partial = !!(data.metadata.subjectToThresholding || data.metadata.dataLossFromOtherRow || data.metadata.samplingMetadatas?.length);
    // ProtoJSON omits default int32/repeated fields. A native empty runReport
    // can omit rowCount, rows and metricHeaders. Require its response kind and
    // requested quota receipt; an arbitrary metadata object is not zero traffic.
    const emptyHeaders = data.metricHeaders === undefined || Array.isArray(data.metricHeaders) && data.metricHeaders.length === 0;
    const consumed = data.propertyQuota?.tokensPerDay?.consumed;
    const nativeEmpty = emptyRows && emptyHeaders && (data.rowCount === undefined || data.rowCount === 0)
      && data.kind === 'analyticsData#runReport' && Number.isSafeInteger(consumed) && consumed >= 0;
    const expectedHeaders = Array.isArray(data.metricHeaders)
      && data.metricHeaders.map((v: { name?: string }) => v?.name).join() === names.join();
    if (propertyTimezone !== this.config.timezone || !expectedHeaders && !nativeEmpty
      || data.kind !== undefined && data.kind !== 'analyticsData#runReport'
      || data.metadata.emptyReason || emptyRows && partial
      || (data.rows !== undefined && (!Array.isArray(data.rows) || data.rows.length > 1))
      || (data.rowCount !== undefined && (!Number.isSafeInteger(data.rowCount) || data.rowCount < 0 || data.rowCount > 1))
      || data.rowCount === 0 && data.rows?.length) throw new SourceRequestFailure('configuration');
    // GA4 does not supply an export watermark in runReport. Unknown freshness
    // remains explicit until a separately verified source watermark exists.
    const metrics: Record<string, MetricValue> = {};
    const values = data.rows?.[0]?.metricValues;
    if ((data.rows?.length === 1 && (!Array.isArray(values) || values.length !== names.length))
      || data.rowCount > 0 && !data.rows?.length) throw new SourceRequestFailure('configuration');
    names.forEach((name, index) => {
      const raw = values?.[index]?.value;
      if (values && (typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))) throw new SourceRequestFailure('configuration');
      const unknown = this.config.informationWatermark === null;
      metrics[name] = { value: raw === undefined ? 0 : Number(raw),
        coverage: unknown || partial ? 'partial' : 'available',
        unit: name === 'activeUsers' ? 'provider_user' : name === 'keyEvents' ? 'key_event' : 'session', basis: 'provider_defined' };
    });
    return { metrics, sourceCheckedAt: this.now(), sourceWatermark: this.config.informationWatermark,
      sourceGeneration: job.control.sourceGeneration, scopeDigest: job.control.scopeDigest, definitionVersion: job.control.definitionVersion,
      period: { startDate: job.request.startDate, endDate: job.request.endDate, timezone: job.request.timezone }, reconciled: true };
  }
}

/** Proposed narrow source contract. It is deliberately not the private PLG
 * owner/audience export. Live backend support and reconciliation are pending. */
export class OneAdoptionSource extends JournaledSource {
  constructor(store: ReportStore, policy: SourcePolicy, private environment: 'production' | 'uat',
    private fetch: AggregateFetch, now?: () => number) {
    super(store, policy, now);
    if (!['production', 'uat'].includes(environment)) throw new ReportError('invalid');
  }
  protected binding(job: ReportJob) { return digest([job.key, this.environment, this.policy.sourceGeneration]); }
  protected async collect(job: ReportJob): Promise<AggregateResult> {
    if (job.request.reportId !== 'one.adoption') throw new ReportError('invalid');
    const origin = this.environment === 'production' ? 'https://api.hushh.ai' : 'https://api.uat.hushh.ai';
    const signal = AbortSignal.timeout(this.policy.timeoutMs);
    return await this.boundedJson(await this.fetch(`${origin}/api/one/metrics/adoption`, {
      body: { period: { startDate: job.request.startDate, endDate: job.request.endDate, timezone: job.request.timezone },
        definitionVersion: job.control.definitionVersion, sourceGeneration: job.control.sourceGeneration, scopeDigest: job.control.scopeDigest },
      signal,
    }), signal) as AggregateResult;
  }
}

/** Source-owned accepted-event counts. Keep these separate from GA4 identity,
 * sessions, conversion definitions and confirmed One business outcomes. */
export class WebsiteActivitySource extends JournaledSource {
  constructor(store: ReportStore, policy: SourcePolicy, private environment: 'production' | 'uat',
    private captureGeneration: string, private maxEventsPerDay: number, private fetch: AggregateFetch, now?: () => number) {
    super(store, policy, now);
    if (!Object.hasOwn(websiteSourceOrigins, environment) || !/^[a-f0-9]{64}$/.test(captureGeneration)
      || !Number.isSafeInteger(maxEventsPerDay) || maxEventsPerDay < 1 || maxEventsPerDay > 1000) throw new ReportError('invalid');
  }
  protected binding(job: ReportJob) { return digest([job.key, this.environment, this.captureGeneration, this.maxEventsPerDay, this.policy.sourceGeneration]); }
  protected async sourceBudget(tx: ReportTransaction, job: ReportJob) {
    const policy = await tx.get<{ approved: boolean; dailyReadUnits: number }>(reportPath('policy', 'website-read-budget'));
    if (!policy || Object.keys(policy).sort().join() !== 'approved,dailyReadUnits' || policy.approved !== true
      || !Number.isSafeInteger(policy.dailyReadUnits) || policy.dailyReadUnits <= 0) throw new SourceRequestFailure('configuration');
    // Include point lookups and the receipt-query sentinel. This is an
    // engineering upper bound, not a native billing or currency estimate.
    const days = (Date.parse(job.request.endDate) - Date.parse(job.request.startDate)) / 86_400_000 + 1;
    const units = days * (this.maxEventsPerDay + 3);
    if (!Number.isSafeInteger(units) || units <= 0 || days > 7) throw new ReportError('invalid');
    const ref = reportPath('sourceReadBudgets', `website-${this.environment}-${new Date(this.now()).toISOString().slice(0, 10)}`);
    const budget = await tx.get<{ used: number; limit: number }>(ref);
    if (budget && (Object.keys(budget).sort().join() !== 'limit,used' || !Number.isSafeInteger(budget.used)
      || !Number.isSafeInteger(budget.limit) || budget.used < 0 || budget.used > budget.limit)) throw new SourceRequestFailure('configuration');
    const used = budget?.used ?? 0, limit = Math.min(budget?.limit ?? policy.dailyReadUnits, policy.dailyReadUnits);
    if (units > limit - used) throw new SourceRequestFailure('configuration');
    // No refund on timeout, schema failure or lost acknowledgement. The day key
    // excludes generation, staff and job sequence, preventing quota resets.
    return () => tx.set(ref, { used: used + units, limit });
  }
  protected async collect(job: ReportJob): Promise<AggregateResult> {
    if (job.request.reportId !== 'hushhai.activity' || job.request.timezone !== 'UTC') throw new ReportError('invalid');
    const signal = AbortSignal.timeout(this.policy.timeoutMs);
    return await this.boundedJson(await this.fetch(`${websiteSourceOrigins[this.environment]}/api/metrics/website/activity`, {
      body: { period: { startDate: job.request.startDate, endDate: job.request.endDate, timezone: job.request.timezone },
        definitionVersion: job.control.definitionVersion, sourceGeneration: job.control.sourceGeneration,
        scopeDigest: job.control.scopeDigest, captureGeneration: this.captureGeneration, maxEventsPerDay: this.maxEventsPerDay }, signal,
    }), signal) as AggregateResult;
  }
}
