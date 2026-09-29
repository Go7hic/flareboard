import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { CollapsibleSection } from '../CollapsibleSection';
import { deleteTitle, useConfirm } from '../ConfirmDialog';
import { DataViewState } from '../DataViewState';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
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

export function LlmSettings({ websiteId, canEdit }: { websiteId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['ai-settings', websiteId],
    queryFn: () => api<AiSettings>(`/api/websites/${websiteId}/ai-observability/settings`),
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);

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
    <DataViewState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {settings ? (
        <>
          <section className="panel section-gap">
            <header className="compact-panel-header">
              <h2 className="section-title">{t('aiSettingsContentTitle')}</h2>
              <p className="text-muted">{t('aiSettingsContentLead')}</p>
            </header>
            <div className="flex items-center gap-3">
              <Switch
                id="llm-capture-content"
                checked={settings.captureContent}
                disabled={!canEdit || save.isPending}
                onCheckedChange={(checked) => save.mutate({ captureContent: checked })}
              />
              <Label htmlFor="llm-capture-content">{t('aiSettingsContentLabel')}</Label>
            </div>
            <p className="text-muted mt-2 text-sm">{t('aiSettingsContentNote')}</p>
          </section>

          <section className="panel section-gap">
            <header className="compact-panel-header">
              <h2 className="section-title">{t('aiSettingsPricesTitle')}</h2>
              <p className="text-muted">{t('aiSettingsPricesLead')}</p>
            </header>
            {rows.length ? (
              <div className="table-scroll">
                <table className="data-table llm-price-table">
                  <thead>
                    <tr>
                      <th>{t('aiSettingsModelId')}</th>
                      <th>{t('aiSettingsInputPrice')}</th>
                      <th>{t('aiSettingsOutputPrice')}</th>
                      <th>{t('aiSettingsCacheReadPrice')}</th>
                      <th>{t('aiSettingsCacheWritePrice')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <Input
                            value={row.model}
                            disabled={!canEdit}
                            placeholder="gpt-4o"
                            aria-label={t('aiSettingsModelId')}
                            onChange={(event) => edit(row.key, { model: event.target.value })}
                          />
                        </td>
                        {(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((field) => (
                          <td key={field}>
                            <Input
                              type="number"
                              min={0}
                              step="0.001"
                              value={row[field]}
                              disabled={!canEdit}
                              aria-label={field}
                              onChange={(event) => edit(row.key, { [field]: event.target.value })}
                            />
                          </td>
                        ))}
                        <td>
                          <Button
                            type="button"
                            variant="destructive-ghost"
                            size="sm"
                            disabled={!canEdit}
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
                            {t('remove')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted">{t('aiSettingsNoOverrides')}</p>
            )}
            {!allValid ? <p className="text-muted mt-2 text-sm">{t('aiSettingsInvalidPrice')}</p> : null}
            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDirty(true);
                    setRows((current) => [...current, { key: nextKey++, model: '', input: '', output: '', cacheRead: '', cacheWrite: '' }]);
                  }}
                >
                  <Plus size={14} strokeWidth={2} aria-hidden />
                  {t('aiSettingsAddPrice')}
                </Button>
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
                {save.isSuccess && !dirty ? <span className="text-muted text-sm">{t('saved')}</span> : null}
              </div>
            ) : (
              <p className="text-muted mt-2 text-sm">{t('viewOnlyHint')}</p>
            )}
          </section>

          <CollapsibleSection title={t('aiSettingsBuiltIn').replace('{date}', settings.pricesReviewedAt)}>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('aiSettingsModelId')}</th>
                    <th>{t('aiProvider')}</th>
                    <th className="num">{t('aiSettingsInputPrice')}</th>
                    <th className="num">{t('aiSettingsOutputPrice')}</th>
                    <th className="num">{t('aiSettingsCacheReadPrice')}</th>
                    <th className="num">{t('aiSettingsCacheWritePrice')}</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.builtInPrices.map((price) => (
                    <tr key={price.model}>
                      <td className="mono">{price.model}</td>
                      <td>{price.provider}</td>
                      <td className="num">{priceCell(price.inputPerMillion)}</td>
                      <td className="num">{priceCell(price.outputPerMillion)}</td>
                      <td className="num">{priceCell(price.cacheReadPerMillion)}</td>
                      <td className="num">{priceCell(price.cacheWritePerMillion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleSection>
        </>
      ) : null}
    </DataViewState>
  );
}
