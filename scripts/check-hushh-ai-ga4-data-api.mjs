#!/usr/bin/env node
import { GoogleAuth, Impersonated } from 'google-auth-library';

const DEFAULT_PROPERTY_ID = '458078330';
const DEFAULT_MEASUREMENT_ID = 'G-PPEF1CSJ5H';
const DEFAULT_IMPERSONATE_SERVICE_ACCOUNT = '646258530541-compute@developer.gserviceaccount.com';

function parseArgs(argv) {
  const options = {
    propertyId: process.env.HUSHH_AI_GA4_PROPERTY_ID || DEFAULT_PROPERTY_ID,
    measurementId: process.env.HUSHH_AI_GA4_MEASUREMENT_ID || DEFAULT_MEASUREMENT_ID,
    impersonateServiceAccount:
      process.env.HUSHH_AI_GA4_IMPERSONATE_SERVICE_ACCOUNT || DEFAULT_IMPERSONATE_SERVICE_ACCOUNT,
    startDate: '7daysAgo',
    endDate: 'today',
    timeoutMs: 30_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--property-id' && argv[index + 1]) {
      options.propertyId = argv[index + 1];
      index += 1;
    } else if (arg === '--measurement-id' && argv[index + 1]) {
      options.measurementId = argv[index + 1];
      index += 1;
    } else if (arg === '--impersonate-service-account' && argv[index + 1]) {
      options.impersonateServiceAccount = argv[index + 1];
      index += 1;
    } else if (arg === '--no-impersonation') {
      options.impersonateServiceAccount = '';
    } else if (arg === '--start-date' && argv[index + 1]) {
      options.startDate = argv[index + 1];
      index += 1;
    } else if (arg === '--end-date' && argv[index + 1]) {
      options.endDate = argv[index + 1];
      index += 1;
    } else if (arg === '--timeout-ms' && argv[index + 1]) {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) options.timeoutMs = parsed;
      index += 1;
    }
  }

  return options;
}

function classifyRejection(status, contentType, text) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (/<\/?(html|head|body|script|style|title|table|font|div|p|h1)\b/i.test(compact) || /html/i.test(contentType)) {
    return 'html-rejection';
  }
  if (/permission|denied|forbidden|unauthorized|insufficient|403|401/i.test(compact) || status === 401 || status === 403) {
    return 'property-access-denied';
  }
  if (/not\s*found|404/i.test(compact) || status === 404) {
    return 'property-not-found';
  }
  if (/invalid|malformed/i.test(compact) || status === 400) {
    return 'invalid-request-or-property';
  }
  return status >= 200 && status < 300 ? 'ok' : 'data-api-rejected';
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ga4Client(impersonateServiceAccount) {
  const { scopes, targetScopes } = impersonateServiceAccount
    ? {
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      targetScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    }
    : {
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      targetScopes: [],
    };
  const auth = new GoogleAuth({ scopes });
  const sourceClient = await auth.getClient();
  if (!impersonateServiceAccount) return sourceClient;

  return new Impersonated({
    sourceClient,
    targetPrincipal: impersonateServiceAccount,
    targetScopes,
    lifetime: 3600,
  });
}

async function runRequest(client, request, timeoutMs) {
  const response = await client.request({
    url: request.url,
    method: 'POST',
    data: request.body,
    validateStatus: () => true,
    responseType: 'text',
    timeout: timeoutMs,
  });
  const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  const contentType = String(response.headers?.['content-type'] || '');
  const classification = classifyRejection(Number(response.status), contentType, text);
  return {
    name: request.name,
    status: Number(response.status),
    returnedJson: /^\s*[{[]/.test(text),
    classification,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assert(/^\d+$/.test(options.propertyId), 'HUSHH_AI_GA4_PROPERTY_ID must be the numeric GA4 property ID, not the measurement ID.');
  assert(/^G-[A-Z0-9]+$/.test(options.measurementId), 'HUSHH_AI_GA4_MEASUREMENT_ID must look like a GA4 web measurement ID.');

  const client = await ga4Client(options.impersonateServiceAccount);
  const baseUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${options.propertyId}`;
  const coreMetrics = [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'eventCount' }];
  const requests = [
    {
      name: 'selectedTotal',
      url: `${baseUrl}:runReport`,
      body: {
        dateRanges: [{ startDate: options.startDate, endDate: options.endDate }],
        metrics: coreMetrics,
      },
    },
    {
      name: 'selectedDaily',
      url: `${baseUrl}:runReport`,
      body: {
        dateRanges: [{ startDate: options.startDate, endDate: options.endDate }],
        dimensions: [{ name: 'date' }],
        metrics: coreMetrics,
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      },
    },
    {
      name: 'lastDayAggregate',
      url: `${baseUrl}:runReport`,
      body: {
        dateRanges: [{ startDate: 'yesterday', endDate: 'today' }],
        metrics: coreMetrics,
      },
    },
    {
      name: 'last7Totals',
      url: `${baseUrl}:runReport`,
      body: {
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        metrics: coreMetrics,
      },
    },
    {
      name: 'topEvents',
      url: `${baseUrl}:runReport`,
      body: {
        dateRanges: [{ startDate: options.startDate, endDate: options.endDate }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: '20',
      },
    },
    {
      name: 'topPages',
      url: `${baseUrl}:runReport`,
      body: {
        dateRanges: [{ startDate: options.startDate, endDate: options.endDate }],
        dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'eventCount' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: '20',
      },
    },
    {
      name: 'sessionChannels',
      url: `${baseUrl}:runReport`,
      body: {
        dateRanges: [{ startDate: options.startDate, endDate: options.endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'newUsers' },
          { name: 'engagedSessions' },
          { name: 'averageSessionDuration' },
          { name: 'eventCount' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '12',
      },
    },
    {
      name: 'sessionSourceMedium',
      url: `${baseUrl}:runReport`,
      body: {
        dateRanges: [{ startDate: options.startDate, endDate: options.endDate }],
        dimensions: [{ name: 'sessionSourceMedium' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'newUsers' },
          { name: 'engagedSessions' },
          { name: 'averageSessionDuration' },
          { name: 'eventCount' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '12',
      },
    },
    {
      name: 'landingPages',
      url: `${baseUrl}:runReport`,
      body: {
        dateRanges: [{ startDate: options.startDate, endDate: options.endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'landingPage' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagedSessions' }, { name: 'eventCount' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '15',
      },
    },
    {
      name: 'geoDevice',
      url: `${baseUrl}:runReport`,
      body: {
        dateRanges: [{ startDate: options.startDate, endDate: options.endDate }],
        dimensions: [{ name: 'platform' }, { name: 'deviceCategory' }, { name: 'country' }],
        metrics: [{ name: 'eventCount' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: '20',
      },
    },
    {
      name: 'sessionTimingHourly',
      url: `${baseUrl}:runReport`,
      body: {
        dateRanges: [{ startDate: options.startDate, endDate: options.endDate }],
        dimensions: [{ name: 'dateHour' }],
        metrics: [
          { name: 'sessions' },
          { name: 'engagedSessions' },
          { name: 'averageSessionDuration' },
          { name: 'eventCount' },
          { name: 'activeUsers' },
        ],
        orderBys: [{ dimension: { dimensionName: 'dateHour' } }],
        limit: '2400',
      },
    },
    {
      name: 'hourOfDay',
      url: `${baseUrl}:runReport`,
      body: {
        dateRanges: [{ startDate: options.startDate, endDate: options.endDate }],
        dimensions: [{ name: 'hour' }],
        metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'eventCount' }, { name: 'activeUsers' }],
        orderBys: [{ dimension: { dimensionName: 'hour' } }],
        limit: '24',
      },
    },
    {
      name: 'realtime',
      url: `${baseUrl}:runRealtimeReport`,
      body: {
        minuteRanges: [{ name: 'last_30_minutes', startMinutesAgo: 29, endMinutesAgo: 0 }],
        metrics: [{ name: 'activeUsers' }, { name: 'eventCount' }],
        limit: '1',
      },
    },
  ];

  const results = [];
  for (const request of requests) {
    results.push(await runRequest(client, request, options.timeoutMs));
  }

  const ok = results.every((result) => result.status >= 200 && result.status < 300 && result.returnedJson);
  const output = {
    ok,
    checkedAt: new Date().toISOString(),
    propertyId: options.propertyId,
    measurementId: options.measurementId,
    range: { startDate: options.startDate, endDate: options.endDate },
    impersonation: options.impersonateServiceAccount ? 'enabled' : 'disabled',
    impersonateServiceAccount: options.impersonateServiceAccount || null,
    runtimeIdentityRequiredAccess: options.impersonateServiceAccount
      ? `${options.impersonateServiceAccount} needs GA4 property Viewer or Analyst access; metrics-dashboard-runtime also needs serviceAccountTokenCreator on it.`
      : 'The active runtime identity needs GA4 property Viewer or Analyst access.',
    results,
  };

  console.log(JSON.stringify(output, null, 2));
  if (!ok) process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({
    ok: false,
    checkedAt: new Date().toISOString(),
    errorClass: classifyRejection(0, '', message),
    remediation: 'Verify HUSHH_AI_GA4_PROPERTY_ID is numeric, then grant GA4 property Viewer or Analyst to the configured metrics runtime identity.',
  }, null, 2));
  process.exit(1);
});
