import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { t } from '../lib/i18n';
import { WebsiteSwitcher } from './WebsiteSwitcher';

/**
 * Website pages' top bar (console v2): a breadcrumb back to all websites and the site switcher,
 * page-level tools (Ask Flareboard) on the right. The sidebar logo leads to the dashboard.
 */
export function WebsiteContentHeader({ actions }: { actions?: ReactNode }) {
  return (
    <div className="website-content-header">
      <nav className="website-breadcrumb" aria-label={t('allWebsites')}>
        <Link to="/websites" className="website-breadcrumb-link">
          {t('allWebsites')}
        </Link>
        <span className="website-breadcrumb-sep" aria-hidden>
          /
        </span>
        <WebsiteSwitcher />
      </nav>
      {actions ? <div className="website-content-actions">{actions}</div> : null}
    </div>
  );
}
