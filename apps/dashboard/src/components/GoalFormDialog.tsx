import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EventCatalogPicker } from './EventCatalogPicker';
import { ModalDialog } from './ModalDialog';
import { Segmented } from './behavior/QueryCard';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { api, type Website } from '../lib/api';
import { t } from '../lib/i18n';

export type GoalConfigRow = {
  event: string;
  target: number;
  period: 'daily' | 'weekly' | 'monthly';
};

/** What the dialog edits: a new goal (optionally for a known event) or an existing one. */
export type GoalFormState = { mode: 'create'; prefillEvent?: string } | { mode: 'edit'; goal: GoalConfigRow };

type WebsiteWithGoals = Website & {
  goalConfig?: { goals: GoalConfigRow[] };
};

const PERIODS: GoalConfigRow['period'][] = ['daily', 'weekly', 'monthly'];

/** Create / edit a goal (event + target + reset period). `state` null keeps it closed. */
export function GoalFormDialog({
  state,
  onClose,
  websiteId,
}: {
  state: GoalFormState | null;
  onClose: () => void;
  websiteId: string;
}) {
  if (!state) return null;
  // Keyed so every opening starts from the goal's values with a fresh save state.
  const key = state.mode === 'edit' ? `edit:${state.goal.event}` : `create:${state.prefillEvent ?? ''}`;
  return <GoalFormDialogBody key={key} state={state} onClose={onClose} websiteId={websiteId} />;
}

function GoalFormDialogBody({
  state,
  onClose,
  websiteId,
}: {
  state: GoalFormState;
  onClose: () => void;
  websiteId: string;
}) {
  const queryClient = useQueryClient();
  const editGoal = state.mode === 'edit' ? state.goal : null;
  const [eventName, setEventName] = useState(() =>
    state.mode === 'edit' ? state.goal.event : (state.prefillEvent ?? ''),
  );
  const [target, setTarget] = useState(() => (state.mode === 'edit' ? String(state.goal.target) : ''));
  const [period, setPeriod] = useState<GoalConfigRow['period']>(() =>
    state.mode === 'edit' ? state.goal.period || 'monthly' : 'monthly',
  );

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<WebsiteWithGoals>(`/api/websites/${websiteId}`),
  });

  const existing = websiteQuery.data?.goalConfig?.goals ?? [];
  const trimmed = eventName.trim();
  const replacesExisting = !editGoal && trimmed.length > 0 && existing.some((goal) => goal.event === trimmed);

  const saveMutation = useMutation({
    mutationFn: () => {
      const targetNum = parseInt(target, 10);
      if (!trimmed || !targetNum || targetNum < 1) throw new Error(t('goalInvalid'));
      const nextGoal: GoalConfigRow = { event: trimmed, target: targetNum, period };
      const goals = editGoal
        ? existing.map((goal) => (goal.event === editGoal.event ? nextGoal : goal))
        : [...existing.filter((goal) => goal.event !== trimmed), nextGoal];
      return api(`/api/websites/${websiteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ goalConfig: { goals } }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['website', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['reports-goal', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['goal-conversions', websiteId] });
      onClose();
    },
  });

  const targetNum = parseInt(target, 10);
  const canSave = trimmed.length > 0 && targetNum >= 1 && !saveMutation.isPending && !websiteQuery.isLoading;
  const title = editGoal ? t('goalEdit') : t('createGoal');

  return (
    <ModalDialog className="behavior-goal-dialog" aria-label={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) saveMutation.mutate();
        }}
      >
        <header className="dialog-header">
          <h2 className="dialog-title">{title}</h2>
          <p className="dialog-description">{t('behaviorGoalDialogLead')}</p>
        </header>

        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="goal-dialog-event">{t('goalEventName')}</Label>
            {editGoal ? (
              <p className="behavior-goal-dialog-event" id="goal-dialog-event">
                {editGoal.event}
              </p>
            ) : (
              <EventCatalogPicker
                mode="single"
                id="goal-dialog-event"
                websiteId={websiteId}
                value={eventName}
                onChange={setEventName}
                placeholder={t('behaviorGoalEventPlaceholder')}
                aria-label={t('goalEventName')}
              />
            )}
            {replacesExisting ? <p className="field-hint">{t('behaviorGoalReplaces')}</p> : null}
          </div>

          <div className="behavior-goal-dialog-row">
            <div className="field">
              <Label htmlFor="goal-dialog-target">{t('goalTarget')}</Label>
              <Input
                id="goal-dialog-target"
                type="number"
                inputMode="numeric"
                min={1}
                value={target}
                placeholder="100"
                onChange={(event) => setTarget(event.target.value)}
                autoFocus={Boolean(editGoal)}
              />
            </div>

            <div className="field">
              <span className="field-label">{t('behaviorGoalResets')}</span>
              <Segmented
                value={period}
                onChange={setPeriod}
                label={t('behaviorGoalResets')}
                options={PERIODS.map((value) => ({ value, label: t(`goalPeriod_${value}`) }))}
              />
            </div>
          </div>
          <p className="field-hint behavior-goal-dialog-hint">{t(`behaviorGoalPeriodHint_${period}`)}</p>

          {saveMutation.error ? (
            <p className="text-danger behavior-goal-dialog-error" role="alert">
              {(saveMutation.error as Error).message}
            </p>
          ) : null}
        </div>

        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saveMutation.isPending}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!canSave}>
            {saveMutation.isPending ? t('saving') : editGoal ? t('save') : t('createGoal')}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  );
}
