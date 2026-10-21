#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { oneAccountSummaryIssues } from '../src/server/one-account-scope.mjs';
import { tsImport } from 'tsx/esm/api';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
};

const dashboardUrl = option(
  '--dashboard-url',
  process.env.METRICS_DASHBOARD_URL || 'https://metrics.hussh.ai',
).replace(/\/$/, '');
const projectIds = {
  production: option('--production-firebase-project', option('--firebase-project', process.env.ONE_PROD_FIREBASE_AUTH_PROJECT || process.env.ONE_FIREBASE_AUTH_PROJECT || 'hushh-pda')),
  uat: option('--uat-firebase-project', process.env.ONE_UAT_FIREBASE_AUTH_PROJECT || 'hushh-pda-uat'),
};
const days = Math.max(1, Math.min(Number(option('--days', '30')) || 30, 90));
const timeoutMs = Number(option('--timeout-ms', '120000'));

const end = new Date();
end.setUTCHours(0, 0, 0, 0);
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - (days - 1));
const startDate = start.toISOString().slice(0, 10);
const endDate = end.toISOString().slice(0, 10);

async function authoritativeCounts(projectId) {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const seen = new Set();
  let newAccounts = 0;
  let accountsCreatedByRangeEnd = 0;
  let disabledAccounts = 0;
  let nextPageToken = '';
  let previousPageToken = '';
  let pages = 0;

  do {
    const response = await client.request({
      url: `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:batchGet`,
      method: 'GET',
      params: {
        maxResults: 1000,
        ...(nextPageToken ? { nextPageToken } : {}),
      },
      timeout: timeoutMs,
    });
    for (const account of response.data?.users || []) {
      const accountId = typeof account.localId === 'string' ? account.localId : '';
      if (!accountId || seen.has(accountId)) continue;
      seen.add(accountId);
      if (account.disabled === true) disabledAccounts += 1;
      const createdAtMs = Number(account.createdAt);
      if (!Number.isFinite(createdAtMs) || createdAtMs < 0) continue;
      const createdDate = new Date(createdAtMs).toISOString().slice(0, 10);
      if (createdDate <= endDate) accountsCreatedByRangeEnd += 1;
      if (createdDate >= startDate && createdDate <= endDate) newAccounts += 1;
    }
    previousPageToken = nextPageToken;
    nextPageToken = typeof response.data?.nextPageToken === 'string' ? response.data.nextPageToken : '';
    pages += 1;
    if (nextPageToken && nextPageToken === previousPageToken) throw new Error('Repeated Identity Toolkit page token');
    if (pages > 10_000) throw new Error('Identity Toolkit pagination exceeded the safety limit');
  } while (nextPageToken);

  return {
    totalAccounts: seen.size,
    newAccounts,
    accountsCreatedByRangeEnd,
    disabledAccounts,
  };
}

async function dashboardCounts() {
  const url = new URL('/api/analytics/one/app', dashboardUrl);
  url.searchParams.set('one_start_date', startDate);
  url.searchParams.set('one_end_date', endDate);
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Dashboard returned HTTP ${response.status}`);
  const body = await response.json();
  return {
    production: body?.data?.production?.registeredAccounts,
    uat: body?.data?.uat?.registeredAccounts,
  };
}

const dashboard = await dashboardCounts();
const sources = {};
const fields = ['totalAccounts', 'newAccounts', 'accountsCreatedByRangeEnd', 'disabledAccounts'];
const failures = [];
for (const environment of ['production', 'uat']) {
  const reported = dashboard[environment];
  failures.push(...oneAccountSummaryIssues(reported, environment).map(issue => `${environment}: ${issue}`));
  if (reported?.available !== true) {
    if (args.includes('--require-isolated')) failures.push(`${environment}: verified isolated registry is required for cutover`);
    continue;
  }
  if (projectIds.production === projectIds.uat || reported.identityAuthorityId !== `sha256:${createHash('sha256').update(projectIds[environment]).digest('hex')}`) {
    failures.push(`${environment}: registry authority does not match the independent source`);
    continue;
  }
  const source = reported.registryScope === 'production_contacts'
    ? await (async () => {
      // Use the private signed membership authority, never compare a customer
      // subset against the unfiltered Firebase account registry.
      const { readCustomerCohort, customerAccountCounts } = await tsImport('../src/server/one-customer-cohort.ts', import.meta.url);
      return customerAccountCounts(await readCustomerCohort(), { startDate, endDate });
    })()
    : await authoritativeCounts(projectIds[environment]);
  sources[environment] = source;
  for (const field of fields) {
    if (Number(reported[field]) !== Number(source[field])) {
      failures.push(`${environment}.${field}: dashboard=${reported[field]}, source=${source[field]}`);
    }
  }
}

const report = {
  ok: failures.length === 0,
  checkedAt: new Date().toISOString(),
  dashboardUrl,
  range: { startDate, endDate, days },
  authoritative: sources,
  cutoverReady: Object.keys(sources).length === 2 && failures.length === 0,
  note: 'Withheld legacy/unconfigured registries can satisfy containment; --require-isolated is mandatory before declaring the identity cutover complete.',
  dashboard: {
    production: Object.fromEntries(fields.map((field) => [field, dashboard.production?.[field] ?? null])),
    uat: Object.fromEntries(fields.map((field) => [field, dashboard.uat?.[field] ?? null])),
  },
  privacy: 'Only aggregate counts are emitted; account records and identifiers are not logged.',
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
