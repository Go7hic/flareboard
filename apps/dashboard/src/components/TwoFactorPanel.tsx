import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Download, KeyRound, ShieldCheck } from 'lucide-react';
import { KvList } from './KvList';
import { QrCode } from './QrCode';
import { SectionCard } from './SectionCard';
import { StatusBadge } from './StatusBadge';
import { TwoFactorCodeField } from './TwoFactorCodeField';
import { CopyButton } from './workspace/CopyButton';
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
import { Skeleton } from './ui/skeleton';
import { api } from '../lib/api';
import { formatDateOnly, formatNumber } from '../lib/format';
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

  function cancelSetup() {
    setSetup(null);
    setEnableCode('');
    enableMutation.reset();
  }

  const status = statusQuery.data;

  return (
    <SectionCard
      title={t('twoFactorTitle')}
      description={t('twoFactorLead')}
      actions={
        status ? (
          status.enabled ? (
            <StatusBadge tone="success">{t('twoFactorOn')}</StatusBadge>
          ) : (
            <StatusBadge>{t('workspaceTwoFactorOff')}</StatusBadge>
          )
        ) : null
      }
    >
      {statusQuery.isLoading ? <Skeleton className="h-10 w-full" /> : null}
      {statusQuery.error ? (
        <p className="text-danger" role="alert">
          {(statusQuery.error as Error).message}
        </p>
      ) : null}

      {freshCodes ? (
        <RecoveryCodesReveal codes={freshCodes} username={username} onDone={() => setFreshCodes(null)} />
      ) : null}

      {status && !status.enabled && !setup ? (
        <div className="ws-form-actions">
          <Button type="button" variant="primary" disabled={setupMutation.isPending} onClick={() => setupMutation.mutate()}>
            <ShieldCheck aria-hidden />
            {status.pending ? t('twoFactorContinueSetup') : t('twoFactorSetUp')}
          </Button>
          {setupMutation.error ? (
            <p className="text-danger" role="alert">
              {twoFactorErrorMessage(setupMutation.error)}
            </p>
          ) : null}
        </div>
      ) : null}

      {status && !status.enabled && setup ? (
        <div className="ws-2fa-setup">
          <div className="ws-2fa-qr">
            <QrCode value={setup.otpauthUri} size={168} label={t('twoFactorQrLabel')} />
          </div>
          <form className="ws-2fa-steps" onSubmit={onEnable}>
            <p className="ws-2fa-step">{t('twoFactorScanStep')}</p>
            <div className="field">
              <span className="field-label">{t('twoFactorManualKey')}</span>
              <span className="ws-copy-cell">
                <code className="ws-code-value ws-2fa-secret" aria-label={t('twoFactorManualKey')}>
                  {groupSecret(setup.secret)}
                </code>
                <CopyButton text={setup.secret} iconOnly />
              </span>
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
            <div className="ws-form-actions">
              <Button
                type="submit"
                variant="primary"
                disabled={enableMutation.isPending || !isTotpCode(normalizeTwoFactorCode(enableCode))}
              >
                {t('twoFactorEnable')}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelSetup}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {status?.enabled ? (
        <>
          <KvList
            compact
            items={[
              {
                key: 'on',
                label: t('twoFactorEnabledOn'),
                value: status.enabledAt ? formatDateOnly(status.enabledAt) : '–',
              },
              {
                key: 'codes',
                label: t('twoFactorRecoveryCodesLeft'),
                value: (
                  <span className="ws-2fa-codes-left">
                    {formatNumber(status.recoveryCodesRemaining)}
                    {status.recoveryCodesRemaining <= LOW_RECOVERY_CODES ? (
                      <StatusBadge tone="warning">{t('twoFactorRecoveryCodesLow')}</StatusBadge>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
          <div className="ws-form-actions">
            <Button type="button" variant="outline" onClick={() => setDialog('regenerate')}>
              <KeyRound aria-hidden />
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
    </SectionCard>
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
    <div className="ws-2fa-codes" role="status">
      <p className="ws-switch-row-label">{t('twoFactorRecoveryCodesTitle')}</p>
      <p className="ws-muted-line">{t('twoFactorRecoveryCodesLead')}</p>
      <ol className="ws-2fa-codes-list">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="ws-form-actions">
        <Button type="button" variant="outline" onClick={() => void copyAll()}>
          {copied ? t('copied') : t('twoFactorCopyAll')}
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <Download aria-hidden />
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
