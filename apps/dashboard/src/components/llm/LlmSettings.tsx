import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { deleteTitle, useConfirm } from '../ConfirmDialog';
import { DataViewState } from '../DataViewState';
import { EmptyState } from '../EmptyState';
import { SectionCard } from '../SectionCard';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';
import { Switch } from '../ui/switch';
import { api, type AiModelPrice, type AiSettings } from '../../lib/api';
import { t } from '../../lib/i18n';

type Row = { key: number; model: string; input: string; output: string; cacheRead: string; cacheWrite: string };

let nextKey = 1;
function toRow(price: AiModelPrice): Row {
  return {
    key: nextKey++,
    model: price.model,
    input: String(price.inputPerMillion),
    output: String(price.outputPerMillion),
    cacheRead: price.cacheReadPerMillion == null ? '' : String(price.cacheReadPerMillion),
    cacheWrite: price.cacheWritePerMillion == null ? '' : String(price.cacheWritePerMillion),
  };
}

function optionalPrice(value: string) {
  return value.trim() === '' ? null : Number(value);
}

function validRow(row: Row) {
  const nums = [Number(row.input), Number(row.output), optionalPrice(row.cacheRead) ?? 0, optionalPrice(row.cacheWrite) ?? 0];
  return row.model.trim() !== '' && row.input.trim() !== '' && row.output.trim() !== '' && nums.every((n) => Number.isFinite(n) && n >= 0);
}

const priceCell = (value: number | null) => (value == null ? '—' : `$${value}`);

const PRICE_FIELDS = [
  ['input', 'aiSettingsInputPrice'],
  ['output', 'aiSettingsOutputPrice'],
  ['cacheRead', 'aiSettingsCacheReadPrice'],
  ['cacheWrite', 'aiSettingsCacheWritePrice'],
] as const;

/** AI observability settings: content capture, custom model prices, the built-in price list. */
export function LlmSettings({ websiteId, canEdit }: { websiteId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['ai-settings', websiteId],
    queryFn: () => api<AiSettings>(`/api/websites/${websiteId}/ai-observability/settings`),
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [showBuiltIn, setShowBuiltIn] = useState(false);

  useEffect(() => {
    if (query.data && !dirty) setRows(query.data.priceOverrides.map(toRow));
  }, [query.data, dirty]);

  const save = useMutation({
    mutationFn: (body: Partial<{ captureContent: boolean; priceOverrides: AiModelPrice[] }>) =>
      api<AiSettings>(`/api/websites/${websiteId}/ai-observability/settings`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (data) => {
      queryClient.setQueryData(['ai-settings', websiteId], data);
      setDirty(false);
      setRows(data.priceOverrides.map(toRow));
      // Costs depend on the overrides.
      void queryClient.invalidateQueries({ queryKey: ['ai-observability', websiteId] });
      void queryClient.invalidateQueries({ queryKey: ['ai-traces', websiteId] });
      void queryClient.invalidateQueries({ queryKey: ['ai-users', websiteId] });
    },
  });

  const edit = (key: number, patch: Partial<Row>) => {
    setDirty(true);
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };
  const allValid = rows.every(validRow);
  const settings = query.data;

  return (
    <DataViewState
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      loadingFallback={
        <div className="q-settings-column">
          <SectionCard title={t('aiSettingsContentTitle')}>
            <Skeleton className="h-10 w-full" />
          </SectionCard>
          <SectionCard title={t('aiSettingsPricesTitle')}>
            <Skeleton className="h-24 w-full" />
          </SectionCard>
        </div>
      }
    >
      {settings ? (
        <div className="q-settings-column">
          <SectionCard title={t('aiSettingsContentTitle')} description={t('aiSettingsContentLead')}>
            <div className="q-setting-row">
              <div className="q-setting-copy">
                <Label htmlFor="llm-capture-content" className="q-setting-label">
                  {t('aiSettingsContentLabel')}
                </Label>
                <p className="q-field-hint">{t('aiSettingsContentNote')}</p>
              </div>
              <Switch
                id="llm-capture-content"
                checked={settings.captureContent}
                disabled={!canEdit || save.isPending}
                onCheckedChange={(checked) => save.mutate({ captureContent: checked })}
              />
            </div>
          </SectionCard>

          <SectionCard
            flush
            title={t('aiSettingsPricesTitle')}
            description={t('aiSettingsPricesLead')}
            footer={
              canEdit ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDirty(true);
                      setRows((current) => [...current, { key: nextKey++, model: '', input: '', output: '', cacheRead: '', cacheWrite: '' }]);
                    }}
                  >
                    <Plus aria-hidden />
                    {t('aiSettingsAddPrice')}
                  </Button>
                  <span className="q-footer-actions">
                    {save.isSuccess && !dirty ? <span className="q-saved">{t('saved')}</span> : null}
                    {save.error ? <span className="q-form-error">{(save.error as Error).message}</span> : null}
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={!dirty || !allValid || save.isPending}
                      onClick={() =>
                        save.mutate({
                          priceOverrides: rows.map((row) => ({
                            model: row.model.trim(),
                            inputPerMillion: Number(row.input),
                            outputPerMillion: Number(row.output),
                            cacheReadPerMillion: optionalPrice(row.cacheRead),
                            cacheWritePerMillion: optionalPrice(row.cacheWrite),
                          })),
                        })
                      }
                    >
                      {save.isPending ? t('saving') : t('save')}
                    </Button>
                  </span>
                </>
              ) : (
                <span>{t('viewOnlyHint')}</span>
              )
            }
          >
            {!allValid ? <p className="q-inline-alert q-inline-alert--danger">{t('aiSettingsInvalidPrice')}</p> : null}
            {rows.length ? (
              <div className="table-scroll">
                <table className="data-table q-price-table">
                  <thead>
                    <tr>
                      <th>{t('aiSettingsModelId')}</th>
                      {PRICE_FIELDS.map(([, label]) => (
                        <th key={label}>{t(label)}</th>
                      ))}
                      <th className="q-col-actions">
                        <span className="sr-only">{t('actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <Input
                            className="q-cell-input font-mono"
                            value={row.model}
                            disabled={!canEdit}
                            placeholder="gpt-4o"
                            aria-label={t('aiSettingsModelId')}
                            onChange={(event) => edit(row.key, { model: event.target.value })}
                          />
                        </td>
                        {PRICE_FIELDS.map(([field, label]) => (
                          <td key={field}>
                            <Input
                              className="q-cell-input q-cell-input--num"
                              type="number"
                              min={0}
                              step="0.001"
                              value={row[field]}
                              disabled={!canEdit}
                              aria-label={t(label)}
                              onChange={(event) => edit(row.key, { [field]: event.target.value })}
                            />
                          </td>
                        ))}
                        <td className="q-col-actions">
                          <Button
                            type="button"
                            variant="destructive-ghost"
                            size="icon-sm"
                            disabled={!canEdit}
                            aria-label={`${t('remove')}: ${row.model || t('aiSettingsModelId')}`}
                            title={t('remove')}
                            onClick={() =>
                              confirm({
                                title: deleteTitle(row.model || t('aiSettingsModelId')),
                                onConfirm: () => {
                                  setDirty(true);
                                  setRows((current) => current.filter((item) => item.key !== row.key));
                                },
                              })
                            }
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title={t('aiSettingsNoOverrides')} />
            )}
          </SectionCard>

          <SectionCard
            flush
            className={showBuiltIn ? undefined : 'q-collapsed'}
            title={t('aiSettingsBuiltIn').replace('{date}', settings.pricesReviewedAt)}
            description={t('qualityBuiltInPricesLead').replace('{count}', String(settings.builtInPrices.length))}
            actions={
              <Button type="button" variant="ghost" size="sm" aria-expanded={showBuiltIn} onClick={() => setShowBuiltIn((open) => !open)}>
                {showBuiltIn ? t('aiShowLess') : t('aiShowAll')}
              </Button>
            }
          >
            {showBuiltIn ? (
              <div className="table-scroll q-table-sticky" style={{ maxHeight: '28rem' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('aiSettingsModelId')}</th>
                      <th>{t('aiProvider')}</th>
                      {PRICE_FIELDS.map(([, label]) => (
                        <th key={label} className="num">
                          {t(label)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {settings.builtInPrices.map((price) => (
                      <tr key={price.model}>
                        <td className="mono">{price.model}</td>
                        <td className="q-col-muted">{price.provider}</td>
                        <td className="num">{priceCell(price.inputPerMillion)}</td>
                        <td className="num">{priceCell(price.outputPerMillion)}</td>
                        <td className="num">{priceCell(price.cacheReadPerMillion)}</td>
                        <td className="num">{priceCell(price.cacheWritePerMillion)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </SectionCard>
        </div>
      ) : null}
    </DataViewState>
  );
}
