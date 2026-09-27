import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import {
  CLOUD_MONTHLY_USD,
  CLOUD_ORIGINAL_MONTHLY_USD,
  CLOUD_PROMO_LABEL,
} from '../lib/landing-links';

type Plan = {
  id: string;
  name: string;
  maxWebsites: number | null;
  maxEventsPerMonth: number;
  replayEnabled: boolean;
  emailReportsEnabled: boolean;
  heatmapsEnabled: boolean;
  teamsEnabled: boolean;
  warehouseEnabled: boolean;
  experimentationEnabled: boolean;
  surveysEnabled: boolean;
  monthlyPriceUsd?: number | null;
};

type SubscriptionResponse = {
  hosted: boolean;
  plan?: Plan;
  status?: string;
  usage?: { eventsThisMonth: number };
};

export default function Billing() {
  const [params] = useSearchParams();
  const success = params.get('success') === '1';
  const canceled = params.get('canceled') === '1';

  const { data, isLoading } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => api<SubscriptionResponse>('/api/billing/subscription'),
  });

  const { data: plansData } = useQuery({
    queryKey: ['billing-plans'],
    queryFn: () => api<{ plans: Plan[]; hosted: boolean }>('/api/billing/plans'),
  });

  const checkout = useMutation({
    mutationFn: (planId: string) =>
      api<{ url: string }>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ planId }),
      }),
    onSuccess: (res) => {
      if (res.url) window.location.href = res.url;
    },
  });

  const portal = useMutation({
    mutationFn: () =>
      api<{ url: string }>('/api/billing/portal', { method: 'POST', body: '{}' }),
    onSuccess: (res) => {
      if (res.url) window.location.href = res.url;
    },
  });

  if (isLoading) {
    return <div className="skeleton skeleton-block" style={{ minHeight: '12rem' }} aria-hidden />;
  }

  if (!data?.hosted) {
    return (
      <Page>
        <PageHeader title={t('billing')} lead={t('billingSelfHosted')} />
      </Page>
    );
  }

  const plan = data.plan!;
  const used = data.usage?.eventsThisMonth ?? 0;
  const pct = plan.maxEventsPerMonth
    ? Math.min(100, Math.round((used / plan.maxEventsPerMonth) * 100))
    : 0;
  const upgradePlans = (plansData?.plans ?? []).filter((p) => p.id === 'cloud' && plan.id !== 'cloud');

  return (
    <Page>
      <PageHeader title={t('billing')} />
      <PageBody>
      {success ? <p className="text-muted panel-body">{t('billingSuccess')}</p> : null}
      {canceled ? <p className="text-muted panel-body">{t('billingCanceled')}</p> : null}

      <section className="panel section-gap">
        <div className="panel-body">
          <h2 className="section-title">{t('currentPlan')}</h2>
          <p className="stat-value">{plan.name}</p>
          <p className="text-muted">
            {plan.maxWebsites != null ? (
              <>
                {t('websiteLimit')}: {plan.maxWebsites} ·{' '}
              </>
            ) : null}
            {t('replay')}: {plan.replayEnabled ? t('yes') : t('no')} ·{' '}
            {t('emailReports')}: {plan.emailReportsEnabled ? t('yes') : t('no')} · {t('heatmaps')}:{' '}
            {plan.heatmapsEnabled ? t('yes') : t('no')} · {t('teams')}:{' '}
            {plan.teamsEnabled ? t('yes') : t('no')} · {t('featureFlags')}:{' '}
            {plan.experimentationEnabled ? t('yes') : t('no')} · {t('surveys')}:{' '}
            {plan.surveysEnabled ? t('yes') : t('no')} · {t('dataWarehouse')}:{' '}
            {plan.warehouseEnabled ? t('yes') : t('no')}
            {plan.monthlyPriceUsd != null && plan.monthlyPriceUsd > 0
              ? ` · $${plan.monthlyPriceUsd}/mo`
              : plan.id === 'free'
                ? ' · Free'
                : ''}
          </p>
          <div className="billing-usage">
            <div className="list-row billing-usage-row">
              <span>{t('eventsThisMonth')}</span>
              <span className="stat-value billing-usage-value">
                {formatNumber(used)} / {formatNumber(plan.maxEventsPerMonth)}
              </span>
            </div>
            <div
              className="billing-usage-track"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`billing-usage-fill${pct >= 90 ? ' is-near-limit' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="mt-5">
            {upgradePlans.length > 0 ? (
              <div className="billing-cloud-promo">
                <p className="promo-price billing-promo-price">
                  <span className="promo-price-original" aria-hidden="true">
                    ${CLOUD_ORIGINAL_MONTHLY_USD}
                  </span>
                  <span className="promo-price-current">${CLOUD_MONTHLY_USD}/mo</span>
                </p>
                <p className="promo-price-label">{CLOUD_PROMO_LABEL}</p>
              </div>
            ) : null}
            <div className={`flex flex-wrap gap-2${upgradePlans.length > 0 ? ' mt-3' : ''}`}>
            {upgradePlans.map((p) => (
              <Button
                key={p.id}
                variant="primary"
                size="sm"
                disabled={checkout.isPending}
                onClick={() => checkout.mutate(p.id)}
              >
                {t('upgradeTo')} Cloud
              </Button>
            ))}
            <Button
              variant="secondary"
              size="sm"
              disabled={portal.isPending}
              onClick={() => portal.mutate()}
            >
              {t('manageBilling')}
            </Button>
            </div>
          </div>
          {checkout.isError ? (
            <p className="text-danger mt-3">
              {checkout.error instanceof Error ? checkout.error.message : t('requestFailed')}
            </p>
          ) : null}
        </div>
      </section>
      </PageBody>
    </Page>
  );
}
