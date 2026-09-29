import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AiToolDisplay } from '@flareboard/shared/ai';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { ModalDialog } from '../ModalDialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

/** Saves an insight the assistant ran, through the regular insights API. */
export function SaveInsightDialog({
  websiteId,
  display,
  onClose,
  onSaved,
}: {
  websiteId: string;
  display: Extract<AiToolDisplay, { kind: 'insight' }>;
  onClose: () => void;
  onSaved: (insightId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/api/insights', {
        method: 'POST',
        body: JSON.stringify({
          websiteId,
          name: name.trim(),
          description: '',
          type: display.insightType,
          query: display.query,
        }),
      }),
    onSuccess: (insight) => {
      queryClient.invalidateQueries({ queryKey: ['insights', websiteId] });
      onSaved(insight.id);
    },
  });

  return (
    <ModalDialog aria-label={t('assistantSaveInsight')} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{t('assistantSaveInsight')}</h2>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) save.mutate();
        }}
      >
        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="assistant-insight-name">{t('name')}</Label>
            <Input
              id="assistant-insight-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          {save.isError ? <p className="text-danger" role="alert">{(save.error as Error).message}</p> : null}
        </div>
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || save.isPending}>
            {t('save')}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  );
}
