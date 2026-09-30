import { Link, NavLink, useMatch } from 'react-router-dom';
import { t } from '../lib/i18n';
import { BrandLogo } from './BrandLogo';
import { SidebarUserMenu } from './SidebarUserMenu';
import { WebsiteSidebar } from './WebsiteSidebar';
import { SidebarNavIcon } from './SidebarNavIcon';
import { isDemoHiddenPath } from '../lib/useDemoSession';
import { filterShellNavItems, shellNavItems } from './shellNavItems';

type AppSidebarProps = {
  hosted: boolean;
  isAdmin: boolean;
  /** Read-only demo session: no billing, team, link or account pages. */
  isDemo?: boolean;
  mobileOpen: boolean;
  userLabel: string;
  oauthProviders?: string[];
  onNavigate?: () => void;
  onLogout: () => void;
  onDeleteAccount?: () => void;
};

export function AppSidebar({
  hosted,
  isAdmin,
  isDemo = false,
  mobileOpen,
  userLabel,
  oauthProviders,
  onNavigate,
  onLogout,
  onDeleteAccount,
}: AppSidebarProps) {
  const websiteMatch = useMatch('/websites/:websiteId/*');
  const isWebsiteContext = Boolean(websiteMatch);
  const items = filterShellNavItems(shellNavItems, hosted, isAdmin).filter(
    (item) => !isDemo || !isDemoHiddenPath(item.to),
  );

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
          <WebsiteSidebar onNavigate={onNavigate} isDemo={isDemo} />
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
        <SidebarUserMenu
          userLabel={userLabel}
          isDemo={isDemo}
          oauthProviders={oauthProviders}
          onLogout={onLogout}
          onDeleteAccount={onDeleteAccount}
          onNavigate={onNavigate}
        />
      </div>
    </aside>
  );
}
