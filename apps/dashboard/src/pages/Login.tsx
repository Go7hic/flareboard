import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import { ThemeToggle } from '../components/ThemeToggle';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, API_URL, setToken, type LoginResponse } from '../lib/api';
import { t } from '../lib/i18n';

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
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

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
          const res = await api<LoginResponse>('/api/auth/verify-email', {
            method: 'POST',
            body: JSON.stringify({ token: verify }),
          });
          setToken(res.token);
          setSearchParams({}, { replace: true });
          navigate('/websites', { replace: true });
        } catch (err) {
          setError(err instanceof Error ? err.message : t('requestFailed'));
          setSearchParams({}, { replace: true });
        }
      })();
      return;
    }

    const token = searchParams.get('token');
    const next = searchParams.get('next') ?? '/websites';
    if (token) {
      setToken(token);
      window.flareboard?.track('login_success');
      navigate(next, { replace: true });
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
      setError(oauthError);
      setSearchParams({}, { replace: true });
    }
  }, [navigate, searchParams, setSearchParams]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setToken(res.token);
      window.flareboard?.track('login_success');
      navigate('/websites');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginFailed'));
    }
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
    window.location.href = `${API_URL}/api/auth/oauth/${provider}?returnTo=${encodeURIComponent('/websites')}`;
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
          <span className="login-edge-badge">
            <span className="live-dot" aria-hidden />
            Privacy-first analytics
          </span>
          <div className="login-brand">
            <BrandLogo showWordmark={false} size={32} />
            <h1>{mode === 'forgot' ? t('forgotPassword') : mode === 'reset' ? t('resetPassword') : t('signIn')}</h1>
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
                  <Label htmlFor="password">{t('password')}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('password')}
                    autoComplete="current-password"
                  />
                </div>
                {error ? <p className="text-danger" style={{ marginBottom: '1rem' }}>{error}</p> : null}
                {message ? <p className="text-muted" style={{ marginBottom: '1rem' }}>{message}</p> : null}
                <Button variant="primary" className="w-full" type="submit">
                  {t('continueToDashboard')}
                </Button>
              </form>
              <p style={{ marginTop: '0.75rem', textAlign: 'center' }}>
                <Button type="button" variant="ghost" size="sm" onClick={() => setMode('forgot')}>
                  {t('forgotPassword')}
                </Button>
              </p>
              {registrationEnabled ? (
                <p style={{ marginTop: '0.75rem', textAlign: 'center' }} className="text-muted">
                  {t('noAccount')}{' '}
                  <Link to="/register">{t('createAccount')}</Link>
                </p>
              ) : null}
              {oauthProviders.length ? (
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
