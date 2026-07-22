import { FormEvent, useState } from 'react';
import {
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
  submitLabel: string;
  onSubmit: (payload: { name: string; parameters: Record<string, unknown> }) => void;
  onCancel?: () => void;
  isPending?: boolean;
};

function websiteLabel(w: Website): string {
  return w.domain ? `${w.name} (${w.domain})` : w.name;
}

export function BoardEditorForm({
  websites,
  insights = [],
  initialName,
  initialWidgets,
  initialRangePreset = '7d',
  submitLabel,
  onSubmit,
  onCancel,
  isPending,
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
    return { name: trimmedName, parameters: createBoardParameters(widgetDrafts, rangePreset) };
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

  function addWidget() {
    setWidgetDrafts((prev) => [...prev, emptyStatsWidgetDraft()]);
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

  function addInsightWidget() {
    setWidgetDrafts((prev) => [...prev, emptyInsightWidgetDraft()]);
  }

  function updateWidget(index: number, widget: BoardWidgetDraft) {
    setWidgetDrafts((prev) => prev.map((w, i) => (i === index ? widget : w)));
  }

  function updateWidgetLabel(index: number, label: string) {
    setWidgetDrafts((prev) => prev.map((w, i) => (i === index ? { ...w, label } : w)));
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

  return (
    <form className="board-editor-form" onSubmit={onFormSubmit}>
      <div className="field">
        <Label htmlFor="board-editor-name">{t('boardName')}</Label>
        <Input
          id="board-editor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('boardName')}
        />
      </div>

      <div className="board-widget-editor">
        <div className="board-widget-editor-head">
          <h3 className="section-title">{t('boardWidgetsTitle')}</h3>
          <p className="section-lead">{t('boardWidgetsLead')}</p>
        </div>

        <div className="field">
          <Label htmlFor="board-range-preset">{t('boardRange')}</Label>
          <select
            id="board-range-preset"
            className="select"
            value={rangePreset}
            onChange={(e) => setRangePreset(normalizeBoardRangePreset(e.target.value))}
          >
            <option value="24h">{t('boardWidgetPeriod24h')}</option>
            <option value="7d">{t('boardWidgetPeriod7d')}</option>
            <option value="30d">{t('boardWidgetPeriod30d')}</option>
            <option value="90d">{t('boardWidgetPeriod90d')}</option>
          </select>
        </div>

        {!websites.length && !insights.length ? (
          <p className="text-muted">{t('boardNoWebsites')}</p>
        ) : (
          <ul className="list-plain board-widget-rows">
            {widgetDrafts.map((w, index) => (
              <li key={index} className="board-widget-row">
                <div className="field">
                  <Label htmlFor={`board-widget-type-${index}`}>{t('type')}</Label>
                  <select
                    id={`board-widget-type-${index}`}
                    className="select"
                    value={w.type}
                    onChange={(e) =>
                      setWidgetDrafts((prev) =>
                        prev.map((item, i) =>
                          i === index
                            ? e.target.value === 'insight'
                              ? emptyInsightWidgetDraft()
                              : emptyStatsWidgetDraft()
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="stats">{t('boardWidgetStats')}</option>
                    <option value="insight">{t('insight')}</option>
                  </select>
                </div>
                <div className="field">
                  {w.type === 'stats' ? (
                    <>
                      <Label htmlFor={`board-widget-site-${index}`}>{t('widgetWebsite')}</Label>
                      <select
                        id={`board-widget-site-${index}`}
                        className="select"
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
                    </>
                  ) : (
                    <>
                      <Label htmlFor={`board-widget-insight-${index}`}>{t('insight')}</Label>
                      <select
                        id={`board-widget-insight-${index}`}
                        className="select"
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
                    </>
                  )}
                </div>
                <div className="field">
                  <Label htmlFor={`board-widget-label-${index}`}>{t('widgetLabel')}</Label>
                  <Input
                    id={`board-widget-label-${index}`}
                    value={w.label}
                    onChange={(e) => updateWidgetLabel(index, e.target.value)}
                    placeholder={t('widgetLabelOptional')}
                  />
                </div>
                <div className="field">
                  <Label htmlFor={`board-widget-width-${index}`}>{t('boardWidgetWidth')}</Label>
                  <select
                    id={`board-widget-width-${index}`}
                    className="select"
                    value={w.width}
                    onChange={(e) =>
                      updateWidget(index, {
                        ...w,
                        width: normalizeBoardWidgetWidth(e.target.value) as BoardWidgetWidth,
                      })
                    }
                  >
                    <option value="third">{t('boardWidgetWidthThird')}</option>
                    <option value="half">{t('boardWidgetWidthHalf')}</option>
                    <option value="full">{t('boardWidgetWidthFull')}</option>
                  </select>
                </div>
                <div className="board-widget-row-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={index === 0}
                    onClick={() => moveWidget(index, -1)}
                    aria-label={t('moveWidgetUp')}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={index === widgetDrafts.length - 1}
                    onClick={() => moveWidget(index, 1)}
                    aria-label={t('moveWidgetDown')}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={widgetDrafts.length <= 1}
                    onClick={() => removeWidget(index)}
                  >
                    {t('removeWidget')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={addWidget}
          disabled={!websites.length}
        >
          {t('addWidget')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={addInsightWidget}
          disabled={!insights.length}
        >
          {t('addInsightWidget')}
        </Button>
      </div>

      <details
        className="board-advanced-json"
        open={advancedOpen}
        onToggle={(e) => {
          const open = (e.target as HTMLDetailsElement).open;
          setAdvancedOpen(open);
          if (open) openAdvanced();
        }}
      >
        <summary>{t('advancedJson')}</summary>
        <div className="field">
          <Textarea
            className="textarea-mono"
            value={advancedOpen ? advancedJson : ''}
            onChange={(e) => setAdvancedJson(e.target.value)}
            rows={6}
            spellCheck={false}
          />
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={applyAdvancedJson}>
          {t('applyJson')}
        </Button>
      </details>

      {validationError ? <p className="text-danger">{validationError}</p> : null}

      <div className="board-editor-actions">
        <Button type="submit" variant="primary" disabled={isPending || (!websites.length && !insights.length)}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
            {t('cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
