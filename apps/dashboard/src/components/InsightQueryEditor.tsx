import { useId, useState, type ReactNode } from 'react';
import { ListFilter, Plus, X } from 'lucide-react';
import {
  FUNNEL_WINDOW_UNITS,
  INSIGHT_DIMENSIONS,
  INSIGHT_INTERVALS,
  INSIGHT_MATHS,
  MAX_FUNNEL_STEPS,
  MAX_INSIGHT_SERIES,
  MAX_RETENTION_PERIODS,
  parseFormula,
  PROPERTY_MATHS,
  type InsightBreakdown,
  type InsightEvent,
  type InsightQuery,
  type InsightSeries,
  type InsightType,
  type PropertyFilter,
} from '@flareboard/shared/insight-query';
import { EventCatalogPicker } from './EventCatalogPicker';
import { dimensionLabel, filterTypeLabel, PropertyFilterBuilder, usePropertyKeys } from './PropertyFilterBuilder';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { t } from '../lib/i18n';

const LETTERS = 'ABCDE';

type EventLike = InsightEvent | InsightSeries;

/** Labelled block of the query card (series, steps, filters…). */
function Section({ label, children, htmlFor }: { label: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="ws-q-section">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="ws-q-label">
          {label}
        </Label>
      ) : (
        <span className="ws-q-label">{label}</span>
      )}
      {children}
    </div>
  );
}

/** One option in the options grid under the series/steps. */
function Option({ label, htmlFor, children, hint }: { label: ReactNode; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field ws-q-option">
      {htmlFor ? <Label htmlFor={htmlFor}>{label}</Label> : <span className="field-label">{label}</span>}
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

/**
 * Event / pageview picker with URL match and per-event property filters. `trailing` adds
 * controls to the same row (the series math).
 */
function EventEditor<T extends EventLike>({
  websiteId,
  value,
  onChange,
  rangeQs,
  allowAll = false,
  idPrefix,
  trailing,
}: {
  websiteId: string;
  value: T;
  onChange: (next: T) => void;
  rangeQs: string;
  allowAll?: boolean;
  idPrefix: string;
  trailing?: ReactNode;
}) {
  const [showFilters, setShowFilters] = useState(Boolean(value.filters?.length));
  const filterCount = value.filters?.length ?? 0;
  return (
    <div className="ws-q-event">
      <div className="ws-q-controls">
        <select
          className="select"
          aria-label={t('insightEventKind')}
          value={value.kind}
          onChange={(event) => {
            const kind = event.target.value as InsightEvent['kind'];
            onChange({ ...value, kind, event: kind === 'event' ? value.event : null, url: kind === 'pageview' ? value.url : null });
          }}
        >
          <option value="event">{t('insightKindEvent')}</option>
          <option value="pageview">{t('insightKindPageview')}</option>
          {allowAll ? <option value="all">{t('insightKindAll')}</option> : null}
        </select>
        {value.kind === 'event' ? (
          <EventCatalogPicker
            mode="single"
            websiteId={websiteId}
            id={`${idPrefix}-event`}
            className="ws-q-grow"
            value={value.event ?? ''}
            onChange={(name) => onChange({ ...value, event: name || null })}
            placeholder={t('insightAnyEventPlaceholder')}
            allowEmpty
          />
        ) : null}
        {value.kind === 'pageview' ? (
          <>
            <select
              className="select"
              aria-label={t('insightUrlMatch')}
              value={value.url?.match ?? 'any'}
              onChange={(event) => {
                const match = event.target.value;
                onChange({
                  ...value,
                  url: match === 'any' ? null : { match: match as 'exact' | 'contains' | 'regex', value: value.url?.value ?? '' },
                });
              }}
            >
              <option value="any">{t('insightUrlAny')}</option>
              <option value="exact">{t('insightUrlExact')}</option>
              <option value="contains">{t('insightUrlContains')}</option>
              <option value="regex">{t('insightUrlRegex')}</option>
            </select>
            {value.url ? (
              <Input
                aria-label={t('insightUrlValue')}
                className="ws-q-grow"
                placeholder={value.url.match === 'regex' ? '^/blog/.*' : '/pricing'}
                value={value.url.value}
                onChange={(event) => onChange({ ...value, url: { match: value.url!.match, value: event.target.value } })}
              />
            ) : null}
          </>
        ) : null}
        {trailing}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ws-q-where"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
        >
          <ListFilter aria-hidden />
          {filterCount ? `${t('insightWhere').replace(/…$/, '')} (${filterCount})` : t('insightWhere')}
        </Button>
      </div>
      {showFilters ? (
        <div className="ws-q-filters">
          <PropertyFilterBuilder
            websiteId={websiteId}
            rangeQs={rangeQs}
            value={value.filters ?? []}
            onChange={(filters) => onChange({ ...value, filters })}
          />
        </div>
      ) : null}
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" className="ws-q-remove" aria-label={label} title={label} onClick={onClick}>
      <X aria-hidden />
    </Button>
  );
}

function SeriesEditor({
  websiteId,
  series,
  onChange,
  rangeQs,
  max,
}: {
  websiteId: string;
  series: InsightSeries[];
  onChange: (next: InsightSeries[]) => void;
  rangeQs: string;
  max: number;
}) {
  const numericKeys = usePropertyKeys(websiteId, 'event', rangeQs);
  const listId = useId();
  return (
    <div className="ws-q-rows">
      <datalist id={listId}>
        {(numericKeys.data ?? [])
          .filter((row) => row.numeric)
          .map((row) => (
            <option key={row.key} value={row.key} />
          ))}
      </datalist>
      {series.map((item, index) => (
        <div key={index} className="ws-q-row">
          {max > 1 ? (
            <span className="ws-q-letter" aria-hidden>
              {LETTERS[index]}
            </span>
          ) : null}
          <EventEditor
            websiteId={websiteId}
            rangeQs={rangeQs}
            idPrefix={`series-${index}`}
            value={item}
            onChange={(next) => onChange(series.map((s, i) => (i === index ? next : s)))}
            trailing={
              max > 1 ? (
                <>
                  <select
                    className="select"
                    aria-label={t('insightMath')}
                    value={item.math}
                    onChange={(event) => {
                      const math = event.target.value as InsightSeries['math'];
                      onChange(series.map((s, i) => (i === index ? { ...s, math } : s)));
                    }}
                  >
                    {INSIGHT_MATHS.map((math) => (
                      <option key={math} value={math}>
                        {t(`insightMath_${math}`)}
                      </option>
                    ))}
                  </select>
                  {PROPERTY_MATHS.includes(item.math) ? (
                    <Input
                      className="ws-q-property"
                      aria-label={t('insightMathProperty')}
                      placeholder={t('insightMathProperty')}
                      list={listId}
                      value={item.mathProperty ?? ''}
                      onChange={(event) =>
                        onChange(series.map((s, i) => (i === index ? { ...s, mathProperty: event.target.value } : s)))
                      }
                    />
                  ) : null}
                </>
              ) : null
            }
          />
          {series.length > 1 ? (
            <RemoveButton label={t('insightRemoveSeries')} onClick={() => onChange(series.filter((_, i) => i !== index))} />
          ) : null}
        </div>
      ))}
      {series.length < max ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ws-q-add"
            onClick={() => onChange([...series, { kind: 'event', event: null, math: 'total' }])}
          >
            <Plus aria-hidden />
            {t('insightAddSeries')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function BreakdownPicker({
  websiteId,
  value,
  onChange,
  rangeQs,
  id,
}: {
  websiteId: string;
  value: InsightBreakdown | null | undefined;
  onChange: (next: InsightBreakdown | null) => void;
  rangeQs: string;
  id: string;
}) {
  const listId = useId();
  const keys = usePropertyKeys(websiteId, value?.type === 'person' ? 'person' : 'event', rangeQs);
  return (
    <div className="ws-q-controls">
      <select
        id={id}
        className="select"
        aria-label={t('insightBreakdown')}
        value={value?.type ?? 'none'}
        onChange={(event) => {
          const type = event.target.value;
          if (type === 'none') onChange(null);
          else onChange({ type: type as InsightBreakdown['type'], key: type === 'dimension' ? 'country' : '' });
        }}
      >
        <option value="none">{t('insightBreakdownNoneOption')}</option>
        <option value="event">{filterTypeLabel('event')}</option>
        <option value="person">{filterTypeLabel('person')}</option>
        <option value="dimension">{filterTypeLabel('dimension')}</option>
      </select>
      {value?.type === 'dimension' ? (
        <select
          className="select"
          aria-label={t('propertyFilterKey')}
          value={value.key}
          onChange={(event) => onChange({ ...value, key: event.target.value })}
        >
          {INSIGHT_DIMENSIONS.map((dimension) => (
            <option key={dimension} value={dimension}>
              {dimensionLabel(dimension)}
            </option>
          ))}
        </select>
      ) : value ? (
        <>
          <Input
            className="ws-q-grow"
            aria-label={t('propertyFilterKey')}
            placeholder={t('propertyFilterKeyPlaceholder')}
            list={listId}
            value={value.key}
            onChange={(event) => onChange({ ...value, key: event.target.value })}
          />
          <datalist id={listId}>
            {(keys.data ?? []).map((row) => (
              <option key={row.key} value={row.key} />
            ))}
          </datalist>
        </>
      ) : null}
    </div>
  );
}

function CountBySelect({ value, onChange, id }: { value: InsightQuery['countBy']; onChange: (v: 'person' | 'session') => void; id: string }) {
  return (
    <Option label={t('insightCountBy')} htmlFor={id}>
      <select id={id} className="select" value={value ?? 'person'} onChange={(event) => onChange(event.target.value as 'person' | 'session')}>
        <option value="person">{t('insightCountPeople')}</option>
        <option value="session">{t('insightCountSessions')}</option>
      </select>
    </Option>
  );
}

function IntervalSelect({ value, onChange, id }: { value: InsightQuery['interval']; onChange: (v: InsightQuery['interval']) => void; id: string }) {
  return (
    <Option label={t('insightInterval')} htmlFor={id}>
      <select id={id} className="select" value={value ?? 'day'} onChange={(event) => onChange(event.target.value as InsightQuery['interval'])}>
        {INSIGHT_INTERVALS.map((interval) => (
          <option key={interval} value={interval}>
            {t(`insightInterval_${interval}`)}
          </option>
        ))}
      </select>
    </Option>
  );
}

/** Problems that block preview / save, shown under the editor. */
export function insightQueryProblem(type: InsightType, query: InsightQuery): string | null {
  if (type === 'trend' || type === 'lifecycle' || type === 'stickiness') {
    for (const series of query.series ?? []) {
      if (PROPERTY_MATHS.includes(series.math) && !series.mathProperty?.trim()) return t('insightNeedsMathProperty');
      if (series.kind === 'pageview' && series.url && !series.url.value.trim()) return t('insightNeedsUrl');
    }
  }
  if (type === 'trend' && query.formula?.trim()) {
    const parsed = parseFormula(query.formula, Math.max(query.series?.length ?? 1, 1));
    if (!parsed.ok) return `${t('insightFormula')}: ${parsed.reason}`;
  }
  if (type === 'funnel') {
    const steps = query.funnel?.steps ?? [];
    if (steps.length < 2) return t('insightFunnelNeedsSteps');
    if (steps.some((step) => step.kind === 'pageview' && step.url && !step.url.value.trim())) return t('insightNeedsUrl');
  }
  if (query.breakdown && !query.breakdown.key.trim()) return t('insightNeedsBreakdownKey');
  return null;
}

/**
 * The query part of the insight editor: series / steps / events first, then the options grid,
 * then global filters. Compact controls (one query card, no nested boxes).
 */
export function InsightQueryEditor({
  websiteId,
  type,
  query,
  onChange,
  rangeQs,
}: {
  websiteId: string;
  type: InsightType;
  query: InsightQuery;
  onChange: (next: InsightQuery) => void;
  rangeQs: string;
}) {
  const id = useId();
  const set = (patch: Partial<InsightQuery>) => onChange({ ...query, ...patch });
  const series = query.series?.length ? query.series : [{ kind: 'event' as const, event: null, math: 'total' as const }];
  const steps: InsightEvent[] = query.funnel?.steps?.length
    ? query.funnel.steps
    : [
        { kind: 'pageview' },
        { kind: 'event', event: null },
      ];

  const filtersSection = (
    <Section label={t('insightFilters')}>
      <PropertyFilterBuilder
        websiteId={websiteId}
        rangeQs={rangeQs}
        value={query.filters ?? []}
        onChange={(filters: PropertyFilter[]) => set({ filters })}
      />
    </Section>
  );

  if (type === 'trend') {
    const formulaProblem = query.formula?.trim() ? parseFormula(query.formula, series.length) : null;
    return (
      <div className="ws-q-editor">
        <Section label={t('insightSeries')}>
          <SeriesEditor websiteId={websiteId} rangeQs={rangeQs} series={series} max={MAX_INSIGHT_SERIES} onChange={(next) => set({ series: next })} />
        </Section>
        <div className="ws-q-options">
          <Option label={t('insightFormula')} htmlFor={`${id}-formula`} hint={t('insightFormulaHint')}>
            <Input
              id={`${id}-formula`}
              placeholder="A / B * 100"
              value={query.formula ?? ''}
              onChange={(event) => set({ formula: event.target.value || null })}
              aria-invalid={formulaProblem && !formulaProblem.ok ? true : undefined}
            />
          </Option>
          <IntervalSelect id={`${id}-interval`} value={query.interval} onChange={(interval) => set({ interval })} />
          <Option label={t('insightBreakdown')} htmlFor={`${id}-breakdown`}>
            <BreakdownPicker
              id={`${id}-breakdown`}
              websiteId={websiteId}
              rangeQs={rangeQs}
              value={query.breakdown}
              onChange={(breakdown) => set({ breakdown })}
            />
          </Option>
          <Option label={t('workspaceCompareLabel')}>
            <label className="ws-q-check">
              <Checkbox checked={Boolean(query.compare)} onCheckedChange={(checked) => set({ compare: Boolean(checked) })} />
              {t('insightCompare')}
            </label>
          </Option>
        </div>
        {filtersSection}
      </div>
    );
  }

  if (type === 'funnel') {
    const funnel = query.funnel ?? { steps };
    const window = funnel.window ?? { value: 14, unit: 'day' as const };
    const setFunnel = (patch: Partial<NonNullable<InsightQuery['funnel']>>) =>
      set({ funnel: { ...funnel, steps: funnel.steps?.length ? funnel.steps : steps, ...patch } });
    return (
      <div className="ws-q-editor">
        <Section label={t('insightSteps')}>
          <div className="ws-q-rows">
            {steps.map((step, index) => (
              <div key={index} className="ws-q-row">
                <span className="ws-q-letter" aria-hidden>
                  {index + 1}
                </span>
                <EventEditor
                  websiteId={websiteId}
                  rangeQs={rangeQs}
                  idPrefix={`step-${index}`}
                  value={step}
                  onChange={(next) => setFunnel({ steps: steps.map((s, i) => (i === index ? next : s)) })}
                />
                {steps.length > 2 ? (
                  <RemoveButton label={t('insightRemoveStep')} onClick={() => setFunnel({ steps: steps.filter((_, i) => i !== index) })} />
                ) : null}
              </div>
            ))}
            {steps.length < MAX_FUNNEL_STEPS ? (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ws-q-add"
                  onClick={() => setFunnel({ steps: [...steps, { kind: 'event', event: null }] })}
                >
                  <Plus aria-hidden />
                  {t('insightAddStep')}
                </Button>
              </div>
            ) : null}
          </div>
        </Section>
        <div className="ws-q-options">
          <Option label={t('insightConversionWindow')} htmlFor={`${id}-window`}>
            <div className="ws-q-controls ws-q-controls--nowrap">
              <Input
                id={`${id}-window`}
                type="number"
                min={1}
                className="ws-q-number"
                value={String(window.value)}
                onChange={(event) =>
                  setFunnel({ window: { ...window, value: Math.max(1, Math.floor(Number(event.target.value) || 1)) } })
                }
              />
              <select
                className="select ws-q-grow"
                aria-label={t('insightConversionWindowUnit')}
                value={window.unit}
                onChange={(event) => setFunnel({ window: { ...window, unit: event.target.value as typeof window.unit } })}
              >
                {FUNNEL_WINDOW_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {t(`insightWindowUnit_${unit}`)}
                  </option>
                ))}
              </select>
            </div>
          </Option>
          <Option label={t('insightStepOrder')} htmlFor={`${id}-order`}>
            <select
              id={`${id}-order`}
              className="select"
              value={funnel.order ?? 'strict'}
              onChange={(event) => setFunnel({ order: event.target.value as 'strict' | 'any' })}
            >
              <option value="strict">{t('insightOrderStrict')}</option>
              <option value="any">{t('insightOrderAny')}</option>
            </select>
          </Option>
          <CountBySelect id={`${id}-count`} value={query.countBy} onChange={(countBy) => set({ countBy })} />
          <Option label={t('insightBreakdown')} htmlFor={`${id}-breakdown`}>
            <BreakdownPicker
              id={`${id}-breakdown`}
              websiteId={websiteId}
              rangeQs={rangeQs}
              value={query.breakdown}
              onChange={(breakdown) => set({ breakdown })}
            />
          </Option>
        </div>
        {filtersSection}
      </div>
    );
  }

  if (type === 'retention') {
    const retention = query.retention ?? {};
    const startEvent: InsightEvent = retention.startEvent ?? { kind: 'pageview' };
    const returnEvent: InsightEvent = retention.returnEvent ?? startEvent;
    const setRetention = (patch: Partial<NonNullable<InsightQuery['retention']>>) =>
      set({ retention: { startEvent, returnEvent, ...retention, ...patch } });
    return (
      <div className="ws-q-editor">
        <Section label={t('insightRetentionStart')}>
          <EventEditor websiteId={websiteId} rangeQs={rangeQs} idPrefix="retention-start" value={startEvent} onChange={(next) => setRetention({ startEvent: next })} />
        </Section>
        <Section label={t('insightRetentionReturn')}>
          <EventEditor websiteId={websiteId} rangeQs={rangeQs} idPrefix="retention-return" value={returnEvent} onChange={(next) => setRetention({ returnEvent: next })} />
        </Section>
        <div className="ws-q-options">
          <Option label={t('insightPeriod')} htmlFor={`${id}-period`}>
            <select
              id={`${id}-period`}
              className="select"
              value={retention.period ?? 'week'}
              onChange={(event) => setRetention({ period: event.target.value as 'day' | 'week' | 'month' })}
            >
              <option value="day">{t('insightInterval_day')}</option>
              <option value="week">{t('insightInterval_week')}</option>
              <option value="month">{t('insightInterval_month')}</option>
            </select>
          </Option>
          <Option label={t('insightPeriods')} htmlFor={`${id}-periods`}>
            <select
              id={`${id}-periods`}
              className="select"
              value={retention.periods ?? 8}
              onChange={(event) => setRetention({ periods: Number(event.target.value) })}
            >
              {Array.from({ length: MAX_RETENTION_PERIODS - 7 }, (_, i) => i + 8).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Option>
          <CountBySelect id={`${id}-count`} value={query.countBy} onChange={(countBy) => set({ countBy })} />
        </div>
        {filtersSection}
      </div>
    );
  }

  if (type === 'lifecycle' || type === 'stickiness') {
    return (
      <div className="ws-q-editor">
        <Section label={t('event')}>
          <SeriesEditor websiteId={websiteId} rangeQs={rangeQs} series={series.slice(0, 1)} max={1} onChange={(next) => set({ series: next })} />
        </Section>
        <div className="ws-q-options">
          {type === 'lifecycle' ? (
            <IntervalSelect id={`${id}-interval`} value={query.interval} onChange={(interval) => set({ interval })} />
          ) : null}
          <CountBySelect id={`${id}-count`} value={query.countBy} onChange={(countBy) => set({ countBy })} />
        </div>
        {filtersSection}
      </div>
    );
  }

  if (type === 'path') {
    return (
      <div className="ws-q-editor">
        <div className="ws-q-options">
          <Option label={t('insightPathPrefix')} htmlFor={`${id}-path`}>
            <Input
              id={`${id}-path`}
              value={query.path?.steps?.[0] ?? ''}
              onChange={(event) => set({ path: { ...query.path, steps: event.target.value.trim() ? [event.target.value] : [] } })}
              placeholder="/pricing"
            />
          </Option>
        </div>
        {filtersSection}
      </div>
    );
  }

  return (
    <div className="ws-q-editor">
      <div className="ws-q-options">
        <Option label={t('dimension')} htmlFor={`${id}-dimension`}>
          <select
            id={`${id}-dimension`}
            className="select"
            value={query.table?.dimension ?? 'path'}
            onChange={(event) =>
              set({ table: { ...query.table, dimension: event.target.value as NonNullable<InsightQuery['table']>['dimension'] } })
            }
          >
            <option value="path">{t('page')}</option>
            <option value="event">{t('event')}</option>
            <option value="browser">{t('browser')}</option>
            <option value="country">{t('country')}</option>
            <option value="channel">{t('overviewTabChannel')}</option>
          </select>
        </Option>
      </div>
    </div>
  );
}
