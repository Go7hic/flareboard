import { t } from '../lib/i18n';
import { Button } from './ui/button';

type DemoSessionBannerProps = {
  onCreateAccount: () => void;
  onExit: () => void;
};

/** Shown on every page of a demo session (the shared read-only demo account). */
export function DemoSessionBanner({ onCreateAccount, onExit }: DemoSessionBannerProps) {
  return (
    <div className="demo-session-banner" role="status">
      <p className="demo-session-banner-text">
        <span className="badge demo-session-banner-badge">{t('demoSampleBadge')}</span>
        <span>{t('demoSessionBanner')}</span>
      </p>
      <div className="demo-session-banner-actions">
        <Button type="button" variant="ghost" size="sm" onClick={onExit}>
          {t('demoSessionExit')}
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={onCreateAccount}>
          {t('demoSessionCreateAccount')}
        </Button>
      </div>
    </div>
  );
}
