import type { ReactNode } from 'react';
import { ModalDialog } from './ModalDialog';
import { Button } from './ui/button';
import { t } from '../lib/i18n';

type ResourceEditDialogProps = {
  title: string;
  ariaLabel: string;
  panelClassName?: string;
  bodyClassName?: string;
  saving: boolean;
  error: Error | null;
  canSave: boolean;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
};

export function ResourceEditDialog({
  title,
  ariaLabel,
  panelClassName,
  bodyClassName,
  saving,
  error,
  canSave,
  onClose,
  onSave,
  children,
}: ResourceEditDialogProps) {
  return (
    <ModalDialog className={panelClassName} aria-label={ariaLabel} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{title}</h2>
      </header>
      <div className={['dialog-body', bodyClassName].filter(Boolean).join(' ')}>
        {children}
        {error ? <p className="text-danger">{error.message}</p> : null}
      </div>
      <footer className="dialog-footer">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          {t('cancel')}
        </Button>
        <Button type="button" variant="primary" disabled={!canSave} onClick={onSave}>
          {saving ? t('saving') : t('save')}
        </Button>
      </footer>
    </ModalDialog>
  );
}
