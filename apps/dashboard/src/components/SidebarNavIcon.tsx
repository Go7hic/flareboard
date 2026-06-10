import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  CreditCard,
  DollarSign,
  FileText,
  Filter,
  Gauge,
  Globe,
  Grid3x3,
  Home,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  Link2,
  MousePointerClick,
  PlayCircle,
  Radio,
  Repeat,
  Route,
  Settings,
  Share2,
  Shield,
  Tag,
  Target,
  Users,
  UsersRound,
} from 'lucide-react';

export const sidebarNavIcons = {
  dashboard: Home,
  websites: Globe,
  teams: Users,
  links: Link2,
  reports: FileText,
  boards: LayoutGrid,
  admin: Shield,
  billing: CreditCard,
  overview: LayoutDashboard,
  events: MousePointerClick,
  sessions: Users,
  realtime: Radio,
  performance: Gauge,
  compare: ArrowLeftRight,
  goals: Target,
  funnel: Filter,
  journeys: Route,
  retention: Repeat,
  replays: PlayCircle,
  heatmaps: Grid3x3,
  segments: Layers,
  cohorts: UsersRound,
  utm: Tag,
  revenue: DollarSign,
  attribution: Share2,
  share: Link2,
  settings: Settings,
} as const satisfies Record<string, LucideIcon>;

export type SidebarNavIconName = keyof typeof sidebarNavIcons;

type SidebarNavIconProps = {
  name: SidebarNavIconName;
};

export function SidebarNavIcon({ name }: SidebarNavIconProps) {
  const Icon = sidebarNavIcons[name];
  return <Icon className="sidebar-link-icon" size={16} strokeWidth={2} aria-hidden />;
}
