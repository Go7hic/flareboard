import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import {
  CLOUD_MONTHLY_USD,
  CLOUD_ORIGINAL_MONTHLY_USD,
  CLOUD_PROMO_LABEL,
} from '../lib/landing-links';

type Plan = {
  id: string;
  name: string;
  maxWebsites: number;
  maxEventsPerMonth: number;
  replayEnabled: boolean;
  emailReportsEnabled: boolean;
  heatmapsEnabled: boolean;
  teamsEnabled: boolean;
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
      <div className="page">
        <h1 className="page-title">{t('billing')}</h1>
        <p className="text-muted">{t('billingSelfHosted')}</p>
      </div>
    );
  }

  const plan = data.plan!;
  const used = data.usage?.eventsThisMonth ?? 0;
  const pct = plan.maxEventsPerMonth
    ? Math.min(100, Math.round((used / plan.maxEventsPerMonth) * 100))
    : 0;
  const upgradePlans = (plansData?.plans ?? []).filter((p) => p.id === 'cloud' && plan.id !== 'cloud');

  return (
    <div className="page">
      <h1 className="page-title">{t('billing')}</h1>
      {success ? <p className="text-muted panel-body">{t('billingSuccess')}</p> : null}
      {canceled ? <p className="text-muted panel-body">{t('billingCanceled')}</p> : null}

      <section className="panel section-gap">
        <div className="panel-body">
          <h2 className="section-title">{t('currentPlan')}</h2>
          <p className="stat-value">{plan.name}</p>
          <p className="text-muted">
            {t('websiteLimit')}: {plan.maxWebsites} · {t('replay')}: {plan.replayEnabled ? t('yes') : t('no')} ·{' '}
            {t('emailReports')}: {plan.emailReportsEnabled ? t('yes') : t('no')} · {t('heatmaps')}:{' '}
            {plan.heatmapsEnabled ? t('yes') : t('no')} · {t('teams')}:{' '}
            {plan.teamsEnabled ? t('yes') : t('no')}
            {plan.monthlyPriceUsd != null && plan.monthlyPriceUsd > 0
              ? ` · $${plan.monthlyPriceUsd}/mo`
              : plan.id === 'free'
                ? ' · Free'
                : ''}
          </p>
          <div style={{ marginTop: '1.25rem' }}>
            <div className="list-row" style={{ marginBottom: '0.35rem' }}>
              <span>{t('eventsThisMonth')}</span>
              <span className="stat-value" style={{ fontSize: '0.9375rem' }}>
                {used.toLocaleString()} / {plan.maxEventsPerMonth.toLocaleString()}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{
                height: '6px',
                borderRadius: '999px',
                background: 'var(--bg-subtle)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: pct >= 90 ? 'var(--danger)' : 'var(--accent)',
                }}
              />
            </div>
          </div>
          <div style={{ marginTop: '1.25rem' }}>
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
            <div
              style={{
                marginTop: upgradePlans.length > 0 ? '0.75rem' : 0,
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
              }}
            >
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
            <p className="text-danger" style={{ marginTop: '0.75rem' }}>
              {checkout.error instanceof Error ? checkout.error.message : t('requestFailed')}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
