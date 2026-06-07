import { FormEvent, useState } from 'react';
import {
  draftsToBoardParameters,
  emptyStatsWidgetDraft,
  type StatsWidgetDraft,
} from './BoardWidgets';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import type { Website } from '../lib/api';
import { t } from '../lib/i18n';

type BoardEditorFormProps = {
  websites: Website[];
  initialName: string;
  initialWidgets: StatsWidgetDraft[];
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
  initialName,
  initialWidgets,
  submitLabel,
  onSubmit,
  onCancel,
  isPending,
}: BoardEditorFormProps) {
  const [name, setName] = useState(initialName);
  const [widgetDrafts, setWidgetDrafts] = useState<StatsWidgetDraft[]>(
    initialWidgets.length ? initialWidgets : [emptyStatsWidgetDraft()],
  );
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
    if (widgetDrafts.some((d) => !d.websiteId)) {
      setValidationError(t('boardWidgetWebsiteRequired'));
      return null;
    }
    setValidationError(null);
    return { name: trimmedName, parameters: draftsToBoardParameters(widgetDrafts) };
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

  function updateWidget(index: number, patch: Partial<StatsWidgetDraft>) {
    setWidgetDrafts((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  function applyAdvancedJson() {
    try {
      const parsed = JSON.parse(advancedJson) as unknown;
      if (!Array.isArray(parsed)) {
        setValidationError(t('invalidBoardJson'));
        return;
      }
      const drafts: StatsWidgetDraft[] = [];
      for (const item of parsed) {
        if (
          typeof item !== 'object' ||
          item === null ||
          (item as { type?: string }).type !== 'stats' ||
          typeof (item as { websiteId?: string }).websiteId !== 'string'
        ) {
          setValidationError(t('invalidBoardJson'));
          return;
        }
        const row = item as { websiteId: string; label?: string };
        drafts.push({
          type: 'stats',
          websiteId: row.websiteId,
          label: typeof row.label === 'string' ? row.label : '',
        });
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
    setAdvancedJson(JSON.stringify(draftsToBoardParameters(widgetDrafts).widgets ?? [], null, 2));
    setAdvancedOpen(true);
  }

  return (
    <form onSubmit={onFormSubmit}>
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

        {!websites.length ? (
          <p className="text-muted">{t('boardNoWebsites')}</p>
        ) : (
          <ul className="list-plain board-widget-rows">
            {widgetDrafts.map((w, index) => (
              <li key={index} className="board-widget-row">
                <div className="field">
                  <Label htmlFor={`board-widget-site-${index}`}>{t('widgetWebsite')}</Label>
                  <select
                    id={`board-widget-site-${index}`}
                    className="select"
                    value={w.websiteId}
                    onChange={(e) => updateWidget(index, { websiteId: e.target.value })}
                  >
                    <option value="">{t('selectWebsite')}</option>
                    {websites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {websiteLabel(site)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <Label htmlFor={`board-widget-label-${index}`}>{t('widgetLabel')}</Label>
                  <Input
                    id={`board-widget-label-${index}`}
                    value={w.label}
                    onChange={(e) => updateWidget(index, { label: e.target.value })}
                    placeholder={t('widgetLabelOptional')}
                  />
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
        <Button type="submit" variant="primary" disabled={isPending || !websites.length}>
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
