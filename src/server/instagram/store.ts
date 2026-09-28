import { BigQuery } from '@google-cloud/bigquery';
import { createHash } from 'node:crypto';
import type { ReachObservation } from './client';

export interface InstagramSummary {
  state: 'not_configured' | 'empty' | 'available' | 'stale' | 'sync_failed' | 'reconnect_required' | 'permission_missing' | 'sync_in_progress';
  username: string | null;
  reach: ReachObservation | null;
  lastSuccessfulSync: string | null;
  lastAttempt: string | null;
  lastErrorKind?: string | null;
}

export interface InstagramStore {
  acquire(runId: string): Promise<boolean>;
  release(runId: string): Promise<void>;
  attemptedSince(accountId: string, since: Date): Promise<boolean>;
  start(runId: string, accountId: string, since: Date, until: Date): Promise<void>;
  verifiedAccount(accountId: string, username: string, version: string): Promise<void>;
  saveReach(runId: string, accountId: string, observation: ReachObservation, version: string): Promise<void>;
  finish(runId: string, accountId: string, state: string, reachStatus: string, errorKind?: string): Promise<void>;
  summary(accountId: string): Promise<InstagramSummary>;
}

export function observationKey(accountId: string, observation: ReachObservation): string {
  return createHash('sha256').update([
    accountId, observation.name, observation.period, observation.metricType,
    observation.requestedSince, observation.requestedUntil, '', // no breakdown
  ].join('|')).digest('hex');
}

function timestamp(value: any): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.value === 'string') return new Date(value.value).toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return null;
}

export class BigQueryInstagramStore implements InstagramStore {
  private readonly bq: Pick<BigQuery, 'query'>;
  private readonly prefix: string;
  constructor(project = process.env.INSTAGRAM_BQ_PROJECT || 'hushh-ai-prod', dataset = process.env.INSTAGRAM_BQ_DATASET || 'instagram_analytics', jobProject = process.env.BQ_JOB_PROJECT || project, bigquery?: Pick<BigQuery, 'query'>) {
    if (![project, dataset, jobProject].every((id) => /^[a-zA-Z][a-zA-Z0-9_-]{2,62}$/.test(id))) throw new Error('Invalid Instagram BigQuery identifier');
    this.prefix = `\`${project}.${dataset}`;
    this.bq = bigquery || new BigQuery({ projectId: jobProject });
  }
  private table(name: string): string { return `${this.prefix}.${name}\``; }
  private async query(query: string, params: Record<string, unknown> = {}): Promise<any[]> {
    const nullTypes = Object.fromEntries(Object.entries(params).filter(([, value]) => value === null).map(([key]) => [key, key === 'value' ? 'FLOAT64' : 'STRING']));
    const [rows] = await this.bq.query({ query, params, types: nullTypes, location: 'US', useLegacySql: false, maximumBytesBilled: '100000000' });
    return rows;
  }
  async acquire(runId: string): Promise<boolean> {
    try {
      await this.query(`BEGIN TRANSACTION;
        UPDATE ${this.table('sync_lock')} SET owner=@runId, lease_until=TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 10 MINUTE)
        WHERE lock_name='company-instagram' AND lease_until < CURRENT_TIMESTAMP();
        ASSERT @@row_count = 1 AS 'Instagram sync already running';
        COMMIT TRANSACTION;`, { runId });
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Instagram sync already running')) return false;
      throw new Error('Instagram sync lock unavailable');
    }
  }
  async release(runId: string): Promise<void> {
    await this.query(`UPDATE ${this.table('sync_lock')} SET owner=NULL, lease_until=TIMESTAMP '1970-01-01 00:00:00+00'
      WHERE lock_name='company-instagram' AND owner=@runId`, { runId });
  }
  async attemptedSince(accountId: string, since: Date): Promise<boolean> {
    const rows = await this.query(`SELECT 1 AS attempted FROM ${this.table('sync_runs')}
      WHERE account_id=@accountId AND started_at >= TIMESTAMP(@since) LIMIT 1`, { accountId, since: since.toISOString() });
    return rows.length > 0;
  }
  async start(runId: string, accountId: string, since: Date, until: Date): Promise<void> {
    await this.query(`INSERT INTO ${this.table('sync_runs')}
      (run_id,account_id,started_at,status,reach_status,requested_since,requested_until)
      VALUES (@runId,@accountId,CURRENT_TIMESTAMP(),'running','unknown',@since,@until)`, {
        runId, accountId, since: since.toISOString(), until: until.toISOString(),
      });
  }
  async verifiedAccount(accountId: string, username: string, version: string): Promise<void> {
    await this.query(`MERGE ${this.table('accounts')} T USING
      (SELECT @accountId account_id, @username username, @version api_version) S
      ON T.account_id=S.account_id
      WHEN MATCHED THEN UPDATE SET username=S.username, api_version=S.api_version, verified_at=CURRENT_TIMESTAMP(), connection_state='connected', last_attempt_at=CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (account_id,username,api_version,verified_at,last_attempt_at,connection_state)
      VALUES (S.account_id,S.username,S.api_version,CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP(),'connected')`, { accountId, username, version });
  }
  async saveReach(runId: string, accountId: string, observation: ReachObservation, version: string): Promise<void> {
    const params = { key: observationKey(accountId, observation), accountId, runId, version,
      name: observation.name, value: observation.value, status: observation.status,
      period: observation.period, metricType: observation.metricType, unit: observation.unit,
      since: observation.requestedSince, until: observation.requestedUntil };
    await this.query(`MERGE ${this.table('account_metrics')} T USING
      (SELECT @key observation_key, @accountId account_id, @name metric_name,
        @value value, @status value_status, @period period, @metricType metric_type,
        @unit unit, TIMESTAMP(@since) requested_since, TIMESTAMP(@until) requested_until,
        @version api_version, @runId sync_run_id) S
      ON T.observation_key=S.observation_key AND T.requested_until=S.requested_until
      WHEN MATCHED THEN UPDATE SET value=S.value,value_status=S.value_status,
        api_version=S.api_version,fetched_at=CURRENT_TIMESTAMP(),sync_run_id=S.sync_run_id
      WHEN NOT MATCHED THEN INSERT
        (observation_key,account_id,metric_name,value,value_status,period,metric_type,unit,
         requested_since,requested_until,provider_since,provider_until,breakdowns_json,api_version,fetched_at,sync_run_id)
        VALUES (S.observation_key,S.account_id,S.metric_name,S.value,S.value_status,S.period,S.metric_type,S.unit,
          S.requested_since,S.requested_until,NULL,NULL,NULL,S.api_version,CURRENT_TIMESTAMP(),S.sync_run_id)`, params);
  }
  async finish(runId: string, accountId: string, state: string, reachStatus: string, errorKind?: string): Promise<void> {
    await this.query(`UPDATE ${this.table('sync_runs')} SET finished_at=CURRENT_TIMESTAMP(), status=@state,
      reach_status=@reachStatus,error_kind=@errorKind WHERE run_id=@runId AND account_id=@accountId
      AND started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)`,
      { runId, accountId, state, reachStatus, errorKind: errorKind || null });
    await this.query(`UPDATE ${this.table('accounts')} SET last_attempt_at=CURRENT_TIMESTAMP(),
      last_success_at=IF(@state='success',CURRENT_TIMESTAMP(),last_success_at),
      connection_state=IF(@state='reconnect_required','reconnect_required',IF(@state='permission_missing','permission_missing',connection_state))
      WHERE account_id=@accountId`, { accountId, state });
  }
  async summary(accountId: string): Promise<InstagramSummary> {
    const [accounts, metrics, runs] = await Promise.all([
      this.query(`SELECT username,last_success_at,last_attempt_at,connection_state FROM ${this.table('accounts')}
        WHERE account_id=@accountId LIMIT 1`, { accountId }),
      this.query(`SELECT metric_name,value,value_status,period,metric_type,unit,requested_since,requested_until,
          provider_since,provider_until,fetched_at FROM ${this.table('account_metrics')}
        WHERE account_id=@accountId AND metric_name='reach' AND requested_until >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
        ORDER BY requested_until DESC LIMIT 1`, { accountId }),
      this.query(`SELECT status,error_kind,started_at FROM ${this.table('sync_runs')}
        WHERE account_id=@accountId AND started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
        ORDER BY started_at DESC LIMIT 1`, { accountId }),
    ]);
    const account = accounts[0]; const metric = metrics[0]; const run = runs[0];
    const reach: ReachObservation | null = metric ? {
      name: 'reach', period: 'day', metricType: 'total_value', unit: 'accounts',
      value: typeof metric.value === 'number' ? metric.value : null,
      status: metric.value_status, requestedSince: timestamp(metric.requested_since)!,
      requestedUntil: timestamp(metric.requested_until)!, providerSince: timestamp(metric.provider_since), providerUntil: timestamp(metric.provider_until),
    } : null;
    let state: InstagramSummary['state'] = metric ? 'available' : 'empty';
    if (run?.status === 'not_configured') state = 'not_configured';
    else if (account?.connection_state === 'reconnect_required' || run?.status === 'reconnect_required') state = 'reconnect_required';
    else if (account?.connection_state === 'permission_missing') state = 'permission_missing';
    else if (run?.status === 'permission_missing') state = 'permission_missing';
    else if (run?.status === 'running') state = 'sync_in_progress';
    else if (run?.status === 'failed') state = 'sync_failed';
    else if (metric && Date.now() - new Date(timestamp(metric.fetched_at)!).getTime() > 36 * 3_600_000) state = 'stale';
    return { state, username: account?.username || null, reach,
      lastSuccessfulSync: timestamp(account?.last_success_at), lastAttempt: timestamp(account?.last_attempt_at) || timestamp(run?.started_at),
      lastErrorKind: typeof run?.error_kind === 'string' ? run.error_kind : null };
  }
}
