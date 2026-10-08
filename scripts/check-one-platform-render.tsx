/** Render the One platform cards against previous/partial API schemas. */
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AndroidProviderReport, AndroidAnalyticsPanel } from '../src/components/AndroidAnalyticsPanel';
import { PlatformsAtAGlance, InstallFunnel } from '../src/components/OneAppPanel';
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
assert.doesNotMatch(uat, /Named screen visits|Different named screens/);

const withScreens = render({
  platforms: [{
    platform: 'IOS', users: 1, events: 6, activeAccounts: 1,
    activeDeviceIds: 1, routeVisits: 3, namedRouteVisits: 2,
    distinctScreens: 1, topProductScreens: [{ routeId: 'one_dashboard', visits: 2 }],
  } as OneAppSummary['platforms'][number]],
}, 'production');
assert.doesNotMatch(withScreens, /Named screen visits|Different named screens/);
assert.match(withScreens, /<details/);
assert.match(withScreens, /Screen activity details/);
assert.match(withScreens, /Visits can repeat and are not user counts/);



const waitingAndroid = renderToStaticMarkup(createElement(AndroidAnalyticsPanel, {one:{androidCapture:{state:'waiting',note:'No new Android app events were exported'}} as OneAppSummary}));
assert.match(waitingAndroid,/No new Android app events/);
assert.doesNotMatch(waitingAndroid,/First opens \/ reinstalls<\/dt>/);
const emptyVitals = renderToStaticMarkup(createElement(AndroidProviderReport,{report:{history:{state:'permission_missing'},downloads:{installs:{state:'not_configured'},store:{state:'not_configured'}},vitals:{state:'not_yet_available',metrics:{userPerceivedCrashRate:{state:'not_yet_available',daily:[]}}}}}));
assert.match(emptyVitals,/Read permission needed/);assert.match(emptyVitals,/Not yet available/);assert.doesNotMatch(emptyVitals,/0 crashes/);

const missingFirstOpens=renderToStaticMarkup(createElement(AndroidProviderReport,{report:{history:{state:'available',daily:[{date:'2026-10-05',event:'first_open',events:null}]},downloads:{},vitals:{state:'not_yet_available'}}}));
assert.match(missingFirstOpens,/First-open events<\/dt><dd[^>]*>Not available/);
const cohort = {
  platform: 'ANDROID', installed: 5,
  stages: [
    {key:'installed',label:'First opened the app',users:5,shareOfInstalls:1},
    {key:'tried_sign_in',label:'Tried to sign in',users:0,shareOfInstalls:0},
    {key:'returned_w1',label:'Returned in week 1',users:0,shareOfInstalls:null},
  ],
};
const pending = renderToStaticMarkup(createElement(InstallFunnel,{funnels:[{...cohort,retentionWindowComplete:false}]}));
assert.match(pending,/Week-1 return window incomplete/);
assert.match(pending,/Awaiting complete week/);
assert.doesNotMatch(pending,/0\.0%|Biggest drop:|100% drop/);
const complete = renderToStaticMarkup(createElement(InstallFunnel,{funnels:[{...cohort,retentionWindowComplete:true,stages:cohort.stages.map(stage=>({...stage,shareOfInstalls:stage.users/5}))}]}));
assert.match(complete,/returned in week 1 of 5 first-open app IDs/);
assert.match(complete,/0\.0%/);
console.log(JSON.stringify({ok:true,checks:['previous-schema','missing-screen-ranking','uat-source-host','anonymous-account-state','screen-diagnostics-deemphasized','android-waiting','provider-unavailable','missing-first-open','immature-native-cohort','completed-native-cohort-zero']}));
