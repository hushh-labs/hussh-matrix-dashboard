import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';

const path = 'metricsMonitoringPublications/initial_20261115', callLimit = 15, retentionMs = 90 * 86_400_000, staleMs = 24 * 60 * 60_000;
const daysList = [1, 7, 14, 30, 90] as const;
const metrics = [
  { key: 'requests', metric: 'run.googleapis.com/request_count', align: 'ALIGN_DELTA', reduce: 'REDUCE_SUM', filter: '' },
  { key: 'errors', metric: 'run.googleapis.com/request_count', align: 'ALIGN_DELTA', reduce: 'REDUCE_SUM', filter: 'metric.labels.response_code_class="5xx"' },
  { key: 'instances', metric: 'run.googleapis.com/container/instance_count', align: 'ALIGN_MAX', reduce: 'REDUCE_MAX', filter: '' },
] as const;
type Database = Pick<Firestore, 'doc' | 'runTransaction'>;
type Send = (url: string) => Promise<any>;
let shared: Promise<Database> | undefined;
const database = () => shared ??= import('@google-cloud/firestore').then(({ Firestore }) => new Firestore({ projectId: 'hushh-ai-prod', databaseId: 'one-plg-production' }));
const binding = (project: string, service: string, asOf: string) => createHash('sha256').update(JSON.stringify([project, service, asOf])).digest('hex');
export class MonitoringPublication {
  constructor(private db: Database, private project: string, private service: string, private asOf: string, private now = () => Date.now()) {
    if (!/^[a-z][a-z0-9-]{2,62}$/.test(project) || !/^[a-z][a-z0-9-]{2,62}$/.test(service) || !Number.isFinite(Date.parse(asOf))) throw new Error('Invalid Monitoring binding');
  }
  async read(start: string, end: string) {
    const snapshot = await this.db.doc(path).get(), v = snapshot.data();
    if (!snapshot.exists || v?.state !== 'complete' || v.binding !== binding(this.project, this.service, this.asOf)
      || !Number.isFinite(v.observedAt) || this.now() < v.observedAt || this.now() - v.observedAt > retentionMs) return null;
    const window = v.windows?.find((w: any) => w.startDate === start && w.endDate === end);
    return window ? { ...window, source: 'Cloud Monitoring · production One service', sourceObservedAt: new Date(v.observedAt).toISOString(), stale: this.now() - v.observedAt > staleMs } : null;
  }
  async collect(send: Send) {
    const ref = this.db.doc(path), claimedAt = this.now(), key = binding(this.project, this.service, this.asOf);
    await this.db.runTransaction(async tx => { if ((await tx.get(ref)).exists) throw new Error('Monitoring collection already claimed'); tx.create(ref, { state: 'claimed', binding: key, claimedAt, callLimit }); });
    const end = Date.parse(this.asOf.slice(0, 10) + 'T00:00:00Z') + 86_400_000; let calls = 0; const windows = [];
    for (const days of daysList) {
      const start = end - days * 86_400_000, fields: Record<string, unknown> = {};
      for (const metric of metrics) {
        const url = new URL(`https://monitoring.googleapis.com/v3/projects/${this.project}/timeSeries`);
        url.searchParams.set('filter', [`metric.type="${metric.metric}"`, 'resource.type="cloud_run_revision"', `resource.labels.service_name="${this.service}"`, 'resource.labels.location="us-central1"', metric.filter].filter(Boolean).join(' AND '));
        url.searchParams.set('interval.startTime', new Date(start).toISOString()); url.searchParams.set('interval.endTime', new Date(end).toISOString());
        url.searchParams.set('aggregation.alignmentPeriod', `${days * 86_400}s`); url.searchParams.set('aggregation.perSeriesAligner', metric.align); url.searchParams.set('aggregation.crossSeriesReducer', metric.reduce);
        url.searchParams.append('aggregation.groupByFields', 'resource.labels.service_name'); url.searchParams.set('pageSize', '100');
        try {
          if (++calls > callLimit) throw new Error('Monitoring call limit');
          const data = await send(url.toString()), series = data?.timeSeries;
          const validSeries = Array.isArray(series) && series.length <= 100 && series.every((s: any) => Array.isArray(s.points) && s.points.length <= 1);
          const points = validSeries ? series.flatMap((s: any) => s.points) : [];
          const incomplete = (data.executionErrors !== undefined && (!Array.isArray(data.executionErrors) || data.executionErrors.length > 0))
            || (data.unreachable !== undefined && (!Array.isArray(data.unreachable) || data.unreachable.length > 0));
          const point = points.length === 1 && !data.nextPageToken && !incomplete ? points[0] : null;
          const rawInteger = point?.value?.int64Value, rawDouble = point?.value?.doubleValue;
          const number = typeof rawInteger === 'string' && /^\d+$/.test(rawInteger) ? Number(rawInteger)
            : typeof rawDouble === 'number' ? rawDouble : NaN;
          const interval = point?.interval, exact = interval && Date.parse(interval.startTime) === start && Date.parse(interval.endTime) === end;
          fields[metric.key] = { value: exact && Number.isSafeInteger(number) && number >= 0 ? number : null, observedAt: new Date(this.now()).toISOString() };
        } catch { fields[metric.key] = { value: null, observedAt: new Date(this.now()).toISOString() }; }
      }
      windows.push({ startDate: new Date(start).toISOString().slice(0, 10), endDate: new Date(end - 1).toISOString().slice(0, 10), days, metrics: fields });
    }
    await this.db.runTransaction(async tx => { const snapshot = await tx.get(ref), v = snapshot.data(); if (!snapshot.exists || v?.state !== 'claimed' || v.binding !== key || v.claimedAt !== claimedAt || v.callLimit !== callLimit) throw new Error('Monitoring claim changed'); tx.update(ref, { state: 'complete', observedAt: this.now(), calls, windows }); });
    return { state: 'complete', calls };
  }
}
export async function monitoringPublication(project: string, service: string, asOf: string) { return new MonitoringPublication(await database(), project, service, asOf); }
export async function monitoringSend(url: string) {
  const parsed = new URL(url); if (parsed.protocol !== 'https:' || parsed.hostname !== 'monitoring.googleapis.com') throw new Error('Untrusted Monitoring source');
  const { GoogleAuth } = await import('google-auth-library'); const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/monitoring.read'] }).getClient();
  const response = await client.request({ url, timeout: 10_000, retry: false, maxRedirects: 0, maxContentLength: 1_048_576 }); return response.data;
}
