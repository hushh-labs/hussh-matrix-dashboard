import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Database,
  Globe,
  Home,
  Layers,
  MousePointerClick,
  Search,
  Server,
  TrendingUp,
  Users,
} from 'lucide-react';

export type ProjectKey = 'all' | 'hushh_ai' | 'hushh_ai_uat' | 'kai_production' | 'kai_uat' | 'hushhtech';

export type ViewKey =
  | 'overview'
  | 'sources'
  | 'kai_production'
  | 'kai_uat'
  | 'hushh_ai'
  | 'hushh_ai_uat'
  | 'hushhtech'
  | 'platforms'
  | 'funnels';

export interface ProjectMeta {
  key: ProjectKey;
  name: string;
  domain: string;
  environment: 'production' | 'uat';
  color: string;
}

export const PROJECTS: ProjectMeta[] = [
  { key: 'hushh_ai', name: 'Hushh AI', domain: 'hushh.ai', environment: 'production', color: '#007aff' },
  { key: 'hushh_ai_uat', name: 'Hushh AI UAT', domain: 'uat.hushh.ai', environment: 'uat', color: '#ff9500' },
  { key: 'kai_production', name: 'Kai Production', domain: 'kai.hushh.ai', environment: 'production', color: '#12b5cb' },
  { key: 'kai_uat', name: 'Kai UAT', domain: 'uat.kai.hushh.ai', environment: 'uat', color: '#af52de' },
  { key: 'hushhtech', name: 'HushhTech', domain: 'hushhtech.com', environment: 'production', color: '#248a3d' },
];

export function getProjectMeta(key: ProjectKey): ProjectMeta | undefined {
  return PROJECTS.find((p) => p.key === key);
}

export function getProjectLabel(key: ProjectKey): string {
  if (key === 'all') return 'All Projects';
  return getProjectMeta(key)?.name ?? key;
}

export interface NavItem {
  label: string;
  viewKey: ViewKey;
  icon: LucideIcon;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Project Overview', viewKey: 'overview', icon: Home },
];

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Products',
    items: [
      { label: 'Hushh AI', viewKey: 'hushh_ai', icon: Globe },
      { label: 'Hushh AI UAT', viewKey: 'hushh_ai_uat', icon: Activity },
      { label: 'Kai Production', viewKey: 'kai_production', icon: Server },
      { label: 'Kai UAT', viewKey: 'kai_uat', icon: Activity },
      { label: 'HushhTech', viewKey: 'hushhtech', icon: TrendingUp },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { label: 'Source Matrix', viewKey: 'sources', icon: Layers },
      { label: 'Platforms', viewKey: 'platforms', icon: BarChart3 },
      { label: 'Funnels', viewKey: 'funnels', icon: Users },
    ],
  },
];

export function mapViewToAgentView(view: ViewKey): 'overview' | 'platforms' {
  if (view === 'platforms' || view === 'funnels') return 'platforms';
  return 'overview';
}
