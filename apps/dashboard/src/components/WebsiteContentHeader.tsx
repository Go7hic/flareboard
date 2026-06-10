import { Link } from 'react-router-dom';
import { t } from '../lib/i18n';
import { WebsiteSwitcher } from './WebsiteSwitcher';

export function WebsiteContentHeader() {
  return (
    <div className="website-content-header">
      <Link to="/websites" className="website-content-back">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        {t('back')}
      </Link>
      <WebsiteSwitcher />
    </div>
  );
}
