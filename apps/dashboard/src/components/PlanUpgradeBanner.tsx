import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from './ui/button';
import { t } from '../lib/i18n';

type PlanUpgradeBannerProps = {
  message: string;
  className?: string;
};

export function PlanUpgradeBanner({ message, className }: PlanUpgradeBannerProps) {
  return (
    <div className={className ? `plan-upgrade-banner ${className}` : 'plan-upgrade-banner'}>
      <p className="plan-upgrade-banner-text">{message}</p>
      <Button variant="primary" size="default" asChild className="plan-upgrade-banner-cta">
        <Link to="/billing">
          {t('upgradeTo')} Cloud
          <ArrowUpRight size={16} strokeWidth={2} aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
