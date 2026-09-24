import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AgentCapabilityAnalyticsPanel } from '../src/components/AgentCapabilityAnalyticsPanel';

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
console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), target: 'One agent feature table', checks: ['gmail distinct stages', 'finance distinct import steps', 'identified-account and device units separated', 'outcome columns shown consistently'] }, null, 2));
