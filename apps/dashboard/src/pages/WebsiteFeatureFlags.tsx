import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { Area, AreaChart } from 'recharts';
import { Activity, Flag, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { BreakdownList, type BreakdownItem } from '../components/BreakdownList';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import {
  FeatureFlagConditionSummary,
  FeatureFlagEditorDialog,
  FeatureFlagHistory,
  variantColor,
  type FeatureFlagBody,
} from '../components/FeatureFlagEditor';
import { KpiCell, KpiStrip } from '../components/KpiStrip';
import { MasterDetailLayout, MasterDetailListItem, MasterDetailPane } from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { FlagEvaluatePanel } from '../components/product/FlagEvaluatePanel';
import { countMeta, formatShare, utcDay } from '../components/product/format';
import { ProductListHeader, ProductMasterDetailSkeleton, ProductNoMatches } from '../components/product/ProductList';
import { ProductCallout, ProductSection } from '../components/product/ProductSection';
import { ProductTabs } from '../components/product/ProductTabs';
import { RelativeTime, ShortDate } from '../components/product/ProductTime';
import { SessionLink } from '../components/product/SessionLink';
import { SeriesKey, SplitBar } from '../components/product/SplitBar';
import { flagGroups, flagStatus } from '../components/product/status';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { api, type FeatureFlag } from '../lib/api';
import { areaMark } from '../lib/chartMarks';
import { formatNumber, formatShortDate } from '../lib/format';
import { pluralKey, t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

type DetailTab = 'overview' | 'conditions' | 'test' | 'history';

type Summary = NonNullable<FeatureFlag['summary']>;

/**
 * Colors follow the variant, not its rank: configured variants keep their slot in the flag's
 * order, and responses the flag does not configure (boolean flags) are ordered by name.
 */
function variantColorMap(flag: FeatureFlag) {
  const keys = flag.variants.map((variant) => variant.key);
  const observed = (flag.summary?.variants ?? [])
    .map((row) => row.variant)
    .filter((key) => !keys.includes(key))
    .sort((a, b) => a.localeCompare(b));
  return new Map([...keys, ...observed].map((key, index) => [key, variantColor(index)]));
}

function isUnknown(value: string | null | undefined) {
  return !value || value === 'unknown';
}

function flagIssueText(issue: Summary['health']['issues'][number], health: Summary['health']) {
  if (issue === 'traffic_concentrated' && health.dominantVariant) {
    return t('productFlagIssueConcentrated')
      .replace('{variant}', health.dominantVariant)
      .replace('{share}', formatShare(health.dominantShare ?? 0));
  }
  return t(`featureFlagIssue_${issue}`);
}

function FlagListMeta({ flag }: { flag: FeatureFlag }) {
  const status = flagStatus(flag);
  const exposures = countMeta(t('productExposuresCount'), flag.summary?.exposures ?? 0);
  return (
    <>
      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      <span title={exposures.title}>{exposures.text}</span>
    </>
  );
}

function FlagOverview({ websiteId, flag }: { websiteId: string; flag: FeatureFlag }) {
  const chartColors = useChartColors();
  const summary = flag.summary;
  const colors = useMemo(() => variantColorMap(flag), [flag]);
  const trend = useMemo(
    () =>
      (summary?.trend ?? []).map((row) => ({
        x: formatShortDate(utcDay(row.date), { timeZone: 'UTC' }),
        exposures: row.exposures,
      })),
    [summary?.trend],
  );
  const issues = summary?.health.status === 'needs_attention' ? summary.health.issues : [];
  const variants = summary?.variants ?? [];
  const configured = new Map(flag.variants.map((variant) => [variant.key, variant.weight]));
  const releases = summary?.releases ?? [];
  const environments = summary?.environments ?? [];
  const contextKnown = [...releases.map((row) => row.release), ...environments.map((row) => row.environment)].some(
    (value) => !isUnknown(value),
  );
  const recent = summary?.recent ?? [];
  const showRelease = recent.some((row) => row.release);
  const showEnvironment = recent.some((row) => row.environment);

  const contextItems = (rows: Array<{ label: string; exposures: number; percentage: number }>): BreakdownItem[] => {
    const max = Math.max(1, ...rows.map((row) => row.exposures));
    return rows.map((row) => ({
      id: row.label,
      label: isUnknown(row.label) ? t('productNotReported') : row.label,
      title: row.label,
      mono: !isUnknown(row.label),
      share: row.exposures / max,
      values: [formatNumber(row.exposures), formatShare(row.percentage)],
    }));
  };

  return (
    <>
      {issues.length && summary ? (
        <ProductCallout tone="warning" title={t('featureFlagHealth_needs_attention')} role="status">
          {issues.map((issue) => flagIssueText(issue, summary.health)).join(' ')}
        </ProductCallout>
      ) : null}

      <ProductSection title={t('productExposuresPerDay')} description={t('productDaysUtc')}>
        {trend.length > 1 ? (
          <div className="product-chart">
            <AnalyticsChart
              Chart={AreaChart}
              data={trend}
              responsive={{ height: 200 }}
              xAxis={{ dataKey: 'x', interval: 'preserveStartEnd', minTickGap: 32 }}
            >
              <Area
                dataKey="exposures"
                name={t('featureFlagExposures')}
                stroke={chartColors.accent}
                fill={chartColors.accent}
                {...areaMark(chartColors.panel)}
              />
            </AnalyticsChart>
          </div>
        ) : (
          <EmptyState
            icon={<Activity strokeWidth={2} />}
            title={t('featureFlagIssue_no_exposures')}
            description={t('productFlagNoExposuresHint').replace('{key}', flag.key)}
          />
        )}
      </ProductSection>

      {variants.length ? (
        <ProductSection
          title={flag.variants.length ? t('productFlagObservedSplit') : t('productFlagResponses')}
          description={flag.variants.length ? t('productFlagObservedSplitLead') : t('productFlagResponsesLead')}
        >
          <SplitBar
            ariaLabel={t('productFlagObservedSplit')}
            legend={false}
            segments={variants.map((row) => ({
              key: row.variant,
              label: row.variant,
              value: row.exposures,
              color: colors.get(row.variant) ?? variantColor(-1),
            }))}
          />
          <div className="table-scroll">
            <table className="data-table product-table">
              <thead>
                <tr>
                  <th>{t('variant')}</th>
                  {flag.variants.length ? <th className="num">{t('productFlagWeight')}</th> : null}
                  <th className="num">{t('featureFlagExposures')}</th>
                  <th className="num">{t('sessions')}</th>
                  <th className="num">{t('productShare')}</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((row) => (
                  <tr key={row.variant}>
                    <td>
                      <span className="product-series-cell">
                        <SeriesKey color={colors.get(row.variant) ?? variantColor(-1)} />
                        <span className="mono">{row.variant}</span>
                      </span>
                    </td>
                    {flag.variants.length ? (
                      <td className="num text-muted">
                        {configured.has(row.variant) ? `${configured.get(row.variant)}%` : '–'}
                      </td>
                    ) : null}
                    <td className="num">{formatNumber(row.exposures)}</td>
                    <td className="num">{formatNumber(row.sessions)}</td>
                    <td className="num">{formatShare(row.percentage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ProductSection>
      ) : null}

      {releases.length || environments.length ? (
        contextKnown ? (
          <ProductSection title={t('productFlagContext')} description={t('productFlagContextLead')}>
            <div className="product-two-col">
              <div>
                <h4 className="product-subtitle">{t('featureFlagEvaluateRelease')}</h4>
                <BreakdownList
                  items={contextItems(releases.map((row) => ({ ...row, label: row.release })))}
                  columns={[{ label: t('featureFlagExposures') }, { label: t('productShare') }]}
                />
              </div>
              <div>
                <h4 className="product-subtitle">{t('featureFlagEvaluateEnvironment')}</h4>
                <BreakdownList
                  items={contextItems(environments.map((row) => ({ ...row, label: row.environment })))}
                  columns={[{ label: t('featureFlagExposures') }, { label: t('productShare') }]}
                />
              </div>
            </div>
          </ProductSection>
        ) : (
          <ProductSection title={t('productFlagContext')}>
            <p className="product-muted-line">{t('productFlagContextNone')}</p>
          </ProductSection>
        )
      ) : null}

      {recent.length ? (
        <ProductSection title={t('productRecentExposures')} description={t('productRecentExposuresLead')}>
          <div className="table-scroll">
            <table className="data-table product-table">
              <thead>
                <tr>
                  <th>{t('productTime')}</th>
                  <th>{t('variant')}</th>
                  <th>{t('page')}</th>
                  {showRelease ? <th>{t('featureFlagEvaluateRelease')}</th> : null}
                  {showEnvironment ? <th>{t('featureFlagEvaluateEnvironment')}</th> : null}
                  <th>{t('session')}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((exposure) => {
                  const variant = exposure.variant ?? t('featureFlagVariantControl');
                  return (
                    <tr key={exposure.id}>
                      <td className="text-muted product-nowrap">
                        <ShortDate value={exposure.createdAt} withTime />
                      </td>
                      <td>
                        <span className="product-series-cell">
                          <SeriesKey color={colors.get(variant) ?? variantColor(-1)} />
                          <span className="mono">{variant}</span>
                        </span>
                      </td>
                      <td className="mono product-path-cell">{exposure.urlPath || '/'}</td>
                      {showRelease ? <td className="mono">{exposure.release ?? '–'}</td> : null}
                      {showEnvironment ? <td className="mono">{exposure.environment ?? '–'}</td> : null}
                      <td>
                        <SessionLink websiteId={websiteId} sessionId={exposure.sessionId} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ProductSection>
      ) : null}
    </>
  );
}

function FlagKpis({ flag }: { flag: FeatureFlag }) {
  const summary = flag.summary;
  const groups = flagGroups(flag);
  const single = groups.length === 1 ? groups[0]! : null;
  const exposures = summary?.exposures ?? 0;
  const sessions = summary?.sessions ?? 0;
  return (
    <KpiStrip inline columns={4}>
      <KpiCell
        label={t('featureFlagExposures')}
        value={formatNumber(exposures)}
        hint={
          summary?.lastCalledAt ? (
            <>
              {t('productLastCall')} <RelativeTime value={summary.lastCalledAt} />
            </>
          ) : (
            t('featureFlagIssue_no_exposures')
          )
        }
      />
      <KpiCell
        label={t('sessions')}
        value={formatNumber(sessions)}
        hint={
          sessions > 0
            ? t('productPerSession').replace('{value}', formatNumber(exposures / sessions, { maximumFractionDigits: 2 }))
            : undefined
        }
      />
      <KpiCell
        label={t('productRollout')}
        value={single ? `${single.rollout}%` : t('featureFlagRolloutPerGroup')}
        hint={
          !flag.enabled
            ? t('featureFlagReason_disabled')
            : single
              ? single.conditions.length
                ? t('featureFlagOfMatching')
                : t('productFlagEveryone')
              : t('featureFlagGroupCount').replace('{count}', String(groups.length))
        }
      />
      <KpiCell
        label={t('featureFlagVariants')}
        value={flag.variants.length ? formatNumber(flag.variants.length) : t('productFlagBoolean')}
        hint={
          flag.variants.length
            ? flag.variants.map((variant) => `${variant.key} ${variant.weight}%`).join(' · ')
            : t('productFlagBooleanHint')
        }
      />
    </KpiStrip>
  );
}

function FlagDetail({
  websiteId,
  flag,
  canEdit,
  onEdit,
  onToggle,
  onDelete,
  onRolloutCommit,
  toggling,
  error,
}: {
  websiteId: string;
  flag: FeatureFlag;
  canEdit: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onRolloutCommit: (rollout: number) => void;
  toggling: boolean;
  error: Error | null;
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const status = flagStatus(flag);
  const health = flag.summary?.health;
  const groups = flagGroups(flag);

  return (
    <MasterDetailPane
      title={flag.name}
      meta={
        <>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <span className="mono product-meta-key">{flag.key}</span>
          {health?.status === 'needs_attention' ? (
            <StatusBadge tone="warning">{t('featureFlagHealth_needs_attention')}</StatusBadge>
          ) : null}
          {flag.earlyAccess ? (
            <StatusBadge tone="info" dot={false}>
              {t('featureFlagEarlyAccess')}
            </StatusBadge>
          ) : null}
          {flag.createdAt ? (
            <span>
              {t('created')} <ShortDate value={flag.createdAt} />
            </span>
          ) : null}
          {flag.updatedAt ? (
            <span>
              {t('productUpdated')} <ShortDate value={flag.updatedAt} />
            </span>
          ) : null}
        </>
      }
      description={flag.description || undefined}
      actions={
        canEdit ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              <Pencil strokeWidth={2} aria-hidden />
              {t('edit')}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={toggling} onClick={onToggle}>
              <Power strokeWidth={2} aria-hidden />
              {flag.enabled ? t('disable') : t('enable')}
            </Button>
            <Button type="button" variant="destructive-ghost" size="sm" onClick={onDelete}>
              <Trash2 strokeWidth={2} aria-hidden />
              {t('delete')}
            </Button>
          </>
        ) : null
      }
    >
      {error ? (
        <p className="text-danger product-inline-error" role="alert">
          {error.message}
        </p>
      ) : null}
      <FlagKpis flag={flag} />
      <ProductTabs<DetailTab>
        label={t('featureFlag')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: t('featureFlagTabOverview'), content: <FlagOverview websiteId={websiteId} flag={flag} /> },
          {
            id: 'conditions',
            label: t('featureFlagReleaseConditions'),
            content: (
              <FeatureFlagConditionSummary
                websiteId={websiteId}
                flag={flag}
                onRolloutCommit={canEdit && groups.length === 1 ? onRolloutCommit : undefined}
              />
            ),
          },
          { id: 'test', label: t('productTabTest'), content: <FlagEvaluatePanel websiteId={websiteId} flagKey={flag.key} /> },
          { id: 'history', label: t('featureFlagTabHistory'), content: <FeatureFlagHistory websiteId={websiteId} flagId={flag.id} /> },
        ]}
      />
    </MasterDetailPane>
  );
}

export default function WebsiteFeatureFlagsPage() {
  const confirm = useConfirm();
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId, 'featureFlags');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  /** null = closed, 'new' = create dialog, otherwise the flag being edited. */
  const [editor, setEditor] = useState<FeatureFlag | 'new' | null>(null);

  const flagsQuery = useQuery({
    queryKey: ['feature-flags', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<FeatureFlag[]>(`/api/websites/${websiteId}/feature-flags`),
  });
  const flags = useMemo(() => flagsQuery.data ?? [], [flagsQuery.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return flags;
    return flags.filter(
      (flag) =>
        flag.key.toLowerCase().includes(needle) ||
        flag.name.toLowerCase().includes(needle) ||
        flag.description.toLowerCase().includes(needle),
    );
  }, [flags, search]);

  // Selection lives in the URL (?flag=key) so a flag can be linked; default to the first row.
  const requestedKey = searchParams.get('flag');
  const selectedFlag = rows.find((flag) => flag.key === requestedKey) ?? rows[0] ?? null;

  function selectFlag(key: string, replace = false) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('flag', key);
        return next;
      },
      { replace },
    );
  }

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['feature-flags', websiteId] }),
      queryClient.invalidateQueries({ queryKey: ['feature-flag-history', websiteId] }),
    ]);

  const createMutation = useMutation({
    mutationFn: (body: FeatureFlagBody) =>
      api<FeatureFlag>(`/api/websites/${websiteId}/feature-flags`, {
        method: 'POST',
        body: JSON.stringify({ ...body, enabled: true }),
      }),
    onSuccess: (flag) => {
      setEditor(null);
      setSearch('');
      selectFlag(flag.key, true);
      void invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<FeatureFlagBody> & { enabled?: boolean } }) =>
      api<FeatureFlag>(`/api/websites/${websiteId}/feature-flags/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    // Stays pending until the list has refetched, so Enable / Disable cannot fire twice on stale data.
    onSuccess: (flag) => {
      setEditor(null);
      if (flag?.key && requestedKey && flag.key !== requestedKey) selectFlag(flag.key, true);
      return invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/feature-flags/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void invalidate();
    },
  });

  const enabledCount = flags.filter((flag) => flag.enabled).length;
  const createButton = canEdit ? (
    <Button type="button" variant="primary" onClick={() => setEditor('new')}>
      <Plus strokeWidth={2} aria-hidden />
      {t('createFeatureFlag')}
    </Button>
  ) : null;

  return (
    <Page className="page-feature-flags product-page">
      <PageHeader title={t('featureFlags')} lead={t('featureFlagsLead')} actions={createButton} />

      <PageBody>
        {viewOnly ? <p className="product-view-only">{t('viewOnlyHint')}</p> : null}

        <DataViewState
          loading={flagsQuery.isLoading}
          loadingFallback={<ProductMasterDetailSkeleton />}
          error={flagsQuery.isError ? flagsQuery.error : null}
          onRetry={() => flagsQuery.refetch()}
        >
          {flags.length ? (
            <MasterDetailLayout
              listHeader={
                <ProductListHeader
                  search={search}
                  onSearch={setSearch}
                  placeholder={t('featureFlagSearch')}
                  summary={t(pluralKey('productFlagListSummary', flags.length))
                    .replace('{count}', formatNumber(flags.length))
                    .replace('{on}', formatNumber(enabledCount))}
                />
              }
              list={
                rows.length ? (
                  rows.map((flag) => (
                    <MasterDetailListItem
                      key={flag.id}
                      selected={flag.id === selectedFlag?.id}
                      onSelect={() => selectFlag(flag.key)}
                      title={flag.name}
                      subtitle={<span className="mono">{flag.key}</span>}
                      meta={<FlagListMeta flag={flag} />}
                    />
                  ))
                ) : (
                  <ProductNoMatches query={search} onClear={() => setSearch('')} />
                )
              }
              detail={
                selectedFlag && websiteId ? (
                  <FlagDetail
                    key={selectedFlag.id}
                    websiteId={websiteId}
                    flag={selectedFlag}
                    canEdit={canEdit}
                    toggling={updateMutation.isPending}
                    error={((!editor && updateMutation.error) || deleteMutation.error) as Error | null}
                    onEdit={() => {
                      updateMutation.reset();
                      setEditor(selectedFlag);
                    }}
                    onToggle={() => updateMutation.mutate({ id: selectedFlag.id, patch: { enabled: !selectedFlag.enabled } })}
                    onDelete={() =>
                      confirm({
                        title: deleteTitle(selectedFlag.name),
                        onConfirm: () => deleteMutation.mutate(selectedFlag.id),
                      })
                    }
                    onRolloutCommit={(rollout) => {
                      const group = selectedFlag.conditionGroups[0] ?? { conditions: selectedFlag.targetingRules ?? [] };
                      updateMutation.mutate({
                        id: selectedFlag.id,
                        patch: {
                          conditionGroups: [
                            {
                              ...group,
                              conditions: group.conditions,
                              rollout,
                              variant: selectedFlag.conditionGroups[0]?.variant ?? null,
                            },
                          ],
                        },
                      });
                    }}
                  />
                ) : (
                  <div className="master-detail-pane">
                    <EmptyState icon={<Flag strokeWidth={2} />} title={t('productSelectFlag')} />
                  </div>
                )
              }
            />
          ) : (
            <EmptyState
              variant="rich"
              icon={<Flag strokeWidth={2} />}
              title={t('featureFlagsEmptyTitle')}
              description={t('featureFlagsEmptyBody')}
              action={createButton}
            />
          )}
        </DataViewState>

        {editor && websiteId ? (
          <FeatureFlagEditorDialog
            websiteId={websiteId}
            flag={editor === 'new' ? null : editor}
            saving={editor === 'new' ? createMutation.isPending : updateMutation.isPending}
            error={(editor === 'new' ? createMutation.error : updateMutation.error) as Error | null}
            onClose={() => {
              createMutation.reset();
              updateMutation.reset();
              setEditor(null);
            }}
            onSave={(body) =>
              editor === 'new' ? createMutation.mutate(body) : updateMutation.mutate({ id: editor.id, patch: body })
            }
          />
        ) : null}
      </PageBody>
    </Page>
  );
}
