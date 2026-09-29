import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InsightQuery } from '@flareboard/shared/insight-query';
import { ModalDialog } from './ModalDialog';
import { deleteTitle, useConfirm } from './ConfirmDialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import {
  api,
  type Insight,
  type InsightAlert,
  type InsightAlertCheck,
  type InsightAlertCondition,
} from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
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

function StateBadge({ alert }: { alert: InsightAlert }) {
  if (!alert.enabled) return <Badge variant="outline">{t('insightAlertDisabled')}</Badge>;
  if (alert.snoozedUntil && alert.snoozedUntil > Date.now()) return <Badge variant="secondary">{t('insightAlertSnoozed')}</Badge>;
  if (alert.lastState === 'firing') return <Badge variant="destructive">{t('insightAlertFiring')}</Badge>;
  if (alert.lastState === 'error') return <Badge variant="warning">{t('insightAlertErrored')}</Badge>;
  if (alert.lastState === 'ok') return <Badge variant="outline">{t('insightAlertOk')}</Badge>;
  return <Badge variant="outline">{t('insightAlertPending')}</Badge>;
}

function AlertHistory({ insightId, alertId }: { insightId: string; alertId: string }) {
  const history = useQuery({
    queryKey: ['insight-alert-history', alertId],
    queryFn: () => api<{ checks: InsightAlertCheck[] }>(`/api/insights/${insightId}/alerts/${alertId}/history`),
  });
  const checks = history.data?.checks ?? [];
  if (history.isLoading) return <div className="skeleton" style={{ height: '1.5rem' }} />;
  if (!checks.length) return <p className="text-muted">{t('insightAlertNoChecks')}</p>;
  return (
    <div className="table-scroll">
      <table className="data-table insight-alert-history">
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
              <td>{formatDateTime(check.intervalStart)}</td>
              <td className="num">{check.value == null ? '-' : formatNumber(check.value, { maximumFractionDigits: 2 })}</td>
              <td className="num">
                {check.previousValue == null ? '-' : formatNumber(check.previousValue, { maximumFractionDigits: 2 })}
              </td>
              <td>
                {check.state === 'firing'
                  ? `${t('insightAlertFiring')}${check.delivered ? ` · ${t('insightAlertDelivered')}` : ''}`
                  : check.state === 'error'
                    ? `${t('insightAlertErrored')}${check.error ? `: ${check.error}` : ''}`
                    : t('insightAlertOk')}
                {check.state === 'firing' && !check.delivered && check.error ? ` · ${check.error}` : ''}
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
    <ModalDialog className="insight-alert-dialog" aria-label={t('insightAlertNew')} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{t('insightAlertNew')}</h2>
        <p className="text-muted">{t('insightAlertLead')}</p>
      </header>
      <div className="dialog-body">
        <div className="field">
          <Label htmlFor="alert-name">{t('name')}</Label>
          <Input id="alert-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="insight-alert-grid">
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
        <p className="text-muted field-hint">{t('insightAlertEvaluationHint')}</p>
        {createMutation.error ? <p className="text-danger">{(createMutation.error as Error).message}</p> : null}
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
    <section className="detail-section insight-alerts-panel">
      <div className="panel-header compact-panel-header">
        <div>
          <h3 className="section-title">{t('insightAlerts')}</h3>
          <p className="text-muted">{t('insightAlertsLead')}</p>
        </div>
        {canEdit ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setCreating(true)}>
            {t('insightAlertNew')}
          </Button>
        ) : null}
      </div>
      {alertsQuery.isLoading ? <div className="skeleton" style={{ height: '2rem' }} /> : null}
      {!alertsQuery.isLoading && !alerts.length ? <p className="text-muted">{t('insightAlertsEmpty')}</p> : null}
      <ul className="list-plain insight-alert-list">
        {alerts.map((alert) => {
          const snoozed = Boolean(alert.snoozedUntil && alert.snoozedUntil > Date.now());
          return (
            <li key={alert.id} className="insight-alert-row">
              <div className="insight-alert-row-head">
                <div className="insight-alert-row-main">
                  <span className="insight-alert-row-title">
                    <strong>{alert.name}</strong> <StateBadge alert={alert} />
                  </span>
                  <span className="text-muted">
                    {conditionText(alert)} · {alert.channel === 'email' ? t('email') : t('webhook')}: {alert.target}
                  </span>
                  {snoozed ? (
                    <span className="text-muted">{t('insightAlertSnoozedUntil').replace('{date}', formatDateTime(alert.snoozedUntil))}</span>
                  ) : null}
                </div>
                <div className="insight-alert-row-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={openHistory === alert.id}
                    onClick={() => setOpenHistory(openHistory === alert.id ? null : alert.id)}
                  >
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
                          className="select insight-alert-snooze"
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
                        size="sm"
                        onClick={() => confirm({ title: deleteTitle(alert.name), onConfirm: () => deleteMutation.mutate(alert.id) })}
                      >
                        {t('delete')}
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
      {patchMutation.error ? <p className="text-danger">{(patchMutation.error as Error).message}</p> : null}
      {creating ? <AlertFormDialog insight={insight} onClose={() => setCreating(false)} /> : null}
    </section>
  );
}
