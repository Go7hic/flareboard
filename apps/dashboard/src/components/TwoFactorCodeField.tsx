import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { t } from '../lib/i18n';

/**
 * One input for a two-factor code: a 6-digit authenticator code by default (numeric keypad,
 * `one-time-code` autofill), or a recovery code like `abcde-fghij` after "Use a recovery code".
 */
export function TwoFactorCodeField({
  id,
  value,
  onChange,
  allowRecovery = true,
  autoFocus = false,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  allowRecovery?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [recovery, setRecovery] = useState(false);

  function toggle() {
    setRecovery((current) => !current);
    onChange('');
  }

  return (
    <div className="field">
      <Label htmlFor={id}>{recovery ? t('twoFactorRecoveryCode') : t('twoFactorAuthCode')}</Label>
      <Input
        key={recovery ? 'recovery' : 'totp'}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
        disabled={disabled}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        {...(recovery
          ? { inputMode: 'text' as const, autoComplete: 'off', placeholder: 'abcde-fghij', maxLength: 32 }
          : {
              inputMode: 'numeric' as const,
              autoComplete: 'one-time-code',
              placeholder: '123456',
              maxLength: 7,
            })}
      />
      {allowRecovery ? (
        <Button type="button" variant="link" size="sm" className="two-factor-code-toggle" onClick={toggle}>
          {recovery ? t('twoFactorUseAuthApp') : t('twoFactorUseRecoveryCode')}
        </Button>
      ) : null}
    </div>
  );
}
