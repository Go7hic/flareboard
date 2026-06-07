export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'flareboard-theme';
const THEME_CHANGE_EVENT = 'flareboard-theme-change';

export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* private mode */
  }
  return null;
}

export function getPreferredTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(): Theme {
  return getStoredTheme() ?? getPreferredTheme();
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function initTheme() {
  applyTheme(resolveTheme());
}

export function toggleTheme(): Theme {
  const next = resolveTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export const themeChangeEventName = THEME_CHANGE_EVENT;
