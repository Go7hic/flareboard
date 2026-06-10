import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { t } from '../lib/i18n';
import { SidebarNavIcon } from './SidebarNavIcon';
import { WebsiteSwitcher } from './WebsiteSwitcher';

const OVERVIEW_PATH = '/dashboard';

export function WebsiteContentHeader() {
  const navigate = useNavigate();

  function goBack() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(OVERVIEW_PATH);
  }

  return (
    <div className="website-content-header">
      <div className="website-content-nav">
        <Link
          to={OVERVIEW_PATH}
          className="website-content-nav-link"
          aria-label={t('dashboard')}
          title={t('dashboard')}
        >
          <SidebarNavIcon name="dashboard" />
        </Link>
        <button
          type="button"
          className="website-content-nav-link"
          onClick={goBack}
          aria-label={t('backPrevious')}
          title={t('backPrevious')}
        >
          <ArrowLeft size={14} strokeWidth={2} aria-hidden />
          <span>{t('back')}</span>
        </button>
      </div>
      <WebsiteSwitcher />
    </div>
  );
}
