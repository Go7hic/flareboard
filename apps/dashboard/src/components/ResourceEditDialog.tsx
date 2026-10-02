import type { ReactNode } from 'react';
import { ModalDialog } from './ModalDialog';
import { Button } from './ui/button';
import { t } from '../lib/i18n';

type ResourceEditDialogProps = {
  title: string;
  /** One line under the title (what the form creates). */
  description?: ReactNode;
  ariaLabel: string;
  panelClassName?: string;
  bodyClassName?: string;
  saving: boolean;
  error: Error | null;
  canSave: boolean;
  /** Primary button text; defaults to "Save". */
  saveLabel?: string;
  /** Left side of the footer (secondary actions such as "Back"). */
  footerStart?: ReactNode;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
};

/** Create / edit form dialog: title block, scrolling body, sticky footer with Cancel and Save. */
export function ResourceEditDialog({
  title,
  description,
  ariaLabel,
  panelClassName,
  bodyClassName,
  saving,
  error,
  canSave,
  saveLabel,
  footerStart,
  onClose,
  onSave,
  children,
}: ResourceEditDialogProps) {
  return (
    <ModalDialog className={panelClassName} aria-label={ariaLabel} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{title}</h2>
        {description ? <p className="dialog-description">{description}</p> : null}
      </header>
      <div className={['dialog-body', bodyClassName].filter(Boolean).join(' ')}>
        {children}
        {error ? (
          <p className="text-danger" role="alert">
            {error.message}
          </p>
        ) : null}
      </div>
      <footer className="dialog-footer">
        {footerStart ? <div className="product-dialog-footer-start">{footerStart}</div> : null}
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          {t('cancel')}
        </Button>
        <Button type="button" variant="primary" disabled={!canSave} onClick={onSave}>
          {saving ? t('saving') : (saveLabel ?? t('save'))}
        </Button>
      </footer>
    </ModalDialog>
  );
}
