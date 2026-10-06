import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import { ThemeToggle } from '../components/ThemeToggle';
import { TwoFactorCodeField } from '../components/TwoFactorCodeField';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { preloadConsole } from '../lib/consoleChunks';
import {
  api,
  ApiError,
  API_URL,
  bootstrapSession,
  isTwoFactorChallenge,
  markSession,
  type LoginResponse,
  type LoginResult,
} from '../lib/api';
import { t } from '../lib/i18n';
import { normalizeTwoFactorCode, twoFactorErrorMessage } from '../lib/two-factor';

const POST_LOGIN_PATH = '/dashboard';

/** Same-origin path to continue to after sign-in (from `?next=`); anything else goes to the dashboard. */
function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return POST_LOGIN_PATH;
  return raw;
}

/** Callback error codes from the API that have a readable explanation. */
const OAUTH_ERROR_KEYS: Record<string, string> = {
  oauth_account_not_linked: 'oauthErrorNotLinked',
  oauth_identity_in_use: 'oauthErrorIdentityInUse',
};

interface AppConfig {
  oauth?: string[];
  disableLogin?: boolean;
  registrationEnabled?: boolean;
  environment?: string;
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [oauthProviders, setOauthProviders] = useState<string[]>([]);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [environment, setEnvironment] = useState('development');
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset' | 'two-factor'>('login');
  /** Pending second step: the short-lived challenge from the first step and where to go after. */
  const [twoFactor, setTwoFactor] = useState<{ challenge: string; next: string } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorPending, setTwoFactorPending] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  /** The account's email is not verified (sign-in refused or the link expired): offer a new link. */
  const [unverified, setUnverified] = useState(false);

  // Signing in leads into the console: fetch it while the form is filled in.
  useEffect(preloadConsole, []);

  /** Finish a first-step response: either signed in, or on to the two-factor step. */
  function completeSignIn(res: LoginResult, next: string, { replace = false } = {}) {
    if (isTwoFactorChallenge(res)) {
      setTwoFactor({ challenge: res.challenge, next });
      setTwoFactorCode('');
      setError(null);
      setMessage(null);
      setMode('two-factor');
      return;
    }
    markSession(true);
    window.flareboard?.track('login_success');
    navigate(next, { replace });
  }

  useEffect(() => {
    api<AppConfig>('/api/config')
      .then((cfg) => {
        setOauthProviders(cfg.oauth ?? []);
        setRegistrationEnabled(Boolean(cfg.registrationEnabled));
        setEnvironment(cfg.environment ?? 'development');
      })
      .catch(() => {});

    const verify = searchParams.get('verify');
    if (verify) {
      void (async () => {
        try {
          const res = await api<LoginResult>('/api/auth/verify-email', {
            method: 'POST',
            body: JSON.stringify({ token: verify }),
          });
          setSearchParams({}, { replace: true });
          completeSignIn(res, POST_LOGIN_PATH, { replace: true });
        } catch {
          setError(t('verifyLinkInvalid'));
          setUnverified(true);
          setSearchParams({}, { replace: true });
        }
      })();
      return;
    }

    const code = searchParams.get('code');
    const next = safeNextPath(searchParams.get('next'));
    if (code) {
      void (async () => {
        try {
          const res = await api<LoginResult>('/api/auth/oauth/exchange', {
            method: 'POST',
            body: JSON.stringify({ code }),
          });
          setSearchParams({}, { replace: true });
          completeSignIn(res, next, { replace: true });
        } catch {
          setError(t('requestFailed'));
          setSearchParams({}, { replace: true });
        }
      })();
      return;
    }

    const reset = searchParams.get('reset');
    if (reset) {
      setResetToken(reset);
      setMode('reset');
      setSearchParams({}, { replace: true });
    }

    const oauthError = searchParams.get('error');
    if (oauthError) {
      const known = OAUTH_ERROR_KEYS[oauthError];
      setError(known ? t(known) : oauthError);
      setSearchParams({}, { replace: true });
      return;
    }

    // Already signed in (e.g. an old tab or a bookmarked /login): continue instead of asking again.
    // Clearing ?verify / ?code re-runs this effect; a pending two-factor step is not signed in yet.
    if (!reset) {
      void bootstrapSession().then((active) => {
        if (active) navigate(next, { replace: true });
      });
    }
  }, [navigate, searchParams, setSearchParams]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const res = await api<LoginResult>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      completeSignIn(res, safeNextPath(searchParams.get('next')));
    } catch (err) {
      if (err instanceof ApiError && err.data?.code === 'email_unverified') {
        setUnverified(true);
        setError(t('loginEmailUnverified'));
        return;
      }
      setError(err instanceof Error ? err.message : t('loginFailed'));
    }
  }

  async function onResendVerification() {
    setError(null);
    setMessage(null);
    try {
      await api('/api/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email: username.trim() }),
      });
      setMessage(t('verificationResent'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'));
    }
  }

  async function onTwoFactor(e: FormEvent) {
    e.preventDefault();
    const code = normalizeTwoFactorCode(twoFactorCode);
    if (!twoFactor || !code || twoFactorPending) return;
    setError(null);
    setTwoFactorPending(true);
    try {
      await api<LoginResponse>('/api/auth/login/2fa', {
        method: 'POST',
        body: JSON.stringify({ challenge: twoFactor.challenge, code }),
      });
      markSession(true);
      window.flareboard?.track('login_success');
      navigate(twoFactor.next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.data?.code === 'challenge_expired') {
        backToPasswordStep();
        setError(t('twoFactorChallengeExpired'));
      } else {
        setError(twoFactorErrorMessage(err) ?? t('loginFailed'));
      }
    } finally {
      setTwoFactorPending(false);
    }
  }

  function backToPasswordStep() {
    setTwoFactor(null);
    setTwoFactorCode('');
    setPassword('');
    setError(null);
    setMessage(null);
    setMode('login');
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      setMessage(t('resetLinkSent'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'));
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, password: newPassword }),
      });
      setMessage(t('passwordUpdated'));
      setMode('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('resetFailed'));
    }
  }

  function oauthStart(provider: string) {
    const returnTo = safeNextPath(searchParams.get('next'));
    window.location.href = `${API_URL}/api/auth/oauth/${provider}?returnTo=${encodeURIComponent(returnTo)}`;
  }

  const emailLoginUi = registrationEnabled && environment === 'production';

  return (
    <div className="login-page">
      <div className="login-layout">
        <div className="login-top">
          <Link to="/" className="shell-brand">
            <BrandLogo />
          </Link>
          <ThemeToggle />
        </div>
        <div className="login-card">
          <div className="login-brand">
            <h1>
              {mode === 'forgot'
                ? t('forgotPassword')
                : mode === 'reset'
                  ? t('resetPassword')
                  : mode === 'two-factor'
                    ? t('twoFactorTitle')
                    : t('signIn')}
            </h1>
            {mode === 'login' ? <p className="login-subtitle">{t('loginSubtitle')}</p> : null}
          </div>
          {mode === 'login' ? (
            <>
              <form onSubmit={onSubmit}>
                <div className="field">
                  <Label htmlFor="username">{emailLoginUi ? t('email') : t('username')}</Label>
                  <Input
                    id="username"
                    type={emailLoginUi ? 'email' : 'text'}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={emailLoginUi ? t('email') : t('username')}
                    autoComplete={emailLoginUi ? 'email' : 'username'}
                  />
                </div>
                <div className="field">
                  <div className="login-label-row">
                    <Label htmlFor="password">{t('password')}</Label>
                    <button type="button" className="login-inline-link" onClick={() => setMode('forgot')}>
                      {t('forgotPassword')}
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('password')}
                    autoComplete="current-password"
                  />
                </div>
                {error ? <p className="text-danger mb-4">{error}</p> : null}
                {message ? <p className="text-muted mb-4">{message}</p> : null}
                {unverified ? (
                  <p className="login-resend text-muted mb-4">
                    {t('resendVerificationPrompt')}{' '}
                    <button
                      type="button"
                      className="login-inline-link"
                      disabled={!username.includes('@')}
                      onClick={() => void onResendVerification()}
                    >
                      {t('resendVerification')}
                    </button>
                  </p>
                ) : null}
                <Button variant="primary" size="lg" className="w-full" type="submit">
                  {t('continueToDashboard')}
                </Button>
              </form>
              {registrationEnabled ? (
                <p className="login-footer-link text-muted">
                  {t('noAccount')}{' '}
                  <Link to="/register">{t('createAccount')}</Link>
                </p>
              ) : null}
              {oauthProviders.length ? (
                <div className="mt-4 flex flex-col gap-2">
                  {oauthProviders.includes('google') ? (
                    <Button type="button" variant="secondary" className="w-full" onClick={() => oauthStart('google')}>
                      {t('signInWithGoogle')}
                    </Button>
                  ) : null}
                  {oauthProviders.includes('github') ? (
                    <Button type="button" variant="secondary" className="w-full" onClick={() => oauthStart('github')}>
                      {t('signInWithGitHub')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : mode === 'two-factor' ? (
            <form onSubmit={onTwoFactor}>
              <p className="login-hint">{t('twoFactorLoginHint')}</p>
              <TwoFactorCodeField
                id="two-factor-code"
                value={twoFactorCode}
                onChange={setTwoFactorCode}
                autoFocus
                disabled={twoFactorPending}
              />
              {error ? (
                <p className="text-danger mb-4" role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                variant="primary"
                className="w-full"
                type="submit"
                disabled={twoFactorPending || !normalizeTwoFactorCode(twoFactorCode)}
              >
                {t('twoFactorVerify')}
              </Button>
              <Button type="button" variant="ghost" className="w-full mt-2" onClick={backToPasswordStep}>
                {t('backToSignIn')}
              </Button>
            </form>
          ) : mode === 'forgot' ? (
            <form onSubmit={onForgot}>
              <p className="login-hint">{t('forgotPasswordHint')}</p>
              <div className="field">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('username')}
                />
              </div>
              {error ? <p className="text-danger">{error}</p> : null}
              {message ? <p className="text-muted">{message}</p> : null}
              <Button variant="primary" className="w-full" type="submit">
                {t('sendResetLink')}
              </Button>
              <Button type="button" variant="ghost" className="w-full mt-2" onClick={() => setMode('login')}>
                {t('backToSignIn')}
              </Button>
            </form>
          ) : (
            <form onSubmit={onReset}>
              <div className="field">
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('newPassword')}
                />
              </div>
              {error ? <p className="text-danger">{error}</p> : null}
              {message ? <p className="text-muted">{message}</p> : null}
              <Button variant="primary" className="w-full" type="submit">
                {t('updatePassword')}
              </Button>
              <Button type="button" variant="ghost" className="w-full mt-2" onClick={() => setMode('login')}>
                {t('backToSignIn')}
              </Button>
            </form>
          )}
          <p className="login-footer-link">
            <Link to="/">← {t('backToMarketing')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
