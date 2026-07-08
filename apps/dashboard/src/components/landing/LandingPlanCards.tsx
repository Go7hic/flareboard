import { Link } from 'react-router-dom';
import { Button } from '../ui/button';
import { t } from '../../lib/i18n';
import {
  CLOUD_MONTHLY_USD,
  CLOUD_ORIGINAL_MONTHLY_USD,
  formatEventLimit,
  type LandingPlan,
} from '../../lib/landing-links';

function PlanCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function planFeatureLines(plan: LandingPlan): string[] {
  const websiteLine =
    plan.maxWebsites > 1
      ? t('landingPlanWebsites').replace('{count}', String(plan.maxWebsites))
      : t('landingPlanWebsite').replace('{count}', String(plan.maxWebsites));

  return [
    websiteLine,
    t('landingPlanEventsPerMonth').replace('{limit}', formatEventLimit(plan.maxEventsPerMonth)),
    plan.replayEnabled ? t('landingPlanReplayIncluded') : t('landingPlanReplayExcluded'),
    plan.emailReportsEnabled
      ? t('landingPlanEmailReportsIncluded')
      : t('landingPlanEmailReportsExcluded'),
    plan.heatmapsEnabled ? t('landingPlanHeatmapsIncluded') : t('landingPlanHeatmapsExcluded'),
    plan.teamsEnabled ? t('landingPlanTeamsIncluded') : t('landingPlanTeamsExcluded'),
    plan.experimentationEnabled
      ? t('landingPlanExperimentationIncluded')
      : t('landingPlanExperimentationExcluded'),
    plan.surveysEnabled ? t('landingPlanSurveysIncluded') : t('landingPlanSurveysExcluded'),
    plan.warehouseEnabled ? t('landingPlanWarehouseIncluded') : t('landingPlanWarehouseExcluded'),
    plan.teamsEnabled ? t('landingPlanFeaturesCloudShared') : t('landingPlanFeaturesFreeShared'),
  ];
}

type LandingPlanCardProps = {
  plan: LandingPlan;
  featured?: boolean;
  startHref: string;
};

export function LandingPlanCard({ plan, featured, startHref }: LandingPlanCardProps) {
  const priceUsd = plan.monthlyPriceUsd ?? (plan.id === 'cloud' ? CLOUD_MONTHLY_USD : 0);
  const tagline =
    plan.id === 'cloud' ? t('landingPlanCloudTagline') : t('landingPlanFreeTagline');
  const priceAria =
    plan.id === 'cloud'
      ? t('landingPlanPriceAriaCloud')
          .replace('{price}', String(priceUsd))
          .replace('{original}', String(CLOUD_ORIGINAL_MONTHLY_USD))
      : t('landingPlanPriceAriaFree').replace('{price}', String(priceUsd));

  return (
    <article className={`landing-plan-card${featured ? ' landing-plan-card-featured' : ''}`}>
      {featured ? <p className="landing-plan-badge">{t('landingPlanRecommended')}</p> : null}
      <div className="landing-plan-card-top">
        <p className="landing-plan-label">
          {plan.id === 'cloud' ? t('landingPlanPaidLabel') : t('landingPlanFreeLabel')}
        </p>
        <h3 className="landing-plan-name">{plan.name}</h3>
        <p className="landing-plan-price" aria-label={priceAria}>
          {plan.id === 'cloud' ? (
            <>
              <span className="promo-price">
                <span className="promo-price-original" aria-hidden="true">
                  ${CLOUD_ORIGINAL_MONTHLY_USD}
                </span>
                <span className="landing-plan-price-value">${priceUsd}</span>
              </span>
              <span className="landing-plan-price-period">{t('landingPlanPerMonth')}</span>
              <span className="promo-price-label">{t('landingPromoLabel')}</span>
            </>
          ) : (
            <>
              <span className="landing-plan-price-value">$0</span>
              <span className="landing-plan-price-period">{t('landingPlanPerMonth')}</span>
            </>
          )}
        </p>
      </div>
      <p className="landing-plan-tagline">{tagline}</p>
      <ul className="landing-plan-features">
        {planFeatureLines(plan).map((line) => (
          <li key={line}>
            <PlanCheckIcon />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <Button asChild variant={featured ? 'primary' : 'secondary'} className="landing-plan-cta">
        <Link to={startHref}>
          {plan.id === 'free' ? t('landingPlanFreeCta') : t('landingPlanCloudCta')}
        </Link>
      </Button>
    </article>
  );
}
