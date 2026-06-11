/** Chart + legacy layout helpers — colors read from CSS variables at runtime */

function cssVar(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function getThemeColors() {
  return {
    bg: cssVar('--bg'),
    panel: cssVar('--bg-elevated'),
    panelSubtle: cssVar('--bg-subtle'),
    border: cssVar('--border'),
    text: cssVar('--text'),
    muted: cssVar('--text-muted'),
    faint: cssVar('--text-faint'),
    accent: cssVar('--accent'),
    accentHover: cssVar('--accent-hover'),
    accentMuted: cssVar('--accent-muted'),
    danger: cssVar('--danger'),
    success: cssVar('--success'),
    warning: cssVar('--warning'),
  };
}

/** @deprecated use getThemeColors() — kept for inline style consumers */
export const colors = {
  get bg() {
    return getThemeColors().bg;
  },
  get panel() {
    return getThemeColors().panel;
  },
  get panelSubtle() {
    return getThemeColors().panelSubtle;
  },
  get border() {
    return getThemeColors().border;
  },
  get text() {
    return getThemeColors().text;
  },
  get muted() {
    return getThemeColors().muted;
  },
  get faint() {
    return getThemeColors().faint;
  },
  get accent() {
    return getThemeColors().accent;
  },
  get accentHover() {
    return getThemeColors().accentHover;
  },
  get accentMuted() {
    return getThemeColors().accentMuted;
  },
  get danger() {
    return getThemeColors().danger;
  },
  get success() {
    return getThemeColors().success;
  },
  get warning() {
    return getThemeColors().warning;
  },
};

export const fonts = {
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
};

export const layout = {
  page: {
    minHeight: '100dvh',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: fonts.sans,
  } as const,
  container: {
    maxWidth: 1240,
    margin: '0 auto',
    padding: '1.75rem 1.5rem 3.5rem',
  } as const,
  card: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '1.35rem',
  } as const,
  input: {
    width: '100%',
    height: 'var(--control-height)',
    padding: '0 var(--control-padding-x)',
    fontSize: 'var(--control-font-size)',
    lineHeight: 'var(--control-line-height)',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    marginBottom: '0.95rem',
    boxSizing: 'border-box' as const,
  } as const,
  button: {
    padding: '0.58rem 1.05rem',
    borderRadius: 6,
    border: 'none',
    background: 'var(--accent)',
    color: 'var(--accent-on)',
    fontWeight: 600,
    fontSize: '0.875rem',
    cursor: 'pointer',
  } as const,
  link: {
    color: 'var(--accent)',
    textDecoration: 'none',
  } as const,
  pre: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    padding: '0.85rem 1rem',
    borderRadius: 6,
    overflow: 'auto',
    fontSize: '0.8125rem',
    fontFamily: fonts.mono,
  } as const,
};

/** @deprecated use layout — kept for pages using `styles` */
export const styles = {
  page: layout.container,
  card: layout.card,
  input: layout.input,
  button: layout.button,
  link: layout.link,
  pre: layout.pre,
};
