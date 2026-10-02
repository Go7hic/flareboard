import { useState } from 'react';
import { ModalDialog } from '../ModalDialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { t } from '../../lib/i18n';
import { CodeBlock } from './CodeBlock';
import { FormSelect } from './FormSelect';

/** Connectors that really import data (API: WAREHOUSE_DATA_SOURCE_TYPES). */
export const WAREHOUSE_SOURCE_TYPES = [
  { id: 'http_json', label: () => t('warehouseSourceHttpJson') },
  { id: 'http_csv', label: () => t('warehouseSourceHttpCsv') },
  { id: 'stripe', label: () => t('warehouseSourceStripe') },
] as const;
export type WarehouseSourceType = (typeof WAREHOUSE_SOURCE_TYPES)[number]['id'];

export function warehouseSourceLabel(type: string) {
  return WAREHOUSE_SOURCE_TYPES.find((item) => item.id === type)?.label() ?? type;
}

function DialogError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="q-form-error" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

/** Name the current SQL and keep it in Saved. */
export function SaveQueryDialog({
  sql,
  pending,
  error,
  onSave,
  onClose,
}: {
  sql: string;
  pending: boolean;
  error: unknown;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  return (
    <ModalDialog onClose={onClose} aria-label={t('warehouseSaveQuery')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <div className="dialog-header">
          <h2 className="dialog-title">{t('warehouseSaveQuery')}</h2>
          <p className="dialog-description">{t('warehouseSavedQueriesLead')}</p>
        </div>
        <div className="dialog-body">
          <div className="q-field">
            <Label htmlFor="warehouse-saved-name">{t('warehouseSavedQueryName')}</Label>
            <Input id="warehouse-saved-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <CodeBlock code={sql} copy={false} maxHeight="12rem" caption={t('warehouseSql')} />
        </div>
        <div className="dialog-footer">
          <DialogError error={error} />
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || !sql.trim() || pending}>
            {pending ? t('saving') : t('warehouseSaveQuery')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}

/** Run the current SQL every N minutes. */
export function ScheduleDialog({
  sql,
  pending,
  error,
  onCreate,
  onClose,
}: {
  sql: string;
  pending: boolean;
  error: unknown;
  onCreate: (draft: { name: string; intervalMinutes: number }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [interval, setInterval] = useState(60);
  return (
    <ModalDialog onClose={onClose} aria-label={t('warehouseScheduledQueries')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && sql.trim()) onCreate({ name: name.trim(), intervalMinutes: Number(interval) });
        }}
      >
        <div className="dialog-header">
          <h2 className="dialog-title">{t('qualityNewSchedule')}</h2>
          <p className="dialog-description">{t('qualityScheduleDialogLead')}</p>
        </div>
        <div className="dialog-body">
          <div className="q-form-row">
            <div className="q-field">
              <Label htmlFor="warehouse-schedule-name">{t('name')}</Label>
              <Input id="warehouse-schedule-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="q-field">
              <Label htmlFor="warehouse-schedule-interval">{t('warehouseScheduleInterval')}</Label>
              <Input
                id="warehouse-schedule-interval"
                type="number"
                min={5}
                value={interval}
                onChange={(event) => setInterval(Number(event.target.value))}
              />
            </div>
          </div>
          <CodeBlock code={sql} copy={false} maxHeight="12rem" caption={t('warehouseSql')} />
        </div>
        <div className="dialog-footer">
          <DialogError error={error} />
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || !sql.trim() || pending}>
            {pending ? t('saving') : t('create')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}

export type DataSourceDraft = { name: string; type: WarehouseSourceType; configText: string; apiKey: string };

/** Connect an HTTP JSON / CSV feed or Stripe (restricted key, stored encrypted). */
export function DataSourceDialog({
  pending,
  error,
  onCreate,
  onClose,
}: {
  pending: boolean;
  error: unknown;
  onCreate: (draft: DataSourceDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DataSourceDraft>({
    name: '',
    type: 'http_json',
    configText: '{\n  "url": "https://example.com/data.json"\n}',
    apiKey: '',
  });
  const stripe = draft.type === 'stripe';
  const ready = Boolean(draft.name.trim()) && (!stripe || Boolean(draft.apiKey.trim()));
  return (
    <ModalDialog onClose={onClose} aria-label={t('warehouseDataSources')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onCreate(draft);
        }}
      >
        <div className="dialog-header">
          <h2 className="dialog-title">{t('qualityNewDataSource')}</h2>
          <p className="dialog-description">{t('warehouseDataSourcesLead')}</p>
        </div>
        <div className="dialog-body">
          <div className="q-form-row">
            <div className="q-field">
              <Label htmlFor="warehouse-source-name">{t('name')}</Label>
              <Input
                id="warehouse-source-name"
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="q-field">
              <Label htmlFor="warehouse-source-type">{t('warehouseDataSourceType')}</Label>
              <FormSelect
                id="warehouse-source-type"
                value={draft.type}
                onChange={(type) => setDraft((prev) => ({ ...prev, type: type as WarehouseSourceType }))}
                options={WAREHOUSE_SOURCE_TYPES.map((item) => ({ value: item.id, label: item.label() }))}
              />
            </div>
          </div>
          {stripe ? (
            <div className="q-field">
              <Label htmlFor="warehouse-source-api-key">{t('warehouseStripeApiKey')}</Label>
              <Input
                id="warehouse-source-api-key"
                type="password"
                autoComplete="off"
                placeholder="rk_live_…"
                value={draft.apiKey}
                onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
              />
              <p className="q-field-hint">{t('warehouseStripeApiKeyHint')}</p>
              <p className="q-field-hint">{t('warehouseStripeSyncHint')}</p>
            </div>
          ) : (
            <div className="q-field">
              <Label htmlFor="warehouse-source-config">{t('warehouseDataSourceConfig')}</Label>
              <Textarea
                id="warehouse-source-config"
                className="q-textarea-code"
                spellCheck={false}
                value={draft.configText}
                onChange={(event) => setDraft((prev) => ({ ...prev, configText: event.target.value }))}
              />
            </div>
          )}
          <p className="q-field-hint">{t('warehouseAutomationCronHint')}</p>
        </div>
        <div className="dialog-footer">
          <DialogError error={error} />
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!ready || pending}>
            {pending ? t('saving') : t('create')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}

/**
 * Replace a Stripe source's key. The dialog is the confirmation: it says the old import is
 * removed and the button is destructive.
 */
export function ReplaceKeyDialog({
  sourceName,
  pending,
  error,
  onReplace,
  onClose,
}: {
  sourceName: string;
  pending: boolean;
  error: unknown;
  onReplace: (apiKey: string) => void;
  onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  return (
    <ModalDialog onClose={onClose} aria-label={t('warehouseReplaceKey')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (apiKey.trim()) onReplace(apiKey.trim());
        }}
      >
        <div className="dialog-header">
          <h2 className="dialog-title">
            {t('warehouseReplaceKey')} · {sourceName}
          </h2>
          <p className="dialog-description">{t('warehouseReplaceKeyHint')}</p>
        </div>
        <div className="dialog-body">
          <div className="q-field">
            <Label htmlFor="warehouse-replace-key">{t('warehouseStripeApiKey')}</Label>
            <Input
              id="warehouse-replace-key"
              type="password"
              autoComplete="off"
              autoFocus
              placeholder="rk_live_…"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <p className="q-field-hint">{t('warehouseStripeApiKeyHint')}</p>
          </div>
        </div>
        <div className="dialog-footer">
          <DialogError error={error} />
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="danger" disabled={!apiKey.trim() || pending}>
            {t('warehouseReplaceKey')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
