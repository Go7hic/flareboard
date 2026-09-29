import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_SUBSCRIPTION_RECIPIENTS } from '@flareboard/shared/dashboards';
import { ModalDialog } from './ModalDialog';
import { deleteTitle, useConfirm } from './ConfirmDialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { api, type ReportSubscription } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function parseRecipients(text: string) {
  return [...new Set(text.split(/[\s,;]+/).map((part) => part.trim().toLowerCase()).filter(Boolean))];
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function weekdayLabel(day: number) {
  // 2023-01-01 was a Sunday.
  return new Date(Date.UTC(2023, 0, 1 + day)).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
}

function scheduleText(sub: ReportSubscription) {
  const hour = `${String(sub.hour).padStart(2, '0')}:00`;
  return sub.frequency === 'daily'
    ? t('subscriptionScheduleDaily').replace('{hour}', hour).replace('{timezone}', sub.timezone)
    : t('subscriptionScheduleWeekly')
        .replace('{weekday}', weekdayLabel(sub.weekday))
        .replace('{hour}', hour)
        .replace('{timezone}', sub.timezone);
}

/** Scheduled email summaries of a board or an insight. */
export function SubscriptionsDialog({
  targetType,
  targetId,
  targetName,
  canEdit,
  timezone,
  onClose,
}: {
  targetType: 'board' | 'insight';
  targetId: string;
  targetName: string;
  canEdit: boolean;
  /** Default schedule timezone (the website's for insights). */
  timezone?: string;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const queryKey = ['subscriptions', targetType, targetId];
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('weekly');
  const [weekday, setWeekday] = useState(1);
  const [hour, setHour] = useState(8);
  const [recipientsText, setRecipientsText] = useState('');
  const recipients = parseRecipients(recipientsText);
  const invalid = recipients.filter((value) => !looksLikeEmail(value));
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const listQuery = useQuery({
    queryKey,
    queryFn: () => api<ReportSubscription[]>(`/api/subscriptions?targetType=${targetType}&targetId=${targetId}`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api<ReportSubscription>('/api/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          targetType,
          targetId,
          frequency,
          weekday,
          hour,
          timezone: timezone ?? browserTimezone,
          recipients,
        }),
      }),
    onSuccess: () => {
      setRecipientsText('');
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (sub: ReportSubscription) =>
      api(`/api/subscriptions/${sub.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !sub.enabled }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/subscriptions/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const subscriptions = listQuery.data ?? [];
  const canCreate = recipients.length > 0 && recipients.length <= MAX_SUBSCRIPTION_RECIPIENTS && !invalid.length;

  return (
    <ModalDialog className="subscriptions-dialog" aria-label={t('subscriptionsTitle')} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{t('subscriptionsTitle')}</h2>
        <p className="text-muted">{t('subscriptionsLead').replace('{name}', targetName)}</p>
      </header>
      <div className="dialog-body">
        {listQuery.isLoading ? <div className="skeleton" style={{ height: '2.5rem' }} /> : null}
        {!listQuery.isLoading && !subscriptions.length ? <p className="text-muted">{t('subscriptionsEmpty')}</p> : null}
        {subscriptions.length ? (
          <ul className="list-plain subscription-list">
            {subscriptions.map((sub) => (
              <li key={sub.id} className="subscription-row">
                <div className="subscription-row-main">
                  <strong>{scheduleText(sub)}</strong>
                  <span className="text-muted">{sub.recipients.join(', ')}</span>
                  <span className="text-muted subscription-row-meta">
                    {sub.enabled
                      ? t('subscriptionNextSend').replace('{date}', formatDateTime(sub.nextRunAt))
                      : t('subscriptionPaused')}
                    {sub.lastSentAt ? ` · ${t('subscriptionLastSent').replace('{date}', formatDateTime(sub.lastSentAt))}` : ''}
                  </span>
                  {sub.lastError ? <span className="text-danger subscription-row-meta">{sub.lastError}</span> : null}
                </div>
                {canEdit ? (
                  <div className="subscription-row-actions">
                    <Switch
                      checked={sub.enabled}
                      aria-label={t('subscriptionEnabled')}
                      disabled={toggleMutation.isPending}
                      onCheckedChange={() => toggleMutation.mutate(sub)}
                    />
                    <Button
                      type="button"
                      variant="destructive-ghost"
                      size="sm"
                      onClick={() =>
                        confirm({ title: deleteTitle(scheduleText(sub)), onConfirm: () => deleteMutation.mutate(sub.id) })
                      }
                    >
                      {t('delete')}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {canEdit ? (
          <div className="subscription-create">
            <h3 className="section-title">{t('subscriptionNew')}</h3>
            <div className="subscription-create-grid">
              <div className="field">
                <Label htmlFor="subscription-frequency">{t('subscriptionFrequency')}</Label>
                <select
                  id="subscription-frequency"
                  className="select"
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value as 'daily' | 'weekly')}
                >
                  <option value="daily">{t('daily')}</option>
                  <option value="weekly">{t('weekly')}</option>
                </select>
              </div>
              {frequency === 'weekly' ? (
                <div className="field">
                  <Label htmlFor="subscription-weekday">{t('subscriptionWeekday')}</Label>
                  <select
                    id="subscription-weekday"
                    className="select"
                    value={weekday}
                    onChange={(event) => setWeekday(Number(event.target.value))}
                  >
                    {WEEKDAYS.map((day) => (
                      <option key={day} value={day}>
                        {weekdayLabel(day)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="field">
                <Label htmlFor="subscription-hour">{t('subscriptionHour')}</Label>
                <select id="subscription-hour" className="select" value={hour} onChange={(event) => setHour(Number(event.target.value))}>
                  {HOURS.map((value) => (
                    <option key={value} value={value}>
                      {`${String(value).padStart(2, '0')}:00`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <Label htmlFor="subscription-recipients">{t('subscriptionRecipients')}</Label>
              <Textarea
                id="subscription-recipients"
                rows={2}
                value={recipientsText}
                placeholder="team@example.com, ceo@example.com"
                onChange={(event) => setRecipientsText(event.target.value)}
              />
              <p className="text-muted field-hint">
                {invalid.length
                  ? t('subscriptionInvalidRecipients').replace('{list}', invalid.join(', '))
                  : t('subscriptionRecipientsHint')
                      .replace('{max}', String(MAX_SUBSCRIPTION_RECIPIENTS))
                      .replace('{timezone}', timezone ?? browserTimezone)}
              </p>
            </div>
            {createMutation.error ? <p className="text-danger">{(createMutation.error as Error).message}</p> : null}
          </div>
        ) : null}
      </div>
      <footer className="dialog-footer">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
        {canEdit ? (
          <Button
            type="button"
            variant="primary"
            disabled={!canCreate || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {t('subscriptionCreate')}
          </Button>
        ) : null}
      </footer>
    </ModalDialog>
  );
}
