import { FormEvent, Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import { ThemeToggle } from '../components/ThemeToggle';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, startOAuth } from '../lib/api';
import { preloadConsole } from '../lib/consoleChunks';
import { t } from '../lib/i18n';
import { failureReason, trackProductEvent } from '../lib/tracking';

interface AppConfig {
  registrationEnabled?: boolean;
  oauth?: string[];
}

const OAUTH_LABELS: Record<string, string> = { github: 'signUpWithGitHub', google: 'signUpWithGoogle' };

export default function Register() {
  const navigate = useNavigate();
  // Where the visitor came from, for the sign-up funnel ("demo" from the live demo's buttons).
  const [searchParams] = useSearchParams();
  const from = searchParams.get('from') === 'demo' ? 'demo' : 'site';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // GitHub first: most people signing up for an analytics tool for their site have an account there.
  const [oauthProviders, setOauthProviders] = useState<string[]>([]);

  // A new account lands in the console: fetch it while the form is filled in.
  useEffect(preloadConsole, []);

  // The form shows right away; waiting for the config left a blank page on slow connections.
  // Installs with sign-up turned off move on to sign-in once it arrives.
  useEffect(() => {
    api<AppConfig>('/api/config')
      .then((cfg) => {
        if (!cfg.registrationEnabled) navigate('/login', { replace: true });
        setOauthProviders(['github', 'google'].filter((provider) => cfg.oauth?.includes(provider)));
      })
      .catch(() => {});
  }, [navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    trackProductEvent('signup_submitted', { from });
    try {
      await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName: displayName || undefined }),
      });
      trackProductEvent('signup_succeeded', { from });
      setMessage(t('registerSuccess'));
    } catch (err) {
      trackProductEvent('signup_failed', { from, reason: failureReason(err) });
      setError(err instanceof Error ? err.message : t('requestFailed'));
    }
  }

  function onOAuth(provider: string) {
    trackProductEvent('oauth_started', { provider, page: 'register', from });
    startOAuth(provider, '/dashboard');
  }

  async function onResendVerification() {
    setError(null);
    try {
      await api('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) });
      trackProductEvent('verification_resent', { page: 'register' });
      setMessage(t('verificationResent'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'));
    }
  }

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
            <h1>{t('createAccount')}</h1>
          </div>
          {message ? (
            <>
              <p className="text-muted mb-4">{message}</p>
              {error ? <p className="text-danger mb-4">{error}</p> : null}
              <p className="login-resend text-muted mb-4">
                {t('resendVerificationPrompt')}{' '}
                <button type="button" className="login-inline-link" onClick={() => void onResendVerification()}>
                  {t('resendVerification')}
                </button>
              </p>
              <Button variant="primary" className="w-full" asChild>
                <Link to="/login">{t('backToSignIn')}</Link>
              </Button>
            </>
          ) : (
            <form onSubmit={onSubmit}>
              {oauthProviders.length ? (
                <>
                  <div className="login-oauth">
                    {oauthProviders.map((provider) => (
                      <Button key={provider} type="button" variant="outline" className="w-full" onClick={() => onOAuth(provider)}>
                        {t(OAUTH_LABELS[provider]!)}
                      </Button>
                    ))}
                  </div>
                  <p className="login-divider">{t('orSignUpWithEmail')}</p>
                </>
              ) : null}
              <div className="field">
                <Label htmlFor="email">{t('email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="field">
                <Label htmlFor="password">{t('password')}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <div className="field">
                <Label htmlFor="displayName">{t('displayNameOptional')}</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              {error ? <p className="text-danger mb-4">{error}</p> : null}
              <Button variant="primary" className="w-full" type="submit">
                {t('createAccount')}
              </Button>
              <p className="register-legal-consent">
                <LegalConsentText />
              </p>
            </form>
          )}
          <p className="login-footer-link">
            <Link to="/login">{t('alreadyHaveAccount')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Renders `registerAgree` with its {terms} / {privacy} placeholders as links. */
function LegalConsentText() {
  const links: Record<string, ReactNode> = {
    terms: (
      <Link to="/terms" target="_blank">
        {t('termsOfService')}
      </Link>
    ),
    privacy: (
      <Link to="/privacy" target="_blank">
        {t('privacyPolicy')}
      </Link>
    ),
  };
  return (
    <>
      {t('registerAgree')
        .split(/(\{terms\}|\{privacy\})/)
        .map((part, i) => {
          const key = part.slice(1, -1);
          return part.startsWith('{') && key in links ? <Fragment key={i}>{links[key]}</Fragment> : part;
        })}
    </>
  );
}
