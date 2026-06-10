import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

type WebsiteWithGoals = Website & {
  goalConfig?: { goals: GoalConfigRow[] };
};

export function GoalFormDialog({
  open,
  onClose,
  websiteId,
  editGoal,
}: {
  open: boolean;
  onClose: () => void;
  websiteId: string;
  editGoal?: GoalConfigRow | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(editGoal);
  const [eventName, setEventName] = useState('');
  const [target, setTarget] = useState('');
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('monthly');

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: open && Boolean(websiteId),
    queryFn: () => api<WebsiteWithGoals>(`/api/websites/${websiteId}`),
  });

  useEffect(() => {
    if (!open) return;
    if (editGoal) {
      setEventName(editGoal.event);
      setTarget(String(editGoal.target));
      setPeriod(editGoal.period || 'monthly');
      return;
    }
    setEventName('');
    setTarget('');
    setPeriod('monthly');
  }, [open, editGoal]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const trimmed = eventName.trim();
      const targetNum = parseInt(target, 10);
      if (!trimmed || !targetNum || targetNum < 1) throw new Error(t('goalInvalid'));
      const existing = websiteQuery.data?.goalConfig?.goals ?? [];
      const nextGoal: GoalConfigRow = { event: trimmed, target: targetNum, period };
      const goals = isEdit
        ? existing.map((g) => (g.event === editGoal!.event ? nextGoal : g))
        : [...existing.filter((g) => g.event !== trimmed), nextGoal];
      return api(`/api/websites/${websiteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ goalConfig: { goals } }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['website', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['reports-goal', websiteId] });
      onClose();
    },
  });

  if (!open) return null;

  const targetNum = parseInt(target, 10);
  const canSave =
    eventName.trim().length > 0 && targetNum >= 1 && !saveMutation.isPending && !websiteQuery.isLoading;

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-panel goal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? t('goalEdit') : t('createGoal')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <h2 className="dialog-title">{isEdit ? t('goalEdit') : t('createGoal')}</h2>
        </header>

        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="goal-dialog-event">{t('goalEventName')}</Label>
            <Input
              id="goal-dialog-event"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="signup"
              disabled={isEdit}
              autoFocus={!isEdit}
            />
          </div>

          <div className="field">
            <Label htmlFor="goal-dialog-target">{t('goalTarget')}</Label>
            <Input
              id="goal-dialog-target"
              type="number"
              min={1}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              autoFocus={isEdit}
            />
          </div>

          <div className="field">
            <Label htmlFor="goal-dialog-period">{t('goalPeriodUsed')}</Label>
            <select
              id="goal-dialog-period"
              className="select"
              value={period}
              onChange={(e) => setPeriod(e.target.value as GoalConfigRow['period'])}
            >
              <option value="daily">{t('goalPeriod_daily')}</option>
              <option value="weekly">{t('goalPeriod_weekly')}</option>
              <option value="monthly">{t('goalPeriod_monthly')}</option>
            </select>
          </div>
        </div>

        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saveMutation.isPending}>
            {t('cancel')}
          </Button>
          <Button type="button" variant="primary" disabled={!canSave} onClick={() => saveMutation.mutate()}>
            {t('save')}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
