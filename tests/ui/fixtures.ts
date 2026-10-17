/** Synthetic aggregate data used only by intercepted browser-test requests. Never imported by src/. */
import type { Page } from '@playwright/test';
import type { AllAnalyticsResponse } from '../../src/lib/analytics-service';
import type { FounderBriefingData } from '../../src/lib/founder-briefing';
import type { GrowthSummary, OneAppSummary, KaiGa4Summary, ProductSourceCard } from '../../src/lib/types';

const day = (offset: number) => new Date(Date.now() - (offset + 3) * 86_400_000).toISOString().slice(0, 10);
const timestamp = new Date().toISOString();
const range = { startDate: day(29), endDate: day(0), days: 30 };
const daily = Array.from({ length: 30 }, (_, index) => ({ eventDate: day(29 - index), users: 38 + index * 3 + index % 4 * 7, locationUsers: 12 + index, events: 180 + index * 12 }));
const measure = (current: number | null, previous: number | null) => ({ current, previous });
const capabilityKeys = ['location', 'finance', 'consent', 'gmail', 'ria', 'marketplace', 'memory', 'wallet', 'calendar', 'kyc', 'connected_systems'];
const capabilityLabels = ['Location', 'Finance', 'Consent', 'Gmail', 'Advisor', 'Marketplace', 'Memory', 'Wallet', 'Calendar', 'KYC', 'Connected systems'];

export const founder: FounderBriefingData = {
  generatedAt: timestamp, period: range,
  previousPeriod: { startDate: day(59), endDate: day(30), days: 30 },
  one: {
    available: true, comparisonReady: true, interactionComparisonReady: true,
    identityObservedSince: '2026-05-01', latestEventDate: day(0),
    activeAccounts: measure(1284, 1102), firstObservedAccounts: measure(346, 297),
    activatedAccounts: measure(852, 710), agentEngagedAccounts: measure(948, 823),
    accountCoverage: .94, hasNativeEnvironmentConflict: false,
    platforms: ['IOS', 'ANDROID', 'WEB'].map((key, index) => ({
      key, label: ['iOS app', 'Android app', 'Web app'][index], captureState: 'observed',
      identifiedAccounts: measure([738, 316, 482][index], [641, 272, 411][index]), identityCoverage: .94,
      trackedIdentifiers: 900, boundIdentifiers: 846, signInIdentifiers: 400, signedInBoundIdentifiers: 390,
      previousTrackedIdentifiers: 800, previousBoundIdentifiers: 752, previousSignInIdentifiers: 350, previousSignedInBoundIdentifiers: 340,
    })) as FounderBriefingData['one']['platforms'],
    agents: capabilityKeys.map((key, index) => ({
      key, label: capabilityLabels[index], instrumented: true, note: null,
      identifiedAccounts: measure(320 - index * 21, 290 - index * 20), successfulAccounts: measure(280 - index * 19, 250 - index * 18),
      interactions: measure(2100 - index * 160, 1700 - index * 130), successes: measure(1980 - index * 150, 1600 - index * 120),
      expectedErrors: measure(18, 22), failures: measure(2, 3), outcomeSignals: measure(2000 - index * 150, 1625 - index * 120),
      iosInteractions: 1200 - index * 90, androidInteractions: 400 - index * 30, webInteractions: 500 - index * 40,
    })),
    daily: daily.map((item, index) => ({ day: item.eventDate, activeAccounts: item.users, previousActiveAccounts: item.users - 12 - index % 3, agentInteractions: item.events, previousAgentInteractions: item.events - 35 })),
  },
  search: { available: true, clicks: measure(2860, 2410), impressions: measure(38640, 32400), latestDataDate: day(0) },
};

export const one: OneAppSummary = {
  sourceLabel: 'Synthetic QA aggregate', sourceWebHost: 'one.hushh.ai', generatedAt: timestamp,
  available: true, windowDays: 30, range, rangeTotals: { users: 1460, sessions: 6230, events: 38400 },
  last24Hours: { users: 164, sessions: 420, events: 2300, available: true },
  activation: { activatedUsers: 852, sharingUsers: 648 },
  funnel: ['Opened One', 'Signed in', 'Used a feature'].map((label, index) => ({ step: label, label, users: [1460, 1284, 948][index], conversionFromPrevious: index ? .8 : null, dropoffFromPrevious: index ? .2 : null })),
  activeUsers: { countingUnit: 'device', identityScope: 'QA device aggregates.', dau: 164, wau: 780, mau: 1460, stickiness: .112, asOf: day(0) },
  identifiedUsers: { countingUnit: 'account', identityScope: 'QA identified accounts.',
    selectedRange: { available: true, totalUsers: 1284, newUsers: 346, returningUsers: 938, ...range, newUserDefinition: 'First observed in analytics.' },
    dau: 148, wau: 704, mau: 1284, identifiedDevices: { dau: 154, wau: 742, mau: 1372 }, deviceCoverage: { dau: .94, wau: .95, mau: .94 }, complete: true, asOf: day(0) },
  iosIdentifiedUsers: { available: true, countingUnit: 'account', bundleId: 'com.hushh.app', totalUsers: 738, firstObservedUsers: 188, previouslyObservedUsers: 550, identityObservedSince: '2026-05-01', ...range, note: 'QA aggregate' },
  registeredAccounts: { available: true, sourceLabel: 'Synthetic QA accounts', identityRealm: 'qa', sharedAcrossEnvironments: true, countingUnit: 'account', deduplication: 'Stable account',
    totalAccounts: 8420, newAccounts: 412, accountsCreatedByRangeEnd: 8420, disabledAccounts: 3, ...range, generatedAt: timestamp, daily: daily.map(item => ({ date: item.eventDate, newAccounts: 12 })), note: 'Synthetic QA fixture' },
  activeByPlatformAvailable: true,
  activeByPlatform: ['IOS', 'ANDROID', 'WEB'].map((platform, index) => ({ platform, dauDevices: 90 - index * 20, wauDevices: 400 - index * 80, mauDevices: 800 - index * 140,
    accounts: 738 - index * 160, dauAccounts: 82 - index * 18, wauAccounts: 370 - index * 72, mauAccounts: 738 - index * 160, signedInShare: .94, identityBound: true })),
  installFunnel: ['IOS', 'ANDROID'].map(platform => ({ platform, installed: 600, retentionWindowComplete: true,
    stages: ['installed', 'tried_sign_in', 'signed_in', 'activated', 'returned_w1'].map((key, index) => ({ key, label: ['First opened the app', 'Tried to sign in', 'Signed in', 'Used a feature', 'Returned in week 1'][index], users: [600, 520, 480, 310, 240][index], shareOfInstalls: [1, .867, .8, .517, .4][index] })) })),
  growth: { newUsers: 346, returningUsers: 938, unknownUsers: 176 },
  retention: Array.from({ length: 6 }, (_, index) => ({ cohortWeek: day(49 - index * 7), cohortSize: 100 + index * 10, returnedW1: 40 + index * 4, rateW1: .4, windowComplete: true, state: 'available' })),
  retentionAvailable: true, activationStages: [{ key: 'started', label: 'Started', users: 1460 }, { key: 'activated', label: 'Activated', users: 852 }],
  capabilitiesAvailable: true,
  capabilityDailyAvailable: true,
  capabilities: capabilityKeys.map((key, index) => ({ key, label: capabilityLabels[index], instrumented: true, observed: true, note: null,
    accounts: 320 - index * 21, devices: 380 - index * 25, deliberateEvents: 2100 - index * 160, totalUsers: 400 - index * 26, totalEvents: 2400 - index * 170,
    daily: daily.map(item => ({ eventDate: item.eventDate, users: Math.max(1, item.users - index * 2) })) })),
  surfaces: [{ surface: 'One', host: 'one.hushh.ai', users: 1460 }],
  androidCapture: { state: 'observed', packageId: 'com.hussh.app', source: 'QA aggregate', reportingTimezone: 'UTC', ...range, observedSince: '2026-05-01', latestEventAt: timestamp,
    events: 7000, activeAppIds: 380, identifiedAccounts: 316, firstOpens: 140, routeVisits: 2800, releases: [], note: 'Synthetic QA Android aggregate.' },
  locationFeatures: [{ eventName: 'location_sharing_started', users: 210, events: 840 }], locationBehaviorAvailable: true,
  locationAnalytics: {
    instrumentationStartedAt: '2026-05-01', journeyActionSeen: true, instrumentationNote: 'QA aggregate fixture',
    features: ['live_sharing', 'check_in', 'request_location', 'create_circle', 'contacts_sync', 'sms_safety'].map((key, index) => ({ key, label: ['Live sharing', 'Check in', 'Request location', 'Create circle', 'Contacts sync', 'SMS safety'][index], instrumented: true, users: 210 - index * 20, events: 840 - index * 60, successes: 790 - index * 60, expectedErrors: 8, failures: 2,
      daily: daily.map(item => ({ eventDate: item.eventDate, users: item.locationUsers, events: item.locationUsers * 3 })) })),
    journey: ['opened', 'permission_granted', 'circle_created', 'sharing_started'].map((key, index) => ({ key, label: ['Opened Location', 'Allowed location', 'Created a circle', 'Started sharing'][index], instrumented: true, observed: true, users: 300 - index * 50, events: 900 - index * 100, successes: 850 - index * 100, failures: 2 })),
    circleKinds: [{ kind: 'family', label: 'Family', creators: 82, circlesCreated: 96 }, { kind: 'friends', label: 'Friends', creators: 64, circlesCreated: 78 }],
    platforms: ['IOS', 'ANDROID', 'WEB'].map(platform => ({ platform, feature: 'live_sharing', users: 70, events: 280 })),
  },
  featureUsageAvailable: true,
  featureUsage: Object.fromEntries(['location_live_sharing', 'live_sharing', 'finance_portfolio', 'portfolio_viewed'].map(key => [key, { accounts: 210, devices: 230, signals: 840, successes: 790, expectedErrors: 8, failures: 2, outcomeSignals: 800, eventBreakdown: [] }])),
  platformsAvailable: true,
  platforms: ['IOS', 'ANDROID', 'WEB'].map((platform, index) => ({ platform, users: 800 - index * 140, events: 14000 - index * 2000, activeDeviceIds: 800 - index * 140,
    activeAccounts: 738 - index * 160, routeVisits: 5200 - index * 1000, namedRouteVisits: 5000 - index * 1000, distinctScreens: 12, topProductScreens: [{ routeId: 'one_dashboard', visits: 1200 }] })),
  acquisition: [{ source: 'google', medium: 'organic', users: 620 }, { source: 'direct', medium: 'none', users: 540 }],
  daily, reliability: { locationRetries: 12, locationRetryUsers: 5, retriesPerAffectedUser: 2.4 },
};

export const growth: GrowthSummary = {
  generatedAt: timestamp, range,
  users: { series: Array.from({ length: 12 }, (_, index) => ({ week: day(77 - index * 7), newUsers: 35 + index * 6, cumulative: 400 + index * 73 })), totalEverSeen: 1460, note: 'Synthetic QA device aggregate.',
    window: { ...range, newUsers: 346, priorStartDate: day(59), priorEndDate: day(30), priorNewUsers: 297 } },
  identity: { devices: 1460, accounts: 1284, identifiedDevices: 1372, windowDays: 30, coverage: .94, byPlatform: ['IOS', 'ANDROID', 'WEB'].map(platform => ({ platform, devices: 500, accounts: 420, identifiedDevices: 470 })) },
  crossProduct: { siteVisitors: 4200, appWebVisitors: 1460, siteThenApp: 620, conversionRate: .148, note: 'Same-device QA journeys.' },
  timeToFirstValue: { activatedUsers: 852, medianMinutes: 8, fastestMinutes: 1, slowestMinutes: 180,
    distribution: [{ bucket: '< 5 min', users: 380 }, { bucket: '5–30 min', users: 290 }, { bucket: '30+ min', users: 182 }] },
  cost: { total: 842, production: 620, nonProduction: 180, unattributed: 42, available: true,
    byProduct: [{ key: 'one', product: 'One app', production: 320, nonProduction: 100 }, { key: 'hushh_ai', product: 'Hushh AI', production: 300, nonProduction: 80 }] },
  organicSearch: { available: true, clicks: 2860, impressions: 38640, ctr: .074, avgPosition: 12.4, latestDay: day(0), series: Array.from({ length: 12 }, (_, index) => ({ week: day(77 - index * 7), clicks: 140 + index * 25, impressions: 2000 + index * 300 })) },
  instrumentation: { governedEvents: 38400, ungovernedEvents: 120, distinctEvents: 42, ungovernedEventNames: 2, declaredNotEmitted: [] },
};

const feedRows = daily.map(item => ({ as_of_timestamp: timestamp, source_environment: 'production', source_project_id: 'qa', source_dataset: 'qa', production_ready: true, known_blockers: null,
  metric_group: 'usage', metric_name: 'daily_active_users', metric_date: item.eventDate, dimension_name: null, dimension_value: null, metric_value: item.users, metric_count: item.users, metric_string_value: null, metric_timestamp: null }));

const ga4: KaiGa4Summary = {
  available: true, sourceLabel: 'Synthetic QA GA4', generatedAt: timestamp, windowDays: 30, range,
  rangeTotals: { users: 1460, sessions: 6230, events: 38400, engagedSessions: 4700, engagementRate: .75, averageSessionDuration: 164 },
  daily: daily.map(item => ({ ...item, sessions: item.users * 3, engagedSessions: item.users * 2, averageSessionDuration: 164, engagementRate: .75 })),
  topEvents: [{ eventName: 'page_view', users: 1460, events: 12000 }, { eventName: 'feature_used', users: 948, events: 7600 }],
  topPages: [{ path: '/', title: 'Home', views: 4200, users: 900, events: 5300 }, { path: '/dashboard', title: 'Dashboard', views: 3100, users: 780, events: 3900 }],
  geo: [{ platform: 'WEB', deviceCategory: 'desktop', country: 'India', events: 18000, users: 720 }],
  acquisition: { sessionChannels: [{ channel: 'Organic Search', sessions: 2800, users: 740, events: 14000 }, { channel: 'Direct', sessions: 2100, users: 610, events: 11000 }],
    sessionSourceMedium: [{ sourceMedium: 'google / organic', sessions: 2800, users: 740, events: 14000 }],
    landingPages: [{ landingPage: '/', sessions: 2200, users: 640, events: 9000 }], geoDevice: [{ country: 'India', deviceCategory: 'desktop', sessions: 2800, users: 720, events: 18000 }] },
  sessionTiming: { timezoneLabel: 'UTC', hourOfDay: [{ hour: '12', label: '12:00', sessions: 580, events: 2800, users: 220 }] },
};
const gcp = { sourceProjectId: 'qa', serviceName: 'qa', generatedAt: timestamp, windowDays: 30, ...range,
  requestCount: 28400, errorCount: 12, errorRate: .0004, p95LatencyMs: 240, instanceCount: 2,
  series: daily.map(item => ({ label: item.eventDate, value: item.users * 12 })),
  daily: daily.map(item => ({ date: item.eventDate, label: item.eventDate.slice(5), requests: item.users * 12, errors: 1, errorRate: .001, p95LatencyMs: 240, instanceCount: 2 })) };
const sourceCard: ProductSourceCard = { key: 'ga4', label: 'Product analytics', status: 'live', source: 'Synthetic QA aggregates', freshness: { generatedAt: timestamp, expectedLagSeconds: 7200 },
  metrics: [{ key: 'users', label: 'Users', value: 1460 }, { key: 'sessions', label: 'Sessions', value: 6230 }] };
const status = { sourceEnvironment: 'production', sourceProjectId: 'qa', sourceDataset: 'qa', productionReady: true, knownBlockers: null, latestEventAt: timestamp, freshnessLagMinutes: 10, sourceEventRows: 38400 };

export const allAnalytics = {
  kai: { uat: { environment: 'uat', rows: [] }, production: { environment: 'production', rows: feedRows }, ga4: { platform: 'One UAT', data: ga4 },
    productionProduct: { platform: 'One', data: { productionFeed: { status }, uatFeed: { status: { ...status, sourceEnvironment: 'uat' } }, uatGa4: ga4, productionGa4: ga4, gcp, sourceCards: [sourceCard], uatSourceCards: [sourceCard] } } },
  hushhAi: { platform: 'hushh.ai', data: { ga4, gcp, searchConsole: null, sourceCards: [sourceCard] } }, hushhTech: { platform: 'hushhtech.com', data: null },
  one: { platform: 'One', data: { production: one, uat: { ...one, sourceWebHost: 'uat.one.hushh.ai' } } },
  growth: { platform: 'All products', data: growth }, fetchedAt: timestamp,
  appStoreConnect: { platform: 'iOS', data: {
    appAppleId: 'qa', production: { available: false, note: 'QA provider waiting state', metrics: null },
    testflight: { available: false, note: 'QA provider waiting state', metrics: null },
  } },
} as unknown as AllAnalyticsResponse;

export async function mockDashboard(page: Page) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/auth/me') data = { authenticated: true, user: { email: 'qa@example.invalid', name: 'QA reviewer', domainAuthorized: true } };
    else if (path === '/api/analytics/founder') data = founder;
    else if (path === '/api/analytics/all') data = allAnalytics;
    else if (path === '/api/analytics/growth/compare') data = { fetchedAt: timestamp, error: null, windows: ['30d', '90d', 'all'].map((key, index) => ({ key, label: ['Last 30 days', 'Last 90 days', 'All time'][index], range: { ...range, days: [30, 90, 180][index] }, data: growth, error: null })) };
    else if (path === '/api/analytics/one/android') data = { history: { state: 'permission_missing', daily: [] }, downloads: {}, vitals: { state: 'not_yet_available' } };
    else if (path === '/api/analytics/instagram') data = {
      state: 'available', username: 'qa_company', reach: { value: 3260, status: 'available', requestedSince: day(6), requestedUntil: day(0) },
      followersCount: 2400, mediaCount: 14, countsObservedAt: timestamp,
      lastSuccessfulSync: timestamp, lastAttempt: timestamp, canSync: false,
      inventory: { complete: true, windowSince: day(364), count: 14, scannedAt: timestamp },
      media: Array.from({ length: 14 }, (_, index) => ({ id: `qa-${index}`, mediaType: index % 2 ? 'IMAGE' : 'VIDEO', productType: index % 2 ? 'FEED' : 'REELS', permalink: 'https://www.instagram.com/', publishedAt: `${day(index * 2)}T12:00:00Z`, likeCount: 140 + index * 4, commentsCount: 12 + index, fetchedAt: timestamp,
        insights: Object.fromEntries(['reach', 'views', 'saved', 'shares', 'total_interactions'].map(key => [key, { value: 400 + index * 30, status: 'available' }])) })),
    };
    else return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    await route.fulfill({ json: data, headers: { 'Cache-Control': 'no-store' } });
  });
}
