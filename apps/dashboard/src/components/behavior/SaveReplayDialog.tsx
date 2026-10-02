import { useState } from 'react';
import { ModalDialog } from '../ModalDialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { t } from '../../lib/i18n';

/** Name and save a replay so it stays in the Saved list after it leaves the date range. */
export function SaveReplayDialog({
  defaultName,
  pending,
  error,
  onSave,
  onClose,
}: {
  defaultName: string;
  pending: boolean;
  error?: string | null;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const trimmed = name.trim();

  return (
    <ModalDialog className="behavior-save-replay-dialog" aria-label={t('saveReplay')} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed && !pending) onSave(trimmed);
        }}
      >
        <header className="dialog-header">
          <h2 className="dialog-title">{t('saveReplay')}</h2>
          <p className="dialog-description">{t('behaviorReplaySaveLead')}</p>
        </header>
        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="save-replay-name">{t('behaviorReplayName')}</Label>
            <Input
              id="save-replay-name"
              value={name}
              placeholder={t('replayNamePlaceholder')}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          {error ? (
            <p className="text-danger behavior-goal-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!trimmed || pending}>
            {pending ? t('saving') : t('saveReplay')}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  );
}
