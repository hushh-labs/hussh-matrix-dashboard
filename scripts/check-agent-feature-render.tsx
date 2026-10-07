import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AgentCapabilityAnalyticsPanel } from '../src/components/AgentCapabilityAnalyticsPanel';
import { OneLocationAnalyticsPanel } from '../src/components/OneLocationAnalyticsPanel';
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
assert.match(gmail, /Google Account Connection/);
assert.match(gmail, /Sync requests/);
assert.match(gmail, /Sync jobs accepted/);
assert.match(gmail, /Receipt sync completed/);
assert.match(gmail, /Mail sign-in screen views/);
assert.match(gmail, /<th[^>]*>Identified accounts<\/th>/);
assert.match(gmail, /<th[^>]*>Successful<\/th>/);
assert.match(gmail, /<th[^>]*>Canceled \/ no-op<\/th>/);
assert.match(gmail, /<th[^>]*>Failed<\/th>/);
assert.match(finance, /Portfolio import parsed/);
assert.match(finance, /Portfolio import saved/);
assert.match(finance, /<th[^>]*>Identified accounts<\/th>/);
assert.match(finance, /<th[^>]*>Successful<\/th>/);
assert.match(location, /<th[^>]*>Successful<\/th>/);
assert.match(location, /<th[^>]*>Failed<\/th>/);
assert.match(location, /Shared location views/);
assert.match(location, /How these metrics are calculated/);
assert.match(location, /Recorded events/);
assert.match(location, /Events \/ device/);

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
assert.match(measuredLocation, /6,653 recorded events from 11 distinct device\/browser IDs/);
assert.match(measuredLocation, /25 recorded events from 6 distinct device\/browser IDs/);
assert.match(measuredLocation, /604\.8 events per device/);
assert.doesNotMatch(measuredLocation, /Non-error share|100%/);
assert.match(renderLocation({ ...summary, locationBehaviorAvailable: false }), /Source unavailable/);
console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), target: 'One agent feature table', checks: ['gmail distinct stages', 'finance distinct import steps', 'identified-account and device units separated', 'outcome columns shown consistently'] }, null, 2));
