import { ArrowRight, Check, Download } from 'lucide-react';
import { t } from '../../lib/i18n';
import { MAC_APP_DOWNLOAD_URL, MAC_APP_RELEASE_URL } from '../../lib/landing-links';
import { Button } from '../ui/button';

const POINTS = ['homeMacPointLive', 'homeMacPointStats', 'homeMacPointPages'];

/** The menu bar app, low on the home page: what it shows, a screenshot and its download. */
export function LandingMacApp() {
  return (
    <div className="home-container">
      <div className="home-mac">
        <div className="home-mac-copy">
          <p className="home-mac-eyebrow">
            <img src="/mac/tray.png" alt="" width={20} height={18} aria-hidden />
            {t('homeMacEyebrow')}
          </p>
          <h2 id="home-mac-title" className="home-mac-title">
            {t('homeMacTitle')}
          </h2>
          <p className="home-mac-lead">{t('homeMacLead')}</p>
          <ul className="home-mac-points">
            {POINTS.map((key) => (
              <li key={key}>
                <Check aria-hidden />
                {t(key)}
              </li>
            ))}
          </ul>
          <div className="home-mac-actions">
            <Button asChild variant="primary">
              <a href={MAC_APP_DOWNLOAD_URL}>
                <Download aria-hidden />
                {t('homeMacDownload')}
              </a>
            </Button>
            <a href={MAC_APP_RELEASE_URL} className="home-text-link" target="_blank" rel="noopener noreferrer">
              {t('homeMacReleaseNotes')}
              <ArrowRight aria-hidden />
            </a>
          </div>
          <p className="home-mac-requirements">{t('homeMacRequirements')}</p>
        </div>
        <div className="home-mac-visual">
          <img
            src="/mac/panel.webp"
            alt={t('homeMacImageAlt')}
            width={398}
            height={588}
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
    </div>
  );
}
