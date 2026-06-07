import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import { ThemeToggle } from '../components/ThemeToggle';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { t } from '../lib/i18n';

interface AppConfig {
  registrationEnabled?: boolean;
}

export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    api<AppConfig>('/api/config')
      .then((cfg) => {
        setEnabled(Boolean(cfg.registrationEnabled));
        if (!cfg.registrationEnabled) navigate('/login', { replace: true });
      })
      .catch(() => setEnabled(false));
  }, [navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const res = await api<{ message?: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName: displayName || undefined }),
      });
      setMessage(res.message ?? t('registerSuccess'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'));
    }
  }

  if (enabled === null) {
    return <div className="login-page" aria-busy="true" />;
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
            <BrandLogo showWordmark={false} size={32} />
            <h1>{t('createAccount')}</h1>
          </div>
          {message ? (
            <>
              <p className="text-muted" style={{ marginBottom: '1rem' }}>{message}</p>
              <Button variant="primary" className="w-full" asChild>
                <Link to="/login">{t('backToSignIn')}</Link>
              </Button>
            </>
          ) : (
            <form onSubmit={onSubmit}>
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
              {error ? <p className="text-danger" style={{ marginBottom: '1rem' }}>{error}</p> : null}
              <Button variant="primary" className="w-full" type="submit">
                {t('createAccount')}
              </Button>
            </form>
          )}
          <p className="login-footer-link" style={{ marginTop: '1rem' }}>
            <Link to="/login">{t('alreadyHaveAccount')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
