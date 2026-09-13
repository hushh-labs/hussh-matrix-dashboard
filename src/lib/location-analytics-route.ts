export const locationAnalyticsEnvironments = ['production', 'uat'] as const;
export const locationAnalyticsTabs = ['overview', 'features', 'circles', 'journey'] as const;

export type LocationAnalyticsEnvironment = (typeof locationAnalyticsEnvironments)[number];
export type LocationAnalyticsTab = (typeof locationAnalyticsTabs)[number];

export interface LocationAnalyticsRoute {
  environment: LocationAnalyticsEnvironment;
  tab: LocationAnalyticsTab;
}

const locationAnalyticsRoutePattern = /^\/location-analytics(?:\/(production|uat))?(?:\/(overview|features|circles|journey))?\/?$/i;

export function parseLocationAnalyticsPath(pathname: string): LocationAnalyticsRoute | null {
  const match = pathname.match(locationAnalyticsRoutePattern);
  if (!match) return null;

  return {
    environment: (match[1]?.toLowerCase() ?? 'production') as LocationAnalyticsEnvironment,
    tab: (match[2]?.toLowerCase() ?? 'overview') as LocationAnalyticsTab,
  };
}

export function locationAnalyticsPath(route: LocationAnalyticsRoute): string {
  const base = `/location-analytics/${route.environment}`;
  return route.tab === 'overview' ? base : `${base}/${route.tab}`;
}
