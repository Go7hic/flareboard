import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { api, ApiError } from '../lib/api';
import { t } from '../lib/i18n';

/**
 * Self-service account deletion (POST /api/me/delete). The user retypes their username and,
 * for password accounts, their password; the API refuses when a team would be left without
 * an owner and reports why.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  username,
  passwordRequired,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string;
  passwordRequired: boolean;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');

  const deleteMutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean }>('/api/me/delete', {
        method: 'POST',
        body: JSON.stringify({ confirm, ...(passwordRequired ? { password } : {}) }),
      }),
    onSuccess: onDeleted,
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      setConfirm('');
      setPassword('');
      deleteMutation.reset();
    }
    onOpenChange(next);
  }

  const confirmed = confirm.trim().toLowerCase() === username.toLowerCase();
  const canSubmit = confirmed && (!passwordRequired || password.length > 0) && !deleteMutation.isPending;

  const errorMessage = describeError(deleteMutation.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) deleteMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('deleteAccountTitle')}</DialogTitle>
            <DialogDescription>{t('deleteAccountBody')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="delete-account-confirm">
              {t('deleteAccountConfirmLabel').replace('{username}', username)}
            </Label>
            <Input
              id="delete-account-confirm"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </div>

          {passwordRequired ? (
            <div className="grid gap-2">
              <Label htmlFor="delete-account-password">{t('password')}</Label>
              <Input
                id="delete-account-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
          ) : null}

          {errorMessage ? (
            <p className="text-danger text-sm" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={!canSubmit}>
              {t('deleteAccountSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function describeError(error: Error | null): string | undefined {
  if (!error) return undefined;
  if (!(error instanceof ApiError)) return error.message;
  if (error.status === 401) return t('deleteAccountWrongPassword');
  switch (error.data?.code) {
    case 'only_admin':
      return t('deleteAccountOnlyAdmin');
    case 'team_owner_required': {
      const teams = Array.isArray(error.data.teams) ? error.data.teams.join(', ') : '';
      return t('deleteAccountTeamOwner').replace('{teams}', teams);
    }
    case 'billing_cancel_failed':
      return t('deleteAccountBillingFailed');
    default:
      return error.message;
  }
}
