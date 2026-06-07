import { NavLink, useParams } from 'react-router-dom';
import { t } from '../lib/i18n';

export function WebsiteSubNav() {
  const { websiteId } = useParams<{ websiteId: string }>();
  if (!websiteId) return null;

  const base = `/websites/${websiteId}`;

  return (
    <nav className="website-sub-nav" aria-label={t('websiteNav')}>
      <NavLink
        to={base}
        end
        className={({ isActive }) => `website-sub-nav-link${isActive ? ' active' : ''}`}
      >
        {t('navOverview')}
      </NavLink>
      <NavLink
        to={`${base}/sessions`}
        className={({ isActive }) => `website-sub-nav-link${isActive ? ' active' : ''}`}
      >
        {t('sessions')}
      </NavLink>
      <NavLink
        to={`${base}/replays`}
        className={({ isActive }) => `website-sub-nav-link${isActive ? ' active' : ''}`}
      >
        {t('sessionReplays')}
      </NavLink>
      <NavLink
        to={`${base}/settings`}
        className={({ isActive }) => `website-sub-nav-link${isActive ? ' active' : ''}`}
      >
        {t('settings')}
      </NavLink>
    </nav>
  );
}
