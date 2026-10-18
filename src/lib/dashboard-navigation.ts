import { BarChart3, ChartNoAxesCombined, Clock3, Globe2, Instagram, LayoutGrid, MapPin, Smartphone, UsersRound, UserPlus } from 'lucide-react';

export type DashboardTab = 'briefing' | 'growth' | 'compare' | 'one' | 'apps' | 'overview' | 'platforms' | 'instagram' | 'referrals';

export const dashboardNavigation = [
  { key: 'briefing', label: 'Founder briefing', group: 'Dashboard', icon: LayoutGrid, description: 'Active accounts, feature adoption and the daily trend.' },
  { key: 'overview', label: 'Analytics overview', group: 'Dashboard', icon: BarChart3, description: 'Traffic and performance across Hussh products.' },
  { key: 'growth', label: 'Growth', group: 'Analytics', icon: ChartNoAxesCombined, description: 'Audience growth, acquisition and operating costs.' },
  { key: 'compare', label: 'Over time', group: 'Analytics', icon: Clock3, description: 'Compare 30 days, 90 days and the full history.' },
  { key: 'one', label: 'One app', group: 'Products', icon: Smartphone, description: 'Registered accounts, active users and feature usage.' },
  { key: 'referrals', label: 'Referrals', group: 'One app', icon: UserPlus, description: 'Referring accounts, registered referrals, points and rewards.' },
  { key: 'apps', label: 'Hussh Connect', group: 'Products', icon: UsersRound, description: 'iOS, Android and web across production and test builds.' },
  { key: 'instagram', label: 'Instagram', group: 'Products', icon: Instagram, description: 'Reach, content performance and campaign links.' },
  { key: 'platforms', label: 'Data sources', group: 'Workspace', icon: Globe2, description: 'Platform health, coverage and measurement readiness.' },
] as const;

export const dashboardTabs: DashboardTab[] = dashboardNavigation.map(item => item.key);
export const dashboardTabLabels = Object.fromEntries(dashboardNavigation.map(item => [item.key, item.label])) as Record<DashboardTab, string>;
export const locationNavigation = { label: 'One Location', icon: MapPin, description: 'Location sharing, circles, features and journeys.' };
