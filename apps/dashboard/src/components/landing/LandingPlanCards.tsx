import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/button';
import { api, bootstrapSession, hasSession } from '../../lib/api';
import { formatNumber, formatRetentionPeriod } from '../../lib/format';
import { t } from '../../lib/i18n';
import {
  CLOUD_MONTHLY_USD,
  CLOUD_ORIGINAL_MONTHLY_USD,
  formatEventLimit,
  type LandingPlan,
} from '../../lib/landing-links';

type CheckoutResponse = {
  url: string;
};

export function useLandingPlanActions() {
  const [isLoggedIn, setIsLoggedIn] = useState(hasSession());

  useEffect(() => {
    void bootstrapSession().then(setIsLoggedIn);
  }, []);

  const checkout = useMutation({
    mutationFn: (planId: string) =>
      api<CheckoutResponse>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ planId }),
      }),
    onSuccess: (res) => {
      if (res.url) window.location.href = res.url;
    },
  });

  return {
    isLoggedIn,
    startCloudCheckout: checkout.mutate,
    isCheckoutPending: checkout.isPending,
    checkoutError: checkout.isError
      ? checkout.error instanceof Error
        ? checkout.error.message
        : t('requestFailed')
      : null,
  };
}

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

type PlanFeatureLine = { text: string; included: boolean };

function optionalLine(show: boolean, text: () => string): PlanFeatureLine[] {
  return show ? [{ text: text(), included: true }] : [];
}

function planFeatureItems(plan: LandingPlan): PlanFeatureLine[] {
  const websiteLine =
    plan.maxWebsites == null
      ? t('landingPlanWebsitesUnlimited')
      : plan.maxWebsites > 1
        ? t('landingPlanWebsites').replace('{count}', String(plan.maxWebsites))
        : t('landingPlanWebsite').replace('{count}', String(plan.maxWebsites));
  const toggle = (enabled: boolean, onKey: string, offKey: string): PlanFeatureLine => ({
    text: t(enabled ? onKey : offKey),
    included: enabled,
  });

  return [
    { text: websiteLine, included: true },
    {
      text: t('landingPlanEventsPerMonth').replace('{limit}', formatEventLimit(plan.maxEventsPerMonth)),
      included: true,
    },
    // Allowance fields are optional on `/api/config` plans from an older API: skip what is missing.
    plan.replayEnabled
      ? {
          text:
            plan.maxReplaysPerMonth > 0
              ? t('landingPlanReplaysPerMonth').replace('{limit}', formatEventLimit(plan.maxReplaysPerMonth))
              : t('landingPlanReplayIncluded'),
          included: true,
        }
      : { text: t('landingPlanReplayExcluded'), included: false },
    ...optionalLine(plan.maxOtelRowsPerMonth > 0, () =>
      t('landingPlanOtelPerMonth').replace('{limit}', formatEventLimit(plan.maxOtelRowsPerMonth)),
    ),
    ...optionalLine(plan.maxRetentionDays > 0, () =>
      t('landingPlanRetention').replace('{duration}', formatRetentionPeriod(plan.maxRetentionDays)),
    ),
    ...optionalLine(plan.usageGraceMultiple > 1, () =>
      t('landingPlanUsageGrace').replace('{multiple}', formatNumber(plan.usageGraceMultiple)),
    ),
    toggle(plan.emailReportsEnabled, 'landingPlanEmailReportsIncluded', 'landingPlanEmailReportsExcluded'),
    toggle(plan.heatmapsEnabled, 'landingPlanHeatmapsIncluded', 'landingPlanHeatmapsExcluded'),
    toggle(plan.teamsEnabled, 'landingPlanTeamsIncluded', 'landingPlanTeamsExcluded'),
    toggle(
      plan.experimentationEnabled,
      'landingPlanExperimentationIncluded',
      'landingPlanExperimentationExcluded',
    ),
    toggle(plan.surveysEnabled, 'landingPlanSurveysIncluded', 'landingPlanSurveysExcluded'),
    toggle(plan.warehouseEnabled, 'landingPlanWarehouseIncluded', 'landingPlanWarehouseExcluded'),
    {
      text: plan.teamsEnabled ? t('landingPlanFeaturesCloudShared') : t('landingPlanFeaturesFreeShared'),
      included: true,
    },
  ];
}

/** Plan feature bullets; `compact` keeps only what the plan includes. */
export function planFeatureLines(plan: LandingPlan, compact = false): string[] {
  const items = planFeatureItems(plan);
  return (compact ? items.filter((item) => item.included) : items).map((item) => item.text);
}

type LandingPlanCardProps = {
  plan: LandingPlan;
  featured?: boolean;
  startHref: string;
  isLoggedIn?: boolean;
  isCheckoutPending?: boolean;
  checkoutError?: string | null;
  onCloudCheckout?: (planId: string) => void;
  /** Only list included features (landing page). */
  compact?: boolean;
};

export function LandingPlanCard({
  plan,
  featured,
  startHref,
  isLoggedIn = false,
  isCheckoutPending = false,
  checkoutError,
  onCloudCheckout,
  compact = false,
}: LandingPlanCardProps) {
  const priceUsd = plan.monthlyPriceUsd ?? (plan.id === 'cloud' ? CLOUD_MONTHLY_USD : 0);
  const tagline =
    plan.id === 'cloud' ? t('landingPlanCloudTagline') : t('landingPlanFreeTagline');
  const ctaHref = isLoggedIn && plan.id === 'free' ? '/dashboard' : startHref;
  const ctaLabel =
    isLoggedIn && plan.id === 'cloud'
      ? t('landingPlanCloudSubscribeCta')
      : plan.id === 'free'
        ? t('landingPlanFreeCta')
        : t('landingPlanCloudCta');
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
        {planFeatureLines(plan, compact).map((line) => (
          <li key={line}>
            <PlanCheckIcon />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {isLoggedIn && plan.id === 'cloud' ? (
        <>
          <Button
            type="button"
            variant={featured ? 'primary' : 'secondary'}
            className="landing-plan-cta"
            disabled={isCheckoutPending}
            onClick={() => onCloudCheckout?.(plan.id)}
          >
            {ctaLabel}
          </Button>
          {checkoutError ? (
            <p className="text-danger mt-3">
              {checkoutError}
            </p>
          ) : null}
        </>
      ) : (
        <Button asChild variant={featured ? 'primary' : 'secondary'} className="landing-plan-cta">
          <Link to={ctaHref}>{ctaLabel}</Link>
        </Button>
      )}
    </article>
  );
}
