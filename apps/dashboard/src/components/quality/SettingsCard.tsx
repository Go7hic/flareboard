import type { ReactNode } from 'react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';

/**
 * One settings topic (console v2 §7): title, description, fields, and a footer bar with a hint on
 * the left and the card's own save on the right. The save stays disabled until something changed.
 */
export function SettingsCard({
  id,
  title,
  description,
  children,
  hint,
  onSave,
  saveLabel,
  dirty = false,
  saving = false,
  saved = false,
  error,
  disabled = false,
  footer,
  className,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Footer text when there is no status to show. */
  hint?: ReactNode;
  onSave?: () => void;
  saveLabel?: string;
  dirty?: boolean;
  saving?: boolean;
  saved?: boolean;
  error?: string | null;
  /** Blocks the save (invalid input, plan lock). */
  disabled?: boolean;
  /** Replaces the default footer. */
  footer?: ReactNode;
  className?: string;
}) {
  const status = error ? (
    <span className="q-form-error" role="alert">
      {error}
    </span>
  ) : saved && !dirty ? (
    <span className="q-saved" role="status">
      {t('saved')}
    </span>
  ) : (
    hint
  );
  const showFooter = Boolean(footer || onSave || hint);
  return (
    <section id={id} className={cn('panel q-settings-card', className)}>
      <div className="q-settings-card-body">
        <h2 className="card-title">{title}</h2>
        {description ? <p className="card-description">{description}</p> : null}
        {children ? <div className="q-settings-card-content">{children}</div> : null}
      </div>
      {showFooter ? (
        <footer className="q-settings-card-foot">
          {footer ?? (
            <>
              <span className="q-settings-card-hint">{status}</span>
              {onSave ? (
                <Button type="button" size="sm" variant="primary" disabled={!dirty || saving || disabled} onClick={onSave}>
                  {saving ? t('saving') : (saveLabel ?? t('save'))}
                </Button>
              ) : null}
            </>
          )}
        </footer>
      ) : null}
    </section>
  );
}

/** A labelled switch with a hint underneath (settings rows, hairline-separated in a card). */
export function SettingSwitch({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="q-setting-row q-setting-switch">
      <div className="q-setting-copy">
        <Label htmlFor={id} className="q-setting-label">
          {label}
        </Label>
        {hint ? <p className="q-field-hint">{hint}</p> : null}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={(next) => onCheckedChange(next)} />
    </div>
  );
}
