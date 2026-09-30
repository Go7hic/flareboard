import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import {
  api,
  bootstrapSession,
  hasSession,
  isPaidPlanId,
  type BillingCheckoutResponse,
  type PaidPlanId,
} from '../../lib/api';
import { formatEventLimit, usageGracePercent, type LandingPlan } from '../../lib/landing-links';
import { formatPercent, formatRetentionPeriod } from '../../lib/format';
import { t } from '../../lib/i18n';

export function useLandingPlanActions() {
  const [isLoggedIn, setIsLoggedIn] = useState(hasSession());
  const navigate = useNavigate();

  useEffect(() => {
    void bootstrapSession().then(setIsLoggedIn);
  }, []);

  const checkout = useMutation({
    mutationFn: (planId: PaidPlanId) =>
      api<BillingCheckoutResponse>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ planId }),
      }),
    onSuccess: (res) => {
      if ('url' in res) window.location.href = res.url;
      // Already subscribed: the plan changed in place; Billing shows the result.
      else navigate(`/billing?switched=${res.planId}`);
    },
  });

  return {
    isLoggedIn,
    startCheckout: checkout.mutate,
    isCheckoutPending: checkout.isPending,
    /** The plan the last checkout attempt was for, so only its card shows the error. */
    checkoutPlanId: checkout.variables ?? null,
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
  const gracePercent = usageGracePercent(plan);

  const allowances: PlanFeatureLine[] = [
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
    ...optionalLine(gracePercent > 0, () =>
      t('landingPlanUsageGrace').replace('{percent}', formatPercent(gracePercent)),
    ),
  ];

  // Business has Cloud's features; its card only adds the larger allowances.
  if (plan.id === 'business') {
    return [...allowances, { text: t('landingPlanEverythingInCloud'), included: true }];
  }

  return [
    ...allowances,
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

const PLAN_TAGLINE_KEYS: Record<LandingPlan['id'], string> = {
  free: 'landingPlanFreeTagline',
  cloud: 'landingPlanCloudTagline',
  business: 'landingPlanBusinessTagline',
};

type LandingPlanCardProps = {
  plan: LandingPlan;
  featured?: boolean;
  startHref: string;
  isLoggedIn?: boolean;
  isCheckoutPending?: boolean;
  /** Shown on this card only when `checkoutPlanId` is this plan. */
  checkoutError?: string | null;
  checkoutPlanId?: string | null;
  onCheckout?: (planId: PaidPlanId) => void;
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
  checkoutPlanId,
  onCheckout,
  compact = false,
}: LandingPlanCardProps) {
  const paidPlanId = isPaidPlanId(plan.id) ? plan.id : null;
  const priceUsd = plan.monthlyPriceUsd ?? 0;
  const ctaHref = isLoggedIn && !paidPlanId ? '/dashboard' : startHref;
  const ctaLabel = !paidPlanId
    ? t('landingPlanFreeCta')
    : isLoggedIn
      ? t('landingPlanCloudSubscribeCta')
      : t('landingPlanCloudCta');

  return (
    <article className={`landing-plan-card${featured ? ' landing-plan-card-featured' : ''}`}>
      {featured ? <p className="landing-plan-badge">{t('landingPlanRecommended')}</p> : null}
      <div className="landing-plan-card-top">
        <p className="landing-plan-label">{paidPlanId ? t('landingPlanPaidLabel') : t('landingPlanFreeLabel')}</p>
        <h3 className="landing-plan-name">{plan.name}</h3>
        <p className="landing-plan-price" aria-label={t('landingPlanPriceAria').replace('{price}', String(priceUsd))}>
          <span className="landing-plan-price-value">${priceUsd}</span>
          <span className="landing-plan-price-period">{t('landingPlanPerMonth')}</span>
        </p>
      </div>
      <p className="landing-plan-tagline">{t(PLAN_TAGLINE_KEYS[plan.id] ?? 'landingPlanCloudTagline')}</p>
      <ul className="landing-plan-features">
        {planFeatureLines(plan, compact).map((line) => (
          <li key={line}>
            <PlanCheckIcon />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {isLoggedIn && paidPlanId ? (
        <>
          <Button
            type="button"
            variant={featured ? 'primary' : 'secondary'}
            className="landing-plan-cta"
            disabled={isCheckoutPending}
            onClick={() => onCheckout?.(paidPlanId)}
          >
            {ctaLabel}
          </Button>
          {checkoutError && checkoutPlanId === paidPlanId ? <p className="text-danger">{checkoutError}</p> : null}
        </>
      ) : (
        <Button asChild variant={featured ? 'primary' : 'secondary'} className="landing-plan-cta">
          <Link to={ctaHref}>{ctaLabel}</Link>
        </Button>
      )}
    </article>
  );
}
