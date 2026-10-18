import { GoogleAuth } from 'google-auth-library';
import { Connector } from '@google-cloud/cloud-sql-connector';
import pg from 'pg';
import type { ReferralMetrics } from '../lib/referrals';
import { parseReferralQuery } from '../lib/referrals';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const pools = new Map<string, Promise<pg.Pool>>();

async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Referral connection unavailable')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function poolFor(environment: string) {
  if (!pools.has(environment)) {
    const pending = (async () => {
      const client = await auth.getClient();
      const resource = `projects/hushh-ai-prod/secrets/metrics-one-referrals-${environment}/versions/latest`;
      const response = await client.request<{ payload: { data: string } }>({
        url: `https://secretmanager.googleapis.com/v1/${resource}:access`, timeout: 15_000,
      });
      const config = JSON.parse(Buffer.from(response.data.payload.data, 'base64').toString('utf8'));
      const connector = new Connector();
      try {
        const options = await bounded(connector.getOptions({ instanceConnectionName: config.instance }), 20_000);
        const pool = new pg.Pool({ ...options, user: config.user, password: config.password,
          database: config.database, max: 2, connectionTimeoutMillis: 15_000,
          idleTimeoutMillis: 30_000, query_timeout: 20_000, allowExitOnIdle: true });
        // Idle connection errors must not terminate the dashboard process.
        pool.on('error', () => {});
        return pool;
      } catch {
        connector.close();
        throw new Error('Referral connection unavailable');
      }
    })();
    pools.set(environment, pending);
    void pending.catch(() => pools.delete(environment));
  }
  return pools.get(environment)!;
}

export async function readReferralMetrics(query: ReturnType<typeof parseReferralQuery>): Promise<ReferralMetrics> {
  const pool = await poolFor(query.environment);
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    const result = await client.query('SELECT metrics_dashboard.referral_summary($1::date,$2::date) AS summary', [query.startDate, query.endDate]);
    const summary = result.rows[0]?.summary;
    if (!summary?.totals) throw new Error('Referral source unavailable');
    await client.query('COMMIT');
    return { ...summary, environment: query.environment, state: 'available', generatedAt: new Date().toISOString(),
      range: { startDate: query.startDate, endDate: query.endDate, timezone: 'UTC' } };
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error('Referral source unavailable');
  } finally { client.release(); }
}
