import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleCheck, CreditCard, ExternalLink, Info, Minus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import {
  api,
  isPaidPlanId,
  planRank,
  type BillingCheckoutResponse,
  type BillingPlan,
  type BillingSubscription,
  type PaidPlanId,
} from '../lib/api';
import { formatNextMonthStart, formatNumber, formatPercent, formatRetentionPeriod, formatShortDate } from '../lib/format';
import { t } from '../lib/i18n';
import { formatEventLimit, usageGracePercent } from '../lib/landing-links';
import { cn } from '../lib/utils';

/** Stripe subscription status, localized for the known values. */
function planStatusLabel(status: string | undefined): string {
  const key = `workspacePlanStatus_${status ?? 'active'}`;
  const label = t(key);
  return label === key ? (status ?? '') : label;
}

function monthlyPrice(priceUsd: number): string {
  return t('billingPlanMonthlyPrice').replace('{price}', String(priceUsd));
}

/** One plan the account can move up to: price, allowances and the upgrade button. */
function UpgradeOption({
  plan,
  disabled,
  onUpgrade,
}: {
  plan: BillingPlan & { id: PaidPlanId };
  disabled: boolean;
  onUpgrade: (planId: PaidPlanId) => void;
}) {
  const summary = t('billingUpgradeSummary')
    .replace('{events}', formatEventLimit(plan.maxEventsPerMonth))
    .replace('{replays}', formatEventLimit(plan.maxReplaysPerMonth))
    .replace('{otel}', formatEventLimit(plan.maxOtelRowsPerMonth))
    .replace('{duration}', formatRetentionPeriod(plan.maxRetentionDays));
  return (
    <li className="ws-settings-row ws-upgrade-row">
      <span className="ws-upgrade-copy">
        <span className="ws-upgrade-name">
          {plan.name}
          <span className="ws-upgrade-price">{monthlyPrice(plan.monthlyPriceUsd ?? 0)}</span>
        </span>
        <span className="ws-settings-row-hint">{summary}</span>
      </span>
      <Button variant="primary" size="sm" disabled={disabled} onClick={() => onUpgrade(plan.id)}>
        {t('billingUpgradeToPlan').replace('{plan}', plan.name)}
      </Button>
    </li>
  );
}

type UsageMeterProps = {
  label: string;
  used: number;
  included: number;
  graceMultiple: number;
  resetDate: string;
};

/** One monthly allowance: used / included, a bar, and what happens near and past the allowance. */
function UsageMeter({ label, used, included, graceMultiple, resetDate }: UsageMeterProps) {
  const ratio = included > 0 ? used / included : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const ceiling = Math.floor(included * graceMultiple);
  let note: { text: string; tone: 'muted' | 'warning' | 'danger' } | null = null;
  if (ratio >= 1) {
    if (graceMultiple <= 1) {
      note = { text: t('billingUsageDropped').replace('{date}', resetDate), tone: 'danger' };
    } else if (used >= ceiling) {
      note = {
        text: t('billingUsageStopped').replace('{ceiling}', formatNumber(ceiling)).replace('{date}', resetDate),
        tone: 'danger',
      };
    } else {
      note = {
        text: t('billingUsageGrace').replace('{ceiling}', formatNumber(ceiling)).replace('{date}', resetDate),
        tone: 'warning',
      };
    }
  } else if (ratio >= 0.8) {
    note = { text: t('billingUsageNear').replace('{percent}', formatPercent(ratio * 100)), tone: 'muted' };
  }
  const state = note?.tone === 'danger' ? 'is-over' : ratio >= 0.8 ? 'is-near' : '';

  return (
    <li className="ws-meter">
      <div className="ws-meter-head">
        <span className="ws-meter-label">{label}</span>
        <span className="ws-meter-value">
          <strong>{formatNumber(used)}</strong> / {formatNumber(included)}
          <span className="ws-meter-pct">{formatPercent(ratio * 100, { digits: ratio > 0 && ratio < 0.1 ? 1 : 0 })}</span>
        </span>
      </div>
      <div
        className="ws-meter-track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={cn('ws-meter-fill', state)} style={{ width: `${Math.max(pct, used > 0 ? 1 : 0)}%` }} />
      </div>
      {note ? <p className={`ws-meter-note is-${note.tone}`}>{note.text}</p> : null}
    </li>
  );
}

export default function Billing() {
  const [params] = useSearchParams();
  const success = params.get('success') === '1';
  const canceled = params.get('canceled') === '1';
  const queryClient = useQueryClient();
  /** Plan an in-place switch moved to (from this page, or `?switched=` from the pricing page). */
  const [switchedTo, setSwitchedTo] = useState<string | null>(params.get('switched'));

  const { data, isLoading } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => api<BillingSubscription>('/api/billing/subscription'),
  });

  const { data: plansData } = useQuery({
    queryKey: ['billing-plans'],
    queryFn: () => api<{ plans: BillingPlan[]; hosted: boolean }>('/api/billing/plans'),
  });

  const checkout = useMutation({
    mutationFn: (planId: PaidPlanId) =>
      api<BillingCheckoutResponse>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ planId }),
      }),
    onSuccess: (res) => {
      if ('url' in res) {
        window.location.href = res.url;
        return;
      }
      // Already subscribed: Stripe changed the plan in place.
      setSwitchedTo(res.planId);
      void queryClient.invalidateQueries({ queryKey: ['billing-subscription'] });
    },
  });

  const portal = useMutation({
    mutationFn: () => api<{ url: string }>('/api/billing/portal', { method: 'POST', body: '{}' }),
    onSuccess: (res) => {
      if (res.url) window.location.href = res.url;
    },
  });

  if (isLoading) {
    return (
      <Page className="ws-page-billing ws-page-settings">
        <PageHeader title={t('billing')} lead={t('workspaceBillingLead')} />
        <PageBody>
          <div className="ws-settings" aria-hidden>
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        </PageBody>
      </Page>
    );
  }

  if (!data?.hosted) {
    return (
      <Page className="ws-page-billing ws-page-settings">
        <PageHeader title={t('billing')} />
        <PageBody>
          <EmptyState variant="rich" icon={<CreditCard />} title={t('workspaceSelfHostedTitle')} description={t('billingSelfHosted')} />
        </PageBody>
      </Page>
    );
  }

  const plan = data.plan!;
  const usage = data.usage;
  const resetDate = formatNextMonthStart();
  const gracePercent = usageGracePercent({ usageGraceMultiple: plan.usageGraceMultiple ?? 1 });
  const meters = [
    { key: 'events', label: t('billingUsageEvents'), used: usage?.eventsThisMonth ?? 0, included: plan.maxEventsPerMonth },
    { key: 'replays', label: t('billingUsageReplays'), used: usage?.replaysThisMonth ?? 0, included: plan.maxReplaysPerMonth ?? 0 },
    { key: 'otel', label: t('billingUsageOtel'), used: usage?.otelRowsThisMonth ?? 0, included: plan.maxOtelRowsPerMonth ?? 0 },
  ].filter((meter) => meter.included > 0);
  const plans = plansData?.plans ?? [];
  const upgradePlans = plans.filter(
    (p): p is BillingPlan & { id: PaidPlanId } => isPaidPlanId(p.id) && planRank(p.id) > planRank(plan.id),
  );
  // `/subscription` has no price; `/plans` does.
  const priceUsd = plan.monthlyPriceUsd ?? plans.find((p) => p.id === plan.id)?.monthlyPriceUsd;
  // Shown once the refetched subscription reflects the switch (the API applies it before replying).
  const switchedPlanName = switchedTo && switchedTo === plan.id ? plan.name : null;
  const features: Array<{ key: string; label: string; enabled: boolean }> = [
    {
      key: 'websites',
      label:
        plan.maxWebsites != null
          ? t('workspacePlanWebsites').replace('{count}', formatNumber(plan.maxWebsites))
          : t('workspacePlanUnlimitedWebsites'),
      enabled: true,
    },
    { key: 'replay', label: t('replay'), enabled: plan.replayEnabled },
    { key: 'heatmaps', label: t('heatmaps'), enabled: plan.heatmapsEnabled },
    { key: 'reports', label: t('emailReports'), enabled: plan.emailReportsEnabled },
    { key: 'teams', label: t('teams'), enabled: plan.teamsEnabled },
    { key: 'flags', label: t('featureFlags'), enabled: plan.experimentationEnabled },
    { key: 'surveys', label: t('surveys'), enabled: plan.surveysEnabled },
    { key: 'warehouse', label: t('dataWarehouse'), enabled: plan.warehouseEnabled },
  ];
  const active = !data.status || data.status === 'active' || data.status === 'trialing';

  return (
    <Page className="ws-page-billing ws-page-settings">
      <PageHeader
        title={t('billing')}
        lead={t('workspaceBillingLead')}
        actions={
          data.billingAccount ? (
            <Button variant="outline" disabled={portal.isPending} onClick={() => portal.mutate()}>
              {t('manageBilling')}
              <ExternalLink aria-hidden />
            </Button>
          ) : null
        }
      />
      <PageBody>
        <div className="ws-settings">
          {success || canceled || switchedPlanName ? (
            <p className="ws-notice" role="status">
              {canceled ? <Info aria-hidden /> : <CircleCheck aria-hidden />}
              {switchedPlanName
                ? t('billingSwitched').replace('{plan}', switchedPlanName)
                : success
                  ? t('billingSuccess')
                  : t('billingCanceled')}
            </p>
          ) : null}
          {portal.isError ? (
            <p className="text-danger" role="alert">
              {portal.error instanceof Error ? portal.error.message : t('requestFailed')}
            </p>
          ) : null}

          <SectionCard title={t('currentPlan')}>
            <div className="ws-plan-head">
              <span className="ws-plan-name">{plan.name}</span>
              <StatusBadge tone={active ? 'success' : 'warning'}>{planStatusLabel(data.status)}</StatusBadge>
              {priceUsd != null ? <span className="ws-plan-price">{monthlyPrice(priceUsd)}</span> : null}
              {data.currentPeriodEnd ? (
                <span className="ws-plan-price">
                  {t('workspacePlanRenews').replace('{date}', formatShortDate(data.currentPeriodEnd))}
                </span>
              ) : null}
            </div>
            <ul className="ws-feature-list">
              {features.map((feature) => (
                <li key={feature.key} className={feature.enabled ? 'is-on' : 'is-off'}>
                  {feature.enabled ? <Check aria-hidden /> : <Minus aria-hidden />}
                  <span>{feature.label}</span>
                  <span className="visually-hidden">{feature.enabled ? t('yes') : t('no')}</span>
                </li>
              ))}
            </ul>
            {plan.maxRetentionDays ? (
              <p className="ws-muted-line ws-plan-retention">
                {t('billingRetention').replace('{duration}', formatRetentionPeriod(plan.maxRetentionDays))}
              </p>
            ) : null}
          </SectionCard>

          <SectionCard
            title={t('billingUsageTitle')}
            description={`${t('billingUsageResets').replace('{date}', resetDate)} ${
              gracePercent > 0
                ? t('billingUsageGraceHint').replace('{percent}', formatPercent(gracePercent))
                : t('billingUsageStopsHint')
            }`}
          >
            <ul className="ws-meters">
              {meters.map((meter) => (
                <UsageMeter
                  key={meter.key}
                  label={meter.label}
                  used={meter.used}
                  included={meter.included}
                  graceMultiple={plan.usageGraceMultiple ?? 1}
                  resetDate={resetDate}
                />
              ))}
            </ul>
          </SectionCard>

          {upgradePlans.length > 0 ? (
            <SectionCard
              title={t('billingUpgradeTitle')}
              description={isPaidPlanId(plan.id) ? t('billingUpgradeProrated') : undefined}
            >
              <ul className="ws-settings-rows">
                {upgradePlans.map((p) => (
                  <UpgradeOption key={p.id} plan={p} disabled={checkout.isPending} onUpgrade={checkout.mutate} />
                ))}
              </ul>
              {checkout.isError ? (
                <p className="text-danger" role="alert">
                  {checkout.error instanceof Error ? checkout.error.message : t('requestFailed')}
                </p>
              ) : null}
            </SectionCard>
          ) : null}
        </div>
      </PageBody>
    </Page>
  );
}
