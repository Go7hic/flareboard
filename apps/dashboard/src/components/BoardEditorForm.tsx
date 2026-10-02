import { FormEvent, useState } from 'react';
import { ArrowDown, ArrowUp, ChartLine, Globe, X } from 'lucide-react';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { boardWidgetSizeLabel } from './BoardWidgets';
import {
  BOARD_RANGE_PRESET_OPTIONS,
  BOARD_WIDGET_SIZES,
  createBoardParameters,
  emptyInsightWidgetDraft,
  emptyStatsWidgetDraft,
  type BoardRangePreset,
  type BoardWidgetDraft,
  type BoardWidgetWidth,
  normalizeBoardRangePreset,
  normalizeBoardWidgetWidth,
} from '../lib/board-config';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import type { Insight, Website } from '../lib/api';
import { t } from '../lib/i18n';

type BoardEditorFormProps = {
  websites: Website[];
  insights?: Insight[];
  initialName: string;
  initialWidgets: BoardWidgetDraft[];
  initialRangePreset?: BoardRangePreset;
  /** Board filters are edited on the board itself; the form keeps them unchanged. */
  initialFilters?: PropertyFilter[];
  submitLabel: string;
  onSubmit: (payload: { name: string; parameters: Record<string, unknown> }) => void;
  onCancel?: () => void;
  isPending?: boolean;
  /** Server error from the parent's mutation, shown above the footer. */
  error?: string | null;
};

function websiteLabel(w: Website): string {
  return w.domain ? `${w.name} (${w.domain.replace(/^https?:\/\//, '')})` : w.name;
}

/**
 * Board name, default range and widgets. Shaped for a dialog: `.dialog-body` with the fields and
 * a sticky `.dialog-footer` with the actions (the parent renders the dialog header).
 */
export function BoardEditorForm({
  websites,
  insights = [],
  initialName,
  initialWidgets,
  initialRangePreset = '7d',
  initialFilters = [],
  submitLabel,
  onSubmit,
  onCancel,
  isPending,
  error,
}: BoardEditorFormProps) {
  const [name, setName] = useState(initialName);
  const [widgetDrafts, setWidgetDrafts] = useState<BoardWidgetDraft[]>(
    initialWidgets.length ? initialWidgets : [emptyStatsWidgetDraft()],
  );
  const [rangePreset, setRangePreset] = useState<BoardRangePreset>(initialRangePreset);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedJson, setAdvancedJson] = useState('');

  function validate(): { name: string; parameters: Record<string, unknown> } | null {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError(t('boardNameRequired'));
      return null;
    }
    if (!widgetDrafts.length) {
      setValidationError(t('boardWidgetsRequired'));
      return null;
    }
    if (widgetDrafts.some((d) => (d.type === 'stats' ? !d.websiteId : !d.insightId))) {
      setValidationError(t('boardWidgetWebsiteRequired'));
      return null;
    }
    setValidationError(null);
    return { name: trimmedName, parameters: createBoardParameters(widgetDrafts, rangePreset, initialFilters) };
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = validate();
    if (!payload) return;
    const widgets = payload.parameters.widgets;
    if (!Array.isArray(widgets) || widgets.length === 0) {
      setValidationError(t('boardWidgetsRequired'));
      return;
    }
    onSubmit(payload);
  }

  function removeWidget(index: number) {
    setWidgetDrafts((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function moveWidget(index: number, direction: -1 | 1) {
    setWidgetDrafts((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function updateWidget(index: number, widget: BoardWidgetDraft) {
    setWidgetDrafts((prev) => prev.map((w, i) => (i === index ? widget : w)));
  }

  function applyAdvancedJson() {
    try {
      const parsed = JSON.parse(advancedJson) as unknown;
      if (!Array.isArray(parsed)) {
        setValidationError(t('invalidBoardJson'));
        return;
      }
      const drafts: BoardWidgetDraft[] = [];
      for (const item of parsed) {
        if (
          typeof item !== 'object' ||
          item === null ||
          ((item as { type?: string }).type !== 'stats' && (item as { type?: string }).type !== 'insight')
        ) {
          setValidationError(t('invalidBoardJson'));
          return;
        }
        const row = item as {
          type: 'stats' | 'insight';
          websiteId?: string;
          insightId?: string;
          label?: string;
          width?: string;
        };
        if (row.type === 'stats' && typeof row.websiteId === 'string') {
          drafts.push({
            type: 'stats',
            websiteId: row.websiteId,
            label: typeof row.label === 'string' ? row.label : '',
            width: normalizeBoardWidgetWidth(row.width),
          });
        } else if (row.type === 'insight' && typeof row.insightId === 'string') {
          drafts.push({
            type: 'insight',
            insightId: row.insightId,
            label: typeof row.label === 'string' ? row.label : '',
            width: normalizeBoardWidgetWidth(row.width),
          });
        } else {
          setValidationError(t('invalidBoardJson'));
          return;
        }
      }
      if (!drafts.length) {
        setValidationError(t('boardWidgetsRequired'));
        return;
      }
      setWidgetDrafts(drafts);
      setValidationError(null);
    } catch {
      setValidationError(t('invalidBoardJson'));
    }
  }

  function openAdvanced() {
    setAdvancedJson(JSON.stringify(createBoardParameters(widgetDrafts, rangePreset).widgets ?? [], null, 2));
    setAdvancedOpen(true);
  }

  const noSources = !websites.length && !insights.length;

  return (
    <form className="ws-board-form" onSubmit={onFormSubmit}>
      <div className="dialog-body">
        <div className="ws-form-grid ws-board-form-head">
          <div className="field">
            <Label htmlFor="board-editor-name">{t('boardName')}</Label>
            <Input id="board-editor-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <Label htmlFor="board-range-preset">{t('boardRange')}</Label>
            <select
              id="board-range-preset"
              className="select"
              value={rangePreset}
              onChange={(e) => setRangePreset(normalizeBoardRangePreset(e.target.value))}
            >
              {BOARD_RANGE_PRESET_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`boardWidgetPeriod${option}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <section className="ws-board-widgets" aria-labelledby="board-editor-widgets">
          <div className="ws-board-widgets-head">
            <h3 id="board-editor-widgets" className="card-title">
              {t('boardWidgetsTitle')}
            </h3>
            <p className="card-description">{t('boardWidgetsLead')}</p>
          </div>

          {noSources ? (
            <p className="ws-muted-line">{t('boardNoWebsites')}</p>
          ) : (
            <ol className="ws-widget-rows">
              {widgetDrafts.map((w, index) => (
                <li key={index} className="ws-widget-row">
                  <span className="ws-q-letter" aria-hidden>
                    {index + 1}
                  </span>
                  <select
                    className="select ws-widget-row-type"
                    aria-label={t('type')}
                    value={w.type}
                    onChange={(e) =>
                      updateWidget(index, e.target.value === 'insight' ? emptyInsightWidgetDraft() : emptyStatsWidgetDraft())
                    }
                  >
                    <option value="stats">{t('boardWidgetStats')}</option>
                    <option value="insight">{t('insight')}</option>
                  </select>
                  {w.type === 'stats' ? (
                    <select
                      className="select ws-widget-row-source"
                      aria-label={t('widgetWebsite')}
                      value={w.websiteId}
                      onChange={(e) => updateWidget(index, { ...w, websiteId: e.target.value })}
                    >
                      <option value="">{t('selectWebsite')}</option>
                      {websites.map((site) => (
                        <option key={site.id} value={site.id}>
                          {websiteLabel(site)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      className="select ws-widget-row-source"
                      aria-label={t('insight')}
                      value={w.insightId}
                      onChange={(e) => updateWidget(index, { ...w, insightId: e.target.value })}
                    >
                      <option value="">{t('selectInsight')}</option>
                      {insights.map((insight) => (
                        <option key={insight.id} value={insight.id}>
                          {insight.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <Input
                    className="ws-widget-row-label"
                    aria-label={t('widgetLabel')}
                    value={w.label}
                    onChange={(e) => updateWidget(index, { ...w, label: e.target.value })}
                    placeholder={t('widgetLabelOptional')}
                  />
                  <select
                    className="select ws-widget-row-width"
                    aria-label={t('boardWidgetWidth')}
                    value={w.width}
                    onChange={(e) =>
                      updateWidget(index, { ...w, width: normalizeBoardWidgetWidth(e.target.value) as BoardWidgetWidth })
                    }
                  >
                    {BOARD_WIDGET_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {boardWidgetSizeLabel(size)}
                      </option>
                    ))}
                  </select>
                  <span className="ws-widget-row-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === 0}
                      onClick={() => moveWidget(index, -1)}
                      aria-label={t('moveWidgetUp')}
                      title={t('moveWidgetUp')}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === widgetDrafts.length - 1}
                      onClick={() => moveWidget(index, 1)}
                      aria-label={t('moveWidgetDown')}
                      title={t('moveWidgetDown')}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={widgetDrafts.length <= 1}
                      onClick={() => removeWidget(index)}
                      aria-label={t('removeWidget')}
                      title={t('removeWidget')}
                    >
                      <X aria-hidden />
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className="ws-board-widgets-add">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setWidgetDrafts((prev) => [...prev, emptyStatsWidgetDraft()])}
              disabled={!websites.length}
            >
              <Globe aria-hidden />
              {t('addWidget')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setWidgetDrafts((prev) => [...prev, emptyInsightWidgetDraft()])}
              disabled={!insights.length}
            >
              <ChartLine aria-hidden />
              {t('addInsightWidget')}
            </Button>
          </div>
        </section>

        <details
          className="ws-disclosure"
          open={advancedOpen}
          onToggle={(e) => {
            const open = (e.target as HTMLDetailsElement).open;
            setAdvancedOpen(open);
            if (open) openAdvanced();
          }}
        >
          <summary>{t('advancedJson')}</summary>
          <div className="ws-disclosure-body">
            <Textarea
              className="textarea-mono"
              value={advancedOpen ? advancedJson : ''}
              onChange={(e) => setAdvancedJson(e.target.value)}
              rows={6}
              spellCheck={false}
              aria-label={t('advancedJson')}
            />
            <div>
              <Button type="button" variant="outline" size="sm" onClick={applyAdvancedJson}>
                {t('applyJson')}
              </Button>
            </div>
          </div>
        </details>

        {validationError || error ? (
          <p className="text-danger" role="alert">
            {validationError ?? error}
          </p>
        ) : null}
      </div>

      <footer className="dialog-footer">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
            {t('cancel')}
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={isPending || noSources}>
          {submitLabel}
        </Button>
      </footer>
    </form>
  );
}
