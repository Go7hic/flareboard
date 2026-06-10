import { Link, NavLink, useMatch } from 'react-router-dom';
import { t } from '../lib/i18n';
import { BrandLogo } from './BrandLogo';
import { SidebarUserMenu } from './SidebarUserMenu';
import { WebsiteSidebar } from './WebsiteSidebar';
import { SidebarNavIcon } from './SidebarNavIcon';
import { filterShellNavItems, shellNavItems } from './shellNavItems';

type AppSidebarProps = {
  hosted: boolean;
  isAdmin: boolean;
  mobileOpen: boolean;
  userLabel: string;
  onNavigate?: () => void;
  onLogout: () => void;
};

export function AppSidebar({
  hosted,
  isAdmin,
  mobileOpen,
  userLabel,
  onNavigate,
  onLogout,
}: AppSidebarProps) {
  const websiteMatch = useMatch('/websites/:websiteId/*');
  const isWebsiteContext = Boolean(websiteMatch);
  const items = filterShellNavItems(shellNavItems, hosted, isAdmin);

  return (
    <aside
      id="app-sidebar"
      className={`app-sidebar${mobileOpen ? ' is-open' : ''}`}
      aria-label={isWebsiteContext ? t('websiteNav') : t('dashboard')}
    >
      <div className="app-sidebar-header">
        <Link to="/dashboard" className="shell-brand" onClick={onNavigate}>
          <BrandLogo />
        </Link>
      </div>
      <nav
        className={`app-sidebar-nav${isWebsiteContext ? ' app-sidebar-nav--website' : ''}`}
        aria-label={isWebsiteContext ? t('websiteNav') : 'Main'}
      >
        {isWebsiteContext ? (
          <WebsiteSidebar onNavigate={onNavigate} />
        ) : (
          items.map(({ to, labelKey, icon, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest ? rest.end : false}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              onClick={onNavigate}
            >
              <SidebarNavIcon name={icon} />
              <span className="sidebar-link-label">{t(labelKey)}</span>
            </NavLink>
          ))
        )}
      </nav>
      <div className="app-sidebar-footer">
        <SidebarUserMenu userLabel={userLabel} onLogout={onLogout} />
      </div>
    </aside>
  );
}
