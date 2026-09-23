/** Render the One platform cards against previous/partial API schemas. */
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlatformsAtAGlance } from '../src/components/OneAppPanel';
import type { OneAppSummary } from '../src/lib/types';

const render = (one: Partial<OneAppSummary>, environment: 'production' | 'uat') =>
  renderToStaticMarkup(createElement(PlatformsAtAGlance, {
    one: one as OneAppSummary,
    environment,
  }));

const previousSchema = render({}, 'production');
assert.match(previousSchema, /temporarily unavailable/);
assert.doesNotMatch(previousSchema, /Active signed-in accounts/);

const uat = render({
  sourceWebHost: 'uat.one.hushh.ai',
  platforms: [{
    platform: 'WEB', users: 1, events: 6, activeAccounts: 0,
    activeDeviceIds: 1, routeVisits: 2, namedRouteVisits: 2,
    distinctScreens: 1,
    // A previous API revision did not include topProductScreens.
  } as OneAppSummary['platforms'][number]],
}, 'uat');
assert.match(uat, /uat.one.hushh.ai browsers only/);
assert.match(uat, /Not measurable/);

console.log(JSON.stringify({ ok: true, checks: ['previous-schema', 'missing-screen-ranking', 'uat-source-host', 'anonymous-account-state'] }));
