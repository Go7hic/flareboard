import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Plus } from 'lucide-react';
import { deleteTitle, useConfirm } from '../ConfirmDialog';
import { EmptyState } from '../EmptyState';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';
import { describeSavedFilter, parseAttributeInput } from '../logs/log-filters';
import { api, type LogAlertRule } from '../../lib/api';
import { LOG_SEVERITIES } from '../../lib/chart-colors';
import { formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { AlertChannelFields, AlertRuleRow } from './AlertRuleParts';
import { FormSelect } from './FormSelect';
import { SideSheet } from './SideSheet';

const EMPTY_DRAFT = {
  name: '',
  threshold: 10,
  windowMinutes: 15,
  level: '',
  service: '',
  search: '',
  release: '',
  environment: '',
  attribute: '',
  channel: 'record' as LogAlertRule['channel'],
  target: '',
};

function conditionText(rule: LogAlertRule) {
  const filters = describeSavedFilter({
    level: rule.level ?? undefined,
    service: rule.service ?? undefined,
    search: rule.search ?? undefined,
    release: rule.release ?? undefined,
    environment: rule.environment ?? undefined,
    attributes: rule.attributeKey ? [{ key: rule.attributeKey, value: rule.attributeValue ?? undefined }] : undefined,
  });
  const volume = t('qualityLogAlertCondition')
    .replace('{threshold}', formatNumber(rule.threshold))
    .replace('{window}', formatNumber(rule.windowMinutes));
  return filters === '-' ? volume : `${volume} · ${filters}`;
}

/** Log alert rules: list with enable switch and delete; a create form view. */
export function LogAlertRulesSheet({
  websiteId,
  canEdit,
  open,
  onOpenChange,
}: {
  websiteId: string;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'list' | 'create'>('list');
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['log-alerts', websiteId] });

  const query = useQuery({
    queryKey: ['log-alerts', websiteId],
    enabled: open && Boolean(websiteId),
    queryFn: () => api<{ alertRules: LogAlertRule[] }>(`/api/websites/${websiteId}/logs/alerts`),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const attribute = parseAttributeInput(draft.attribute);
      return api<LogAlertRule>(`/api/websites/${websiteId}/logs/alerts`, {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          threshold: Number(draft.threshold),
          windowMinutes: Number(draft.windowMinutes),
          level: draft.level || null,
          service: draft.service.trim() || null,
          search: draft.search.trim() || null,
          release: draft.release.trim() || null,
          environment: draft.environment.trim() || null,
          attributeKey: attribute?.key ?? null,
          attributeValue: attribute?.value ?? null,
          channel: draft.channel,
          target: draft.target.trim() || null,
          enabled: true,
        }),
      });
    },
    onSuccess: () => {
      setDraft(EMPTY_DRAFT);
      setView('list');
      void invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<LogAlertRule> }) =>
      api<LogAlertRule>(`/api/websites/${websiteId}/logs/alerts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => void invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/logs/alerts/${id}`, { method: 'DELETE' }),
    onSuccess: () => void invalidate(),
  });

  const rules = query.data?.alertRules ?? [];
  const field = (key: keyof typeof EMPTY_DRAFT, label: string, options?: { mono?: boolean; placeholder?: string }) => (
    <div className="q-field">
      <Label htmlFor={`log-alert-${key}`}>{label}</Label>
      <Input
        id={`log-alert-${key}`}
        className={options?.mono ? 'font-mono' : undefined}
        value={String(draft[key])}
        placeholder={options?.placeholder ?? t('qualityAnyValue')}
        onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
      />
    </div>
  );

  return (
    <SideSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setView('list');
      }}
      title={view === 'create' ? t('createAlertRule') : t('logsAlertRules')}
      description={t('logsAlertRulesLead')}
      actions={
        canEdit && view === 'list' ? (
          <Button type="button" size="sm" onClick={() => setView('create')}>
            <Plus aria-hidden />
            {t('qualityNewRule')}
          </Button>
        ) : null
      }
      footer={
        view === 'create' ? (
          <>
            {createMutation.error ? (
              <p className="q-form-error" role="alert">
                {(createMutation.error as Error).message}
              </p>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setView('list')}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!draft.name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? t('saving') : t('createAlertRule')}
            </Button>
          </>
        ) : null
      }
    >
      {view === 'create' ? (
        <div className="q-form">
          {field('name', t('alertRuleName'), { placeholder: '' })}
          <div className="q-form-row">
            <div className="q-field">
              <Label htmlFor="log-alert-threshold">{t('alertRuleThreshold')}</Label>
              <Input
                id="log-alert-threshold"
                type="number"
                min={1}
                value={draft.threshold}
                onChange={(event) => setDraft((prev) => ({ ...prev, threshold: Number(event.target.value) }))}
              />
            </div>
            <div className="q-field">
              <Label htmlFor="log-alert-window">{t('alertRuleWindow')}</Label>
              <Input
                id="log-alert-window"
                type="number"
                min={1}
                value={draft.windowMinutes}
                onChange={(event) => setDraft((prev) => ({ ...prev, windowMinutes: Number(event.target.value) }))}
              />
            </div>
          </div>
          <div className="q-form-row">
            <div className="q-field">
              <Label htmlFor="log-alert-level">{t('logAlertLevel')}</Label>
              <FormSelect
                id="log-alert-level"
                value={draft.level}
                onChange={(level) => setDraft((prev) => ({ ...prev, level }))}
                options={[{ value: '', label: t('allLevels') }, ...LOG_SEVERITIES.map((level) => ({ value: level, label: level }))]}
              />
            </div>
            {field('service', t('logAlertService'))}
          </div>
          <div className="q-form-row">
            {field('search', t('search'))}
            {field('attribute', t('logsAttributeFilter'), { mono: true, placeholder: t('logsAttributePlaceholder') })}
          </div>
          <div className="q-form-row">
            {field('release', t('release'))}
            {field('environment', t('environment'))}
          </div>
          <AlertChannelFields
            idPrefix="log-alert"
            channel={draft.channel}
            target={draft.target}
            onChannelChange={(channel) => setDraft((prev) => ({ ...prev, channel }))}
            onTargetChange={(target) => setDraft((prev) => ({ ...prev, target }))}
          />
        </div>
      ) : query.isLoading ? (
        <div className="q-list" aria-hidden>
          {[0, 1].map((index) => (
            <div key={index} className="q-list-row">
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : rules.length ? (
        <ul className="q-list">
          {rules.map((rule) => (
            <AlertRuleRow
              key={rule.id}
              name={rule.name}
              enabled={rule.enabled}
              condition={<span className="mono q-list-mono">{conditionText(rule)}</span>}
              channel={rule.channel}
              target={rule.target}
              canEdit={canEdit}
              pending={updateMutation.isPending}
              onToggleEnabled={(enabled) => updateMutation.mutate({ id: rule.id, patch: { enabled } })}
              onDelete={() => confirm({ title: deleteTitle(rule.name), onConfirm: () => deleteMutation.mutate(rule.id) })}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<BellRing />}
          title={t('noAlertRules')}
          description={t('logsAlertRulesLead')}
          action={
            canEdit ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setView('create')}>
                <Plus aria-hidden />
                {t('createAlertRule')}
              </Button>
            ) : undefined
          }
        />
      )}
    </SideSheet>
  );
}
