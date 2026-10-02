import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Plus } from 'lucide-react';
import { deleteTitle, useConfirm } from '../ConfirmDialog';
import { EmptyState } from '../EmptyState';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { DropdownMenuCheckboxItem } from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';
import { api, type ErrorAlertRule } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { AlertChannelFields, AlertRuleRow } from './AlertRuleParts';
import { FormSelect } from './FormSelect';
import { SideSheet } from './SideSheet';

const EMPTY_DRAFT = {
  name: '',
  threshold: 5,
  windowMinutes: 10,
  severity: '',
  release: '',
  environment: '',
  channel: 'record' as ErrorAlertRule['channel'],
  target: '',
  notifyRegressions: true,
};

/** "5+ errors in 10 min · fatal · storefront@3.40.0" */
function conditionText(rule: ErrorAlertRule) {
  const parts = [
    t('qualityErrorAlertCondition')
      .replace('{threshold}', formatNumber(rule.threshold))
      .replace('{window}', formatNumber(rule.windowMinutes)),
    rule.severity,
    rule.release,
    rule.environment,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** Error alert rules: list with enable switch, regression toggle and delete; a create form view. */
export function ErrorAlertRulesSheet({
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
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['error-alert-rules', websiteId] });

  const query = useQuery({
    queryKey: ['error-alert-rules', websiteId],
    enabled: open && Boolean(websiteId),
    queryFn: () => api<{ alertRules: ErrorAlertRule[] }>(`/api/websites/${websiteId}/errors/alerts`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api<ErrorAlertRule>(`/api/websites/${websiteId}/errors/alerts`, {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          threshold: Number(draft.threshold),
          windowMinutes: Number(draft.windowMinutes),
          severity: draft.severity || null,
          release: draft.release.trim() || null,
          environment: draft.environment.trim() || null,
          channel: draft.channel,
          target: draft.target.trim() || null,
          notifyRegressions: draft.notifyRegressions,
          enabled: true,
        }),
      }),
    onSuccess: () => {
      setDraft(EMPTY_DRAFT);
      setView('list');
      void invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ErrorAlertRule> }) =>
      api<ErrorAlertRule>(`/api/websites/${websiteId}/errors/alerts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => void invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/errors/alerts/${id}`, { method: 'DELETE' }),
    onSuccess: () => void invalidate(),
  });

  const rules = query.data?.alertRules ?? [];

  return (
    <SideSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setView('list');
      }}
      title={view === 'create' ? t('createAlertRule') : t('errorAlertRules')}
      description={t('errorAlertRulesLead')}
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
          <div className="q-field">
            <Label htmlFor="error-alert-name">{t('alertRuleName')}</Label>
            <Input
              id="error-alert-name"
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div className="q-form-row">
            <div className="q-field">
              <Label htmlFor="error-alert-threshold">{t('alertRuleThreshold')}</Label>
              <Input
                id="error-alert-threshold"
                type="number"
                min={1}
                value={draft.threshold}
                onChange={(event) => setDraft((prev) => ({ ...prev, threshold: Number(event.target.value) }))}
              />
            </div>
            <div className="q-field">
              <Label htmlFor="error-alert-window">{t('alertRuleWindow')}</Label>
              <Input
                id="error-alert-window"
                type="number"
                min={1}
                value={draft.windowMinutes}
                onChange={(event) => setDraft((prev) => ({ ...prev, windowMinutes: Number(event.target.value) }))}
              />
            </div>
          </div>
          <div className="q-form-row">
            <div className="q-field">
              <Label htmlFor="error-alert-severity">{t('errorAlertSeverity')}</Label>
              <FormSelect
                id="error-alert-severity"
                value={draft.severity}
                onChange={(severity) => setDraft((prev) => ({ ...prev, severity }))}
                options={[
                  { value: '', label: t('all') },
                  { value: 'fatal', label: 'fatal' },
                  { value: 'error', label: 'error' },
                  { value: 'warning', label: 'warning' },
                  { value: 'info', label: 'info' },
                ]}
              />
            </div>
            <div className="q-field">
              <Label htmlFor="error-alert-release">{t('release')}</Label>
              <Input
                id="error-alert-release"
                value={draft.release}
                placeholder={t('qualityAnyValue')}
                onChange={(event) => setDraft((prev) => ({ ...prev, release: event.target.value }))}
              />
            </div>
          </div>
          <div className="q-form-row">
            <div className="q-field">
              <Label htmlFor="error-alert-environment">{t('environment')}</Label>
              <Input
                id="error-alert-environment"
                value={draft.environment}
                placeholder={t('qualityAnyValue')}
                onChange={(event) => setDraft((prev) => ({ ...prev, environment: event.target.value }))}
              />
            </div>
            <div className="q-field" aria-hidden />
          </div>
          <AlertChannelFields
            idPrefix="error-alert"
            channel={draft.channel}
            target={draft.target}
            onChannelChange={(channel) => setDraft((prev) => ({ ...prev, channel }))}
            onTargetChange={(target) => setDraft((prev) => ({ ...prev, target }))}
          />
          <label className="q-check" htmlFor="error-alert-regressions">
            <Checkbox
              id="error-alert-regressions"
              checked={draft.notifyRegressions}
              onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, notifyRegressions: checked === true }))}
            />
            <span>{t('errorAlertNotifyRegressions')}</span>
          </label>
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
              condition={
                <>
                  {conditionText(rule)}
                  {rule.notifyRegressions ? <span className="q-list-tag">{t('errorAlertRegressionsColumn')}</span> : null}
                </>
              }
              channel={rule.channel}
              target={rule.target}
              canEdit={canEdit}
              pending={updateMutation.isPending}
              onToggleEnabled={(enabled) => updateMutation.mutate({ id: rule.id, patch: { enabled } })}
              onDelete={() => confirm({ title: deleteTitle(rule.name), onConfirm: () => deleteMutation.mutate(rule.id) })}
              menuItems={
                <DropdownMenuCheckboxItem
                  checked={rule.notifyRegressions}
                  onCheckedChange={(checked) =>
                    updateMutation.mutate({ id: rule.id, patch: { notifyRegressions: checked === true } })
                  }
                >
                  {t('errorAlertNotifyRegressions')}
                </DropdownMenuCheckboxItem>
              }
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<BellRing />}
          title={t('noErrorAlertRules')}
          description={t('errorAlertRulesLead')}
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
