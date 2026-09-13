import assert from 'node:assert/strict';

import {
  locationAnalyticsPath,
  parseLocationAnalyticsPath,
  type LocationAnalyticsRoute,
} from '../src/lib/location-analytics-route';

const productionOverview: LocationAnalyticsRoute = { environment: 'production', tab: 'overview' };

assert.deepEqual(parseLocationAnalyticsPath('/location-analytics'), productionOverview);
assert.deepEqual(parseLocationAnalyticsPath('/location-analytics/'), productionOverview);
assert.deepEqual(parseLocationAnalyticsPath('/location-analytics/production'), productionOverview);
assert.deepEqual(parseLocationAnalyticsPath('/location-analytics/production/overview'), productionOverview);
assert.deepEqual(parseLocationAnalyticsPath('/location-analytics/uat'), { environment: 'uat', tab: 'overview' });
assert.deepEqual(parseLocationAnalyticsPath('/location-analytics/uat/features'), { environment: 'uat', tab: 'features' });
assert.deepEqual(parseLocationAnalyticsPath('/location-analytics/production/circles/'), { environment: 'production', tab: 'circles' });
assert.deepEqual(parseLocationAnalyticsPath('/LOCATION-ANALYTICS/UAT/JOURNEY'), { environment: 'uat', tab: 'journey' });
assert.equal(parseLocationAnalyticsPath('/'), null);
assert.equal(parseLocationAnalyticsPath('/location-analytics/qa'), null);
assert.equal(parseLocationAnalyticsPath('/location-analytics/uat/unknown'), null);

assert.equal(locationAnalyticsPath(productionOverview), '/location-analytics/production');
assert.equal(
  locationAnalyticsPath({ environment: 'uat', tab: 'journey' }),
  '/location-analytics/uat/journey',
);

console.log('One Location route contract passed.');
