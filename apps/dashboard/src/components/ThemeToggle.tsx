import { useEffect, useState } from 'react';
import { resolveTheme, setTheme, themeChangeEventName, type Theme } from '../lib/theme';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof document !== 'undefined' ? resolveTheme() : 'light',
  );

  useEffect(() => {
    const sync = () => setThemeState(resolveTheme());
    sync();
    window.addEventListener(themeChangeEventName, sync);
    return () => window.removeEventListener(themeChangeEventName, sync);
  }, []);

  function onToggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  }

  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      className={`theme-toggle${theme === 'dark' ? ' is-dark' : ''}${className ? ` ${className}` : ''}`}
      onClick={onToggle}
      aria-label={label}
      title={label}
    >
      <span className="theme-toggle-track" aria-hidden>
        <span className="theme-toggle-icons">
          <svg className="theme-toggle-sun" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
          <svg className="theme-toggle-moon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </span>
        <span className={`theme-toggle-thumb${theme === 'dark' ? ' is-dark' : ''}`} />
      </span>
    </button>
  );
}
