import { useEffect, useState } from 'react';
import { resolveTheme, themeChangeEventName, type Theme } from './theme';

/** The dashboard's current light/dark theme, updated when the user or the OS switches it. */
export function useResolvedTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme());
  useEffect(() => {
    const update = () => setTheme(resolveTheme());
    window.addEventListener(themeChangeEventName, update);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    return () => {
      window.removeEventListener(themeChangeEventName, update);
      mq.removeEventListener('change', update);
    };
  }, []);
  return theme;
}
