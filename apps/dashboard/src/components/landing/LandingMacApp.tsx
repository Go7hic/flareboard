import { Download } from 'lucide-react';
import { t } from '../../lib/i18n';
import { MAC_APP_DOWNLOAD_URL, MAC_APP_RELEASE_URL } from '../../lib/landing-links';
import { Button } from '../ui/button';

/** A slim strip for the menu bar app, low on the home page: one line and its download. */
export function LandingMacApp() {
  return (
    <div className="home-container home-mac">
      <span className="home-mac-icon" aria-hidden>
        <img src="/mac/tray.png" alt="" width={20} height={18} />
      </span>
      <p className="home-mac-text">
        <strong id="home-mac-title">{t('homeMacTitle')}</strong> {t('homeMacLead')}
        <span className="home-mac-requirements">
          {t('homeMacRequirements')} ·{' '}
          <a href={MAC_APP_RELEASE_URL} target="_blank" rel="noopener noreferrer">
            {t('homeMacReleaseNotes')}
          </a>
        </span>
      </p>
      <Button asChild variant="outline" className="home-mac-download">
        <a href={MAC_APP_DOWNLOAD_URL}>
          <Download aria-hidden />
          {t('homeMacDownload')}
        </a>
      </Button>
    </div>
  );
}
