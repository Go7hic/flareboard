import { Plus } from 'lucide-react';
import { EventCatalogPicker } from './EventCatalogPicker';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import type { ExperimentMetric, ExperimentMetricType } from '../lib/api';
import { t } from '../lib/i18n';

export const MAX_SECONDARY_METRICS = 5;
export const DEFAULT_MDE_PERCENT = 10;

const METRIC_TYPES: ExperimentMetricType[] = ['conversion', 'count', 'property_sum', 'property_mean'];

export function isPropertyMetric(type: ExperimentMetricType) {
  return type === 'property_sum' || type === 'property_mean';
}

export function emptyMetric(): ExperimentMetric {
  return { type: 'conversion', event: '' };
}

export function isMetricComplete(metric: ExperimentMetric) {
  return Boolean(metric.event.trim()) && (!isPropertyMetric(metric.type) || Boolean(metric.property?.trim()));
}

/** Trimmed metric in the shape the API stores. */
export function cleanMetric(metric: ExperimentMetric): ExperimentMetric {
  return {
    type: metric.type,
    event: metric.event.trim(),
    ...(isPropertyMetric(metric.type) ? { property: metric.property?.trim() ?? '' } : {}),
  };
}

/** "Conversion · purchase", "Sum of revenue · purchase", … */
export function metricLabel(metric: ExperimentMetric) {
  if (metric.name) return metric.name;
  const kind = t(`experimentMetricType_${metric.type}`);
  if (isPropertyMetric(metric.type)) {
    return `${kind.replace('{property}', metric.property ?? '')} · ${metric.event}`;
  }
  return `${kind} · ${metric.event}`;
}

function MetricFields({
  websiteId,
  idPrefix,
  metric,
  onChange,
  onRemove,
}: {
  websiteId: string | undefined;
  idPrefix: string;
  metric: ExperimentMetric;
  onChange: (metric: ExperimentMetric) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="experiment-metric-fields">
      <div className="field">
        <Label htmlFor={`${idPrefix}-type`}>{t('experimentMetricTypeLabel')}</Label>
        <select
          id={`${idPrefix}-type`}
          className="select"
          value={metric.type}
          onChange={(event) => onChange({ ...metric, type: event.target.value as ExperimentMetricType })}
        >
          {METRIC_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`experimentMetricTypeOption_${type}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <Label htmlFor={`${idPrefix}-event`}>{t('experimentMetricEvent')}</Label>
        <EventCatalogPicker
          mode="single"
          websiteId={websiteId}
          id={`${idPrefix}-event`}
          value={metric.event}
          onChange={(event) => onChange({ ...metric, event })}
          placeholder="checkout_completed"
        />
      </div>
      {isPropertyMetric(metric.type) ? (
        <div className="field">
          <Label htmlFor={`${idPrefix}-property`}>{t('experimentMetricProperty')}</Label>
          <Input
            id={`${idPrefix}-property`}
            value={metric.property ?? ''}
            placeholder="revenue"
            onChange={(event) => onChange({ ...metric, property: event.target.value })}
          />
        </div>
      ) : null}
      {onRemove ? (
        <div className="experiment-metric-remove">
          <Button type="button" variant="destructive-ghost" size="sm" onClick={onRemove}>
            {t('remove')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ExperimentMetricsEditor({
  websiteId,
  idPrefix,
  primary,
  secondary,
  minimumDetectableEffect,
  onPrimaryChange,
  onSecondaryChange,
  onMinimumDetectableEffectChange,
}: {
  websiteId: string | undefined;
  idPrefix: string;
  primary: ExperimentMetric;
  secondary: ExperimentMetric[];
  /** Percent as typed; empty uses the default. */
  minimumDetectableEffect: string;
  onPrimaryChange: (metric: ExperimentMetric) => void;
  onSecondaryChange: (metrics: ExperimentMetric[]) => void;
  onMinimumDetectableEffectChange: (value: string) => void;
}) {
  return (
    <div className="experiment-metrics-editor">
      <fieldset className="experiment-metric-group">
        <legend className="experiment-metric-legend">{t('experimentPrimaryMetric')}</legend>
        <MetricFields websiteId={websiteId} idPrefix={`${idPrefix}-primary`} metric={primary} onChange={onPrimaryChange} />
        <div className="field experiment-mde-field">
          <Label htmlFor={`${idPrefix}-mde`}>{t('experimentMdeLabel')}</Label>
          <Input
            id={`${idPrefix}-mde`}
            type="number"
            inputMode="decimal"
            min={0.1}
            max={100}
            step={0.5}
            value={minimumDetectableEffect}
            placeholder={String(DEFAULT_MDE_PERCENT)}
            onChange={(event) => onMinimumDetectableEffectChange(event.target.value)}
          />
          <p className="field-hint">{t('experimentMdeHint')}</p>
        </div>
      </fieldset>
      <fieldset className="experiment-metric-group">
        <legend className="experiment-metric-legend">
          {t('experimentSecondaryMetrics')}{' '}
          <span className="text-muted">
            {secondary.length}/{MAX_SECONDARY_METRICS}
          </span>
        </legend>
        {secondary.map((metric, index) => (
          <MetricFields
            key={index}
            websiteId={websiteId}
            idPrefix={`${idPrefix}-secondary-${index}`}
            metric={metric}
            onChange={(next) => onSecondaryChange(secondary.map((item, i) => (i === index ? next : item)))}
            onRemove={() => onSecondaryChange(secondary.filter((_, i) => i !== index))}
          />
        ))}
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={secondary.length >= MAX_SECONDARY_METRICS}
            onClick={() => onSecondaryChange([...secondary, emptyMetric()])}
          >
            <Plus size={14} strokeWidth={2} aria-hidden />
            {t('experimentAddSecondaryMetric')}
          </Button>
        </div>
      </fieldset>
    </div>
  );
}

/** Parses the MDE input: empty → null (server default), otherwise a percent in (0, 100]. */
export function parseMdeInput(value: string): number | null | 'invalid' {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.1 || parsed > 100) return 'invalid';
  return parsed;
}
