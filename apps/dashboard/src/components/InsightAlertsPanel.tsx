import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, History, Plus, Trash2 } from 'lucide-react';
import type { InsightQuery } from '@flareboard/shared/insight-query';
import { ModalDialog } from './ModalDialog';
import { deleteTitle, useConfirm } from './ConfirmDialog';
import { EmptyState } from './EmptyState';
import { StatusBadge, type StatusTone } from './StatusBadge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Skeleton } from './ui/skeleton';
import { Switch } from './ui/switch';
import {
  api,
  type Insight,
  type InsightAlert,
  type InsightAlertCheck,
  type InsightAlertCondition,
} from '../lib/api';
import { formatDateTime, formatNumber, formatShortDateTime } from '../lib/format';
import { t } from '../lib/i18n';

const CONDITIONS: InsightAlertCondition[] = ['value_above', 'value_below', 'increase_above', 'decrease_above'];
const INTERVALS = ['hour', 'day', 'week'] as const;
const DAY = 86_400_000;

function seriesOptions(query: InsightQuery) {
  const series: Array<{ label?: string; event?: string | null; kind: string }> = query.series?.length
    ? query.series
    : [{ kind: 'pageview' }];
  const options = series.map((item, index) => {
    const key = 'ABCDE'[index]!;
    const name = item.label || item.event || (item.kind === 'pageview' ? t('insightKindPageview') : t('insightKindAll'));
    return { key, label: `${key} · ${name}` };
  });
  return query.formula?.trim() ? [...options, { key: 'formula', label: `${t('insightFormula')}: ${query.formula}` }] : options;
}

function isRelative(condition: InsightAlertCondition) {
  return condition === 'increase_above' || condition === 'decrease_above';
}

function conditionText(alert: Pick<InsightAlert, 'condition' | 'threshold' | 'seriesKey' | 'checkInterval'>) {
  return t(`insightAlertCondition_${alert.condition}`)
    .replace('{series}', alert.seriesKey === 'formula' ? t('insightFormula') : alert.seriesKey)
    .replace('{threshold}', `${formatNumber(alert.threshold, { maximumFractionDigits: 2 })}${isRelative(alert.condition) ? '%' : ''}`)
    .replace('{interval}', t(`insightAlertInterval_${alert.checkInterval}`));
}

function alertState(alert: InsightAlert): { tone: StatusTone; label: string } {
  if (!alert.enabled) return { tone: 'neutral', label: t('insightAlertDisabled') };
  if (alert.snoozedUntil && alert.snoozedUntil > Date.now()) return { tone: 'neutral', label: t('insightAlertSnoozed') };
  if (alert.lastState === 'firing') return { tone: 'danger', label: t('insightAlertFiring') };
  if (alert.lastState === 'error') return { tone: 'warning', label: t('insightAlertErrored') };
  if (alert.lastState === 'ok') return { tone: 'success', label: t('insightAlertOk') };
  return { tone: 'neutral', label: t('insightAlertPending') };
}

function AlertHistory({ insightId, alertId }: { insightId: string; alertId: string }) {
  const history = useQuery({
    queryKey: ['insight-alert-history', alertId],
    queryFn: () => api<{ checks: InsightAlertCheck[] }>(`/api/insights/${insightId}/alerts/${alertId}/history`),
  });
  const checks = history.data?.checks ?? [];
  if (history.isLoading) return <Skeleton className="h-16 w-full" />;
  if (!checks.length) return <p className="ws-muted-line">{t('insightAlertNoChecks')}</p>;
  return (
    <div className="table-scroll ws-alert-history">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('insightAlertInterval')}</th>
            <th className="num">{t('value')}</th>
            <th className="num">{t('insightPreviousPeriod')}</th>
            <th>{t('status')}</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.id}>
              <td className="ws-nowrap" title={formatDateTime(check.intervalStart)}>
                {formatShortDateTime(check.intervalStart)}
              </td>
              <td className="num">{check.value == null ? '–' : formatNumber(check.value, { maximumFractionDigits: 2 })}</td>
              <td className="num">
                {check.previousValue == null ? '–' : formatNumber(check.previousValue, { maximumFractionDigits: 2 })}
              </td>
              <td>
                {check.state === 'firing' ? (
                  <StatusBadge tone="danger">
                    {check.delivered ? `${t('insightAlertFiring')} · ${t('insightAlertDelivered')}` : t('insightAlertFiring')}
                  </StatusBadge>
                ) : check.state === 'error' ? (
                  <StatusBadge tone="warning">{t('insightAlertErrored')}</StatusBadge>
                ) : (
                  <StatusBadge tone="success">{t('insightAlertOk')}</StatusBadge>
                )}
                {check.error ? <span className="ws-cell-sub">{check.error}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertFormDialog({ insight, onClose }: { insight: Insight; onClose: () => void }) {
  const queryClient = useQueryClient();
  const options = seriesOptions(insight.query);
  const [name, setName] = useState(insight.name);
  const [seriesKey, setSeriesKey] = useState(options[options.length - 1]?.key === 'formula' ? 'formula' : 'A');
  const [condition, setCondition] = useState<InsightAlertCondition>('value_below');
  const [threshold, setThreshold] = useState('');
  const [checkInterval, setCheckInterval] = useState<(typeof INTERVALS)[number]>('day');
  const [channel, setChannel] = useState<'email' | 'webhook'>('email');
  const [target, setTarget] = useState('');
  const thresholdValue = Number(threshold);
  const valid = name.trim() && threshold.trim() !== '' && Number.isFinite(thresholdValue) && target.trim();

  const createMutation = useMutation({
    mutationFn: () =>
      api<InsightAlert>(`/api/insights/${insight.id}/alerts`, {
        method: 'POST',
        body: JSON.stringify({ name, seriesKey, condition, threshold: thresholdValue, checkInterval, channel, target }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insight-alerts', insight.id] });
      onClose();
    },
  });

  return (
    <ModalDialog className="ws-dialog--md" aria-label={t('insightAlertNew')} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{t('insightAlertNew')}</h2>
        <p>{t('insightAlertLead')}</p>
      </header>
      <div className="dialog-body">
        <div className="field">
          <Label htmlFor="alert-name">{t('name')}</Label>
          <Input id="alert-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="ws-form-grid">
          <div className="field">
            <Label htmlFor="alert-series">{t('insightSeries')}</Label>
            <select id="alert-series" className="select" value={seriesKey} onChange={(event) => setSeriesKey(event.target.value)}>
              {options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <Label htmlFor="alert-interval">{t('insightAlertCheckEvery')}</Label>
            <select
              id="alert-interval"
              className="select"
              value={checkInterval}
              onChange={(event) => setCheckInterval(event.target.value as (typeof INTERVALS)[number])}
            >
              {INTERVALS.map((value) => (
                <option key={value} value={value}>
                  {t(`insightAlertInterval_${value}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <Label htmlFor="alert-condition">{t('insightAlertConditionLabel')}</Label>
            <select
              id="alert-condition"
              className="select"
              value={condition}
              onChange={(event) => setCondition(event.target.value as InsightAlertCondition)}
            >
              {CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`insightAlertConditionOption_${value}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <Label htmlFor="alert-threshold">{isRelative(condition) ? t('insightAlertPercent') : t('insightAlertThreshold')}</Label>
            <Input
              id="alert-threshold"
              type="number"
              inputMode="decimal"
              min={isRelative(condition) ? 0 : undefined}
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
            />
          </div>
          <div className="field">
            <Label htmlFor="alert-channel">{t('insightAlertChannel')}</Label>
            <select
              id="alert-channel"
              className="select"
              value={channel}
              onChange={(event) => setChannel(event.target.value as 'email' | 'webhook')}
            >
              <option value="email">{t('email')}</option>
              <option value="webhook">{t('webhook')}</option>
            </select>
          </div>
          <div className="field">
            <Label htmlFor="alert-target">{channel === 'email' ? t('email') : t('insightAlertWebhookUrl')}</Label>
            <Input
              id="alert-target"
              type={channel === 'email' ? 'email' : 'url'}
              value={target}
              placeholder={channel === 'email' ? 'team@example.com' : 'https://hooks.example.com/…'}
              onChange={(event) => setTarget(event.target.value)}
            />
          </div>
        </div>
        <p className="field-hint">{t('insightAlertEvaluationHint')}</p>
        {createMutation.error ? (
          <p className="text-danger" role="alert">
            {(createMutation.error as Error).message}
          </p>
        ) : null}
      </div>
      <footer className="dialog-footer">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="button" variant="primary" disabled={!valid || createMutation.isPending} onClick={() => createMutation.mutate()}>
          {t('insightAlertCreate')}
        </Button>
      </footer>
    </ModalDialog>
  );
}

/** Threshold alerts of a saved trend insight, with history, snooze and enable toggles. */
export function InsightAlertsPanel({ insight, canEdit }: { insight: Insight; canEdit: boolean }) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const queryKey = ['insight-alerts', insight.id];

  const alertsQuery = useQuery({
    queryKey,
    queryFn: () => api<{ alerts: InsightAlert[]; limit: number }>(`/api/insights/${insight.id}/alerts`),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api(`/api/insights/${insight.id}/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/insights/${insight.id}/alerts/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const alerts = alertsQuery.data?.alerts ?? [];

  return (
    <section className="detail-section ws-alerts">
      <div className="ws-result-toolbar">
        <div>
          <h3 className="card-title">{t('insightAlerts')}</h3>
          <p className="card-description">{t('insightAlertsLead')}</p>
        </div>
        {canEdit ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('insightAlertNew')}
          </Button>
        ) : null}
      </div>
      {alertsQuery.isLoading ? <Skeleton className="h-12 w-full" /> : null}
      {!alertsQuery.isLoading && !alerts.length ? (
        <EmptyState icon={<BellRing />} title={t('insightAlertsEmpty')} />
      ) : null}
      {alerts.length ? (
        <ul className="ws-alert-list">
          {alerts.map((alert) => {
            const snoozed = Boolean(alert.snoozedUntil && alert.snoozedUntil > Date.now());
            const state = alertState(alert);
            return (
              <li key={alert.id} className="ws-alert">
                <div className="ws-alert-head">
                  <div className="ws-alert-main">
                    <span className="ws-alert-title">
                      {alert.name}
                      <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                    </span>
                    <span className="ws-alert-meta">
                      {conditionText(alert)} · {alert.channel === 'email' ? t('email') : t('webhook')}: {alert.target}
                    </span>
                    {snoozed ? (
                      <span className="ws-alert-meta">
                        {t('insightAlertSnoozedUntil').replace('{date}', formatShortDateTime(alert.snoozedUntil))}
                      </span>
                    ) : null}
                  </div>
                  <div className="ws-alert-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={openHistory === alert.id}
                      onClick={() => setOpenHistory(openHistory === alert.id ? null : alert.id)}
                    >
                      <History aria-hidden />
                      {t('insightAlertHistory')}
                    </Button>
                    {canEdit ? (
                      <>
                        {snoozed ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => patchMutation.mutate({ id: alert.id, patch: { snoozedUntil: null } })}
                          >
                            {t('insightAlertUnsnooze')}
                          </Button>
                        ) : (
                          <select
                            className="select ws-alert-snooze"
                            aria-label={t('insightAlertSnooze')}
                            value=""
                            onChange={(event) => {
                              const days = Number(event.target.value);
                              if (days > 0) patchMutation.mutate({ id: alert.id, patch: { snoozedUntil: Date.now() + days * DAY } });
                            }}
                          >
                            <option value="">{t('insightAlertSnooze')}</option>
                            <option value="1">{t('insightAlertSnoozeDay')}</option>
                            <option value="7">{t('insightAlertSnoozeWeek')}</option>
                          </select>
                        )}
                        <Switch
                          checked={alert.enabled}
                          aria-label={t('insightAlertEnabled')}
                          onCheckedChange={(checked) => patchMutation.mutate({ id: alert.id, patch: { enabled: checked } })}
                        />
                        <Button
                          type="button"
                          variant="destructive-ghost"
                          size="icon-sm"
                          aria-label={t('delete')}
                          title={t('delete')}
                          onClick={() => confirm({ title: deleteTitle(alert.name), onConfirm: () => deleteMutation.mutate(alert.id) })}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                {openHistory === alert.id ? <AlertHistory insightId={insight.id} alertId={alert.id} /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {patchMutation.error ? (
        <p className="text-danger" role="alert">
          {(patchMutation.error as Error).message}
        </p>
      ) : null}
      {creating ? <AlertFormDialog insight={insight} onClose={() => setCreating(false)} /> : null}
    </section>
  );
}
