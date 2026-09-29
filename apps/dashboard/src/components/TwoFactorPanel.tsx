import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { QrCode } from './QrCode';
import { TwoFactorCodeField } from './TwoFactorCodeField';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Panel } from './ui/panel';
import { Skeleton } from './ui/skeleton';
import { api } from '../lib/api';
import { formatDateOnly } from '../lib/format';
import { t } from '../lib/i18n';
import {
  groupSecret,
  isTotpCode,
  normalizeTwoFactorCode,
  recoveryCodesFile,
  twoFactorErrorMessage,
} from '../lib/two-factor';

type TwoFactorStatus = {
  enabled: boolean;
  pending: boolean;
  enabledAt: number | null;
  recoveryCodesRemaining: number;
};

type SetupResponse = { secret: string; otpauthUri: string };
type RecoveryCodesResponse = { recoveryCodes: string[] };

export const TWO_FACTOR_QUERY_KEY = ['me-2fa'];
const LOW_RECOVERY_CODES = 3;

/** Two-factor setup, status, recovery codes and disable, on the account security page. */
export function TwoFactorPanel({ username, passwordRequired }: { username: string; passwordRequired: boolean }) {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [enableCode, setEnableCode] = useState('');
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<'regenerate' | 'disable' | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  const statusQuery = useQuery({
    queryKey: TWO_FACTOR_QUERY_KEY,
    queryFn: () => api<TwoFactorStatus>('/api/me/2fa'),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: TWO_FACTOR_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    void queryClient.invalidateQueries({ queryKey: ['me-audit-log'] });
    void queryClient.invalidateQueries({ queryKey: ['teams'] });
  }

  const setupMutation = useMutation({
    mutationFn: () => api<SetupResponse>('/api/me/2fa/setup', { method: 'POST' }),
    onSuccess: (data) => {
      setSetup(data);
      setEnableCode('');
      setSecretCopied(false);
    },
  });

  const enableMutation = useMutation({
    mutationFn: (code: string) =>
      api<RecoveryCodesResponse>('/api/me/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
    onSuccess: (data) => {
      setSetup(null);
      setEnableCode('');
      setFreshCodes(data.recoveryCodes);
      refresh();
    },
  });

  function onEnable(e: FormEvent) {
    e.preventDefault();
    const code = normalizeTwoFactorCode(enableCode);
    if (isTotpCode(code)) enableMutation.mutate(code);
  }

  async function copySecret() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setSecretCopied(true);
    } catch {
      setSecretCopied(false);
    }
  }

  function cancelSetup() {
    setSetup(null);
    setEnableCode('');
    enableMutation.reset();
  }

  const status = statusQuery.data;

  return (
    <Panel aria-labelledby="two-factor-title">
      <div className="security-panel-head">
        <div>
          <h2 id="two-factor-title" className="section-title">
            {t('twoFactorTitle')}
          </h2>
          <p className="section-lead">{t('twoFactorLead')}</p>
        </div>
        {status?.enabled ? <Badge variant="secondary">{t('twoFactorOn')}</Badge> : null}
      </div>

      {statusQuery.isLoading ? <Skeleton className="h-10 w-full" /> : null}
      {statusQuery.error ? <p className="text-danger">{(statusQuery.error as Error).message}</p> : null}

      {freshCodes ? (
        <RecoveryCodesReveal codes={freshCodes} username={username} onDone={() => setFreshCodes(null)} />
      ) : null}

      {status && !status.enabled && !setup ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" disabled={setupMutation.isPending} onClick={() => setupMutation.mutate()}>
            {status.pending ? t('twoFactorContinueSetup') : t('twoFactorSetUp')}
          </Button>
          {setupMutation.error ? <p className="text-danger">{twoFactorErrorMessage(setupMutation.error)}</p> : null}
        </div>
      ) : null}

      {status && !status.enabled && setup ? (
        <div className="two-factor-setup">
          <div className="two-factor-qr">
            <QrCode value={setup.otpauthUri} size={176} label={t('twoFactorQrLabel')} />
          </div>
          <form className="two-factor-setup-steps" onSubmit={onEnable}>
            <p className="text-sm">{t('twoFactorScanStep')}</p>
            <div className="field">
              <span className="field-label">{t('twoFactorManualKey')}</span>
              <div className="flex flex-wrap items-center gap-2">
                <code className="two-factor-secret" aria-label={t('twoFactorManualKey')}>
                  {groupSecret(setup.secret)}
                </code>
                <Button type="button" variant="secondary" size="sm" onClick={() => void copySecret()}>
                  {secretCopied ? t('copied') : t('copyToClipboard')}
                </Button>
              </div>
            </div>
            <TwoFactorCodeField
              id="two-factor-enable-code"
              value={enableCode}
              onChange={setEnableCode}
              allowRecovery={false}
              disabled={enableMutation.isPending}
            />
            {enableMutation.error ? (
              <p className="text-danger" role="alert">
                {twoFactorErrorMessage(enableMutation.error)}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={enableMutation.isPending || !isTotpCode(normalizeTwoFactorCode(enableCode))}
              >
                {t('twoFactorEnable')}
              </Button>
              <Button type="button" variant="outline" onClick={cancelSetup}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {status?.enabled ? (
        <>
          <dl className="security-facts">
            <div>
              <dt>{t('twoFactorEnabledOn')}</dt>
              <dd>{status.enabledAt ? formatDateOnly(status.enabledAt) : '—'}</dd>
            </div>
            <div>
              <dt>{t('twoFactorRecoveryCodesLeft')}</dt>
              <dd className="flex items-center gap-2">
                <span className="font-mono">{status.recoveryCodesRemaining}</span>
                {status.recoveryCodesRemaining <= LOW_RECOVERY_CODES ? (
                  <Badge variant="warning">{t('twoFactorRecoveryCodesLow')}</Badge>
                ) : null}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog('regenerate')}>
              {t('twoFactorRegenerate')}
            </Button>
            <Button type="button" variant="danger" onClick={() => setDialog('disable')}>
              {t('twoFactorDisable')}
            </Button>
          </div>
        </>
      ) : null}

      <CodeDialog
        open={dialog === 'regenerate'}
        onOpenChange={(open) => setDialog(open ? 'regenerate' : null)}
        title={t('twoFactorRegenerateTitle')}
        description={t('twoFactorRegenerateBody')}
        submitLabel={t('twoFactorRegenerate')}
        askPassword={false}
        submit={async ({ code }) => {
          const data = await api<RecoveryCodesResponse>('/api/me/2fa/recovery-codes', {
            method: 'POST',
            body: JSON.stringify({ code }),
          });
          setFreshCodes(data.recoveryCodes);
          refresh();
        }}
      />
      <CodeDialog
        open={dialog === 'disable'}
        onOpenChange={(open) => setDialog(open ? 'disable' : null)}
        title={t('twoFactorDisableTitle')}
        description={t('twoFactorDisableBody')}
        submitLabel={t('twoFactorDisable')}
        destructive
        askPassword={passwordRequired}
        submit={async ({ code, password }) => {
          await api<{ ok: boolean }>('/api/me/2fa/disable', {
            method: 'POST',
            body: JSON.stringify(passwordRequired ? { password, code } : { code }),
          });
          setFreshCodes(null);
          refresh();
        }}
      />
    </Panel>
  );
}

/** Recovery codes, shown once right after enabling or regenerating. */
function RecoveryCodesReveal({ codes, username, onDone }: { codes: string[]; username: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob([recoveryCodesFile(codes, username)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'flareboard-recovery-codes.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="two-factor-codes" role="status">
      <h3 className="section-title">{t('twoFactorRecoveryCodesTitle')}</h3>
      <p className="section-lead">{t('twoFactorRecoveryCodesLead')}</p>
      <ol className="two-factor-codes-list">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void copyAll()}>
          {copied ? t('copied') : t('twoFactorCopyAll')}
        </Button>
        <Button type="button" variant="secondary" onClick={download}>
          {t('twoFactorDownload')}
        </Button>
        <Button type="button" variant="primary" onClick={onDone}>
          {t('twoFactorSavedCodes')}
        </Button>
      </div>
    </div>
  );
}

/** Asks for a current code (and the password when disabling a password account). */
function CodeDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  destructive = false,
  askPassword,
  submit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  destructive?: boolean;
  askPassword: boolean;
  submit: (input: { code: string; password: string }) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => submit({ code: normalizeTwoFactorCode(code), password }),
    onSuccess: () => handleOpenChange(false),
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      setCode('');
      setPassword('');
      mutation.reset();
    }
    onOpenChange(next);
  }

  const canSubmit = normalizeTwoFactorCode(code).length >= 6 && (!askPassword || password.length > 0) && !mutation.isPending;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (canSubmit) mutation.mutate();
  }

  const errorMessage = twoFactorErrorMessage(mutation.error);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {askPassword ? (
            <div className="grid gap-2">
              <Label htmlFor="two-factor-dialog-password">{t('password')}</Label>
              <Input
                id="two-factor-dialog-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </div>
          ) : null}
          <TwoFactorCodeField id="two-factor-dialog-code" value={code} onChange={setCode} autoFocus={!askPassword} />
          {errorMessage ? (
            <p className="text-danger text-sm" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant={destructive ? 'danger' : 'primary'} disabled={!canSubmit}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
