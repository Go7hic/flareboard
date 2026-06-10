import { NavLink, useParams } from 'react-router-dom';
import { t } from '../lib/i18n';
import { SidebarNavIcon, type SidebarNavIconName } from './SidebarNavIcon';

type WebsiteNavItem = {
  to: string;
  labelKey: string;
  icon: SidebarNavIconName;
  end?: boolean;
};

type WebsiteNavGroup = {
  labelKey?: string;
  items: WebsiteNavItem[];
};

type WebsiteSidebarProps = {
  onNavigate?: () => void;
};

export function WebsiteSidebar({ onNavigate }: WebsiteSidebarProps) {
  const { websiteId } = useParams<{ websiteId: string }>();
  if (!websiteId) return null;

  const base = `/websites/${websiteId}`;

  const groups: WebsiteNavGroup[] = [
    {
      labelKey: 'navGroupTraffic',
      items: [
        { to: base, labelKey: 'navOverview', icon: 'overview', end: true },
        { to: `${base}/events`, labelKey: 'navEvents', icon: 'events' },
        { to: `${base}/sessions`, labelKey: 'sessions', icon: 'sessions' },
        { to: `${base}/realtime`, labelKey: 'realtime', icon: 'realtime' },
        { to: `${base}/performance`, labelKey: 'performance', icon: 'performance' },
        { to: `${base}/compare`, labelKey: 'navCompare', icon: 'compare' },
      ],
    },
    {
      labelKey: 'navGroupBehavior',
      items: [
        { to: `${base}/goals`, labelKey: 'goals', icon: 'goals' },
        { to: `${base}/funnel`, labelKey: 'funnel', icon: 'funnel' },
        { to: `${base}/journeys`, labelKey: 'navJourneys', icon: 'journeys' },
        { to: `${base}/retention`, labelKey: 'retention', icon: 'retention' },
        { to: `${base}/replays`, labelKey: 'sessionReplays', icon: 'replays' },
        { to: `${base}/heatmaps`, labelKey: 'heatmaps', icon: 'heatmaps' },
      ],
    },
    {
      labelKey: 'navGroupAudience',
      items: [
        { to: `${base}/segments`, labelKey: 'segments', icon: 'segments' },
        { to: `${base}/cohorts`, labelKey: 'cohorts', icon: 'cohorts' },
      ],
    },
    {
      labelKey: 'navGroupGrowth',
      items: [
        { to: `${base}/utm`, labelKey: 'navUtm', icon: 'utm' },
        { to: `${base}/revenue`, labelKey: 'revenue', icon: 'revenue' },
        { to: `${base}/attribution`, labelKey: 'navAttribution', icon: 'attribution' },
      ],
    },
    {
      items: [
        { to: `${base}/share`, labelKey: 'navShareLinks', icon: 'share' },
        { to: `${base}/settings`, labelKey: 'settings', icon: 'settings' },
      ],
    },
  ];

  return (
    <>
      {groups.map((group, index) => (
        <div key={group.labelKey ?? group.items[0]?.to ?? index} className="website-sidebar-group">
          {group.labelKey ? (
            <div className="website-sidebar-group-label">{t(group.labelKey)}</div>
          ) : null}
          <div className="website-sidebar-group-links">
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                onClick={onNavigate}
              >
                <SidebarNavIcon name={item.icon} />
                <span className="sidebar-link-label">{t(item.labelKey)}</span>
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
