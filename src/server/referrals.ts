import { GoogleAuth } from 'google-auth-library';
import { Connector } from '@google-cloud/cloud-sql-connector';
import pg from 'pg';
import type { ReferralEnvironment, ReferralQuery, ReferralRankings, ReferralSourcePage } from '../lib/referrals';
import { hydrateReferralNames, referralViewer, type DirectoryAccount, type DirectoryLookup, type ReferralDirectoryPage } from './referral-names';

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

const directoryLookup = (project: string): DirectoryLookup => async criteria => {
  const client = await auth.getClient();
  const response = await client.request<{users?: DirectoryAccount[]}>({
    url: `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(project)}/accounts:lookup`,
    method: 'POST', data: criteria, timeout: 15_000,
  });
  return response.data.users ?? [];
};

async function readSource(environment: ReferralEnvironment, query: ReferralQuery, viewerId: string | null, lookupDirectory: DirectoryLookup): Promise<ReferralSourcePage> {
  const pool = await poolFor(environment);
  const client = await pool.connect();
  let page: ReferralDirectoryPage;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    const result = await client.query('SELECT metrics_dashboard.referral_rankings_for_viewer($1::integer,$2::uuid,$3::text) AS standings', [query.afterRank, query.snapshotId ?? null, viewerId]);
    page = result.rows[0]?.standings as ReferralDirectoryPage | undefined;
    if (!page || !['available', 'waiting', 'expired'].includes(page.state) || !Array.isArray(page.entries)
      || page.entries.length > 20 || !page.entries.every(row => Number.isSafeInteger(row.rank) && row.rank > query.afterRank
        && typeof row.handle === 'string' && Number.isSafeInteger(row.points))) throw new Error('Referral source unavailable');
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error('Referral source unavailable');
  } finally { client.release(); }
  // Do not hold a database connection while Firebase verifies current accounts.
  // Candidate UIDs/cache fields are never passed to the public API.
  return hydrateReferralNames(page, lookupDirectory);
}

export async function resolveReferralRankings(query: ReferralQuery,
  read: (environment: ReferralEnvironment, query: ReferralQuery) => Promise<ReferralSourcePage>): Promise<ReferralRankings> {
  const names: ReferralEnvironment[] = ['production', 'uat'];
  const pages = await Promise.allSettled(names.map(environment => read(environment,
    environment === query.environment ? query : { ...query, afterRank: 0, snapshotId: undefined })));
  const sources = names.map((environment, index) => ({ environment,
    state: pages[index].status === 'fulfilled' ? pages[index].value.state : 'unavailable' as const }));
  const environments = names.filter((_, index) => pages[index].status === 'fulfilled'
    && pages[index].value.state === 'available' && (pages[index].value.entryCount ?? 0) > 0);
  const environment = query.environment ?? environments[0]
    ?? names.find((_, index) => pages[index].status === 'fulfilled') ?? null;
  const selected = environment ? pages[names.indexOf(environment)] : undefined;
  // The app gates circle standings. Never synthesize them from private circles.
  if (query.board === 'circles') return { state: 'preview', board: query.board, environment, environments, sources,
    snapshotId: null, snapshotGeneratedAt: null, entryCount: null, entries: [], nextAfterRank: null };
  if (selected?.status !== 'fulfilled') throw new Error('Referral source unavailable');
  return { ...selected.value, board: query.board, environment, environments, sources };
}

export async function readReferralRankings(query: ReferralQuery, viewerEmail: string, firebaseProject: string): Promise<ReferralRankings> {
  const lookupDirectory = directoryLookup(firebaseProject);
  const viewerId = query.board === 'individual' ? await referralViewer(viewerEmail, lookupDirectory) : null;
  return resolveReferralRankings(query, (environment, scope) => readSource(environment, scope, viewerId, lookupDirectory));
}
