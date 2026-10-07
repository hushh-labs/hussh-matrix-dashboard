import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AgentCapabilityAnalyticsPanel } from '../src/components/AgentCapabilityAnalyticsPanel';
import { OneLocationAnalyticsPanel } from '../src/components/OneLocationAnalyticsPanel';
import { FeatureUserBreakdownPanel } from '../src/components/FeatureUserBreakdownPanel';
import type { OneAppSummary } from '../src/lib/types';

function render(capabilityKey: string): string {
  return renderToStaticMarkup(createElement(AgentCapabilityAnalyticsPanel, {
    capabilityKey,
    one: null,
    uat: null,
    rangeLabel: 'Last 30 days',
    dateControl: null,
    onBack: () => undefined,
  }));
}

const gmail = render('gmail');
const finance = render('finance');
const location = render('location');
assert.match(gmail, /Connection attempts/);
assert.match(gmail, /Gmail connection results/);
assert.match(gmail, /Sync requests/);
assert.match(gmail, /Sync queue results/);
assert.match(gmail, /Sync processing results/);
assert.match(gmail, /Mail sign-in screen views/);
assert.match(finance, /Import parsing results/);
assert.match(finance, /Import saving results/);
for (const key of ['location', 'finance', 'consent', 'gmail', 'ria', 'marketplace', 'memory', 'wallet', 'calendar', 'kyc', 'connected_systems', 'onboarding']) {
  const page = render(key);
  assert.match(page, /<th[^>]*>Devices \/ browsers<\/th>/);
  assert.match(page, /<th[^>]*>Times recorded<\/th>/);
  assert.match(page, /View details/);
  assert.match(page, /How to read these KPIs/);
  assert.doesNotMatch(page, /<th[^>]*>(Successful|Failed|Event name)<\/th>/);
}
assert.match(location, /Shared location views/);
assert.match(location, /One device opening a shared location five times/);

const summary = {
  available: true, capabilitiesAvailable: true, locationBehaviorAvailable: true, featureUsageAvailable: true,
  range: { startDate: '2026-09-08', endDate: '2026-10-07', days: 30 },
  capabilities: [{ key: 'location', instrumented: true, observed: true, devices: 12, accounts: 12, deliberateEvents: 6678 }],
  daily: [],
  locationAnalytics: {
    journeyActionSeen: true, journey: [], circleKinds: [], platforms: [],
    features: [
      { key: 'live_sharing', label: 'Sharing confirmations', instrumented: true, users: 6, events: 25, successes: 25, expectedErrors: 0, failures: 0, daily: [] },
      { key: 'location_viewed', label: 'Shared location views', instrumented: true, users: 11, events: 6653, successes: 6653, expectedErrors: 0, failures: 0, daily: [] },
    ],
  },
  featureUsage: {},
} as unknown as OneAppSummary;
function renderLocation(one: OneAppSummary) {
  return renderToStaticMarkup(createElement(OneLocationAnalyticsPanel, {
    one, uat: null, environment: 'production', tab: 'features', rangeLabel: 'Last 30 days', dateControl: null,
    onBack: () => {}, onEnvironmentChange: () => {}, onTabChange: () => {},
  }));
}
const measuredLocation = renderLocation(summary);
assert.match(measuredLocation, /6,653 records from 11 device\/browser IDs/);
assert.match(measuredLocation, /25 records from 6 device\/browser IDs/);
assert.doesNotMatch(measuredLocation, /604\.8/); // The average belongs in the optional details.
assert.doesNotMatch(measuredLocation, /Non-error share|100%/);
assert.match(renderLocation({ ...summary, locationBehaviorAvailable: false }), /Data unavailable/);
const detail = renderToStaticMarkup(createElement(FeatureUserBreakdownPanel, {
  featureLabel: 'Shared location views', totalDevices: 11, totalEvents: 6653,
  successes: 6650, expectedErrors: 1, failures: 1,
}));
assert.match(detail, /604\.8/);
assert.match(detail, /Results at this step/);
assert.match(detail, /Result not reported/);
assert.match(detail, /Technical details/);
console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), target: 'One team KPI view', checks: ['all 12 agents use the same simple units', 'separate views and confirmations', 'stages retain distinct labels', 'averages and results remain in details', 'unavailable data is explicit'] }, null, 2));
