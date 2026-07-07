import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { getLocale, LOCALE_LABELS, LOCALES, setLocale, t, type Locale } from '../lib/i18n';
import { resolveTheme, setTheme, themeChangeEventName, type Theme } from '../lib/theme';

type SidebarUserMenuProps = {
  userLabel: string;
  onLogout: () => void;
};

type Flyout = 'language' | 'theme';

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ChevronRightIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`sidebar-user-menu-chevron${active ? ' is-active' : ''}`}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function positionFlyout(flyoutEl: HTMLElement, anchorEl: HTMLElement) {
  flyoutEl.classList.remove('is-flipped-x');

  const anchorRect = anchorEl.getBoundingClientRect();
  const margin = 8;
  const gap = 2;

  flyoutEl.style.visibility = 'hidden';

  let left = anchorRect.right + gap;
  let top = anchorRect.top;

  flyoutEl.style.left = `${left}px`;
  flyoutEl.style.top = `${top}px`;

  const flyoutRect = flyoutEl.getBoundingClientRect();

  if (flyoutRect.right > window.innerWidth - margin) {
    left = anchorRect.left - flyoutRect.width - gap;
    flyoutEl.style.left = `${left}px`;
    flyoutEl.classList.add('is-flipped-x');
  }

  const adjustedRect = flyoutEl.getBoundingClientRect();
  if (adjustedRect.bottom > window.innerHeight - margin) {
    top = window.innerHeight - margin - adjustedRect.height;
  }
  if (top < margin) {
    top = margin;
  }

  flyoutEl.style.top = `${top}px`;
  flyoutEl.style.visibility = '';
}

export function SidebarUserMenu({ userLabel, onLogout }: SidebarUserMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeFlyout, setActiveFlyout] = useState<Flyout | null>(null);
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof document !== 'undefined' ? resolveTheme() : 'light',
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const languageItemRef = useRef<HTMLButtonElement>(null);
  const themeItemRef = useRef<HTMLButtonElement>(null);
  const languageFlyoutRef = useRef<HTMLUListElement>(null);
  const themeFlyoutRef = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const currentLocale = getLocale();

  useEffect(() => {
    const sync = () => setThemeState(resolveTheme());
    sync();
    window.addEventListener(themeChangeEventName, sync);
    return () => window.removeEventListener(themeChangeEventName, sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveFlyout(null);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setActiveFlyout(null);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !activeFlyout) return;
    const flyoutEl =
      activeFlyout === 'language' ? languageFlyoutRef.current : themeFlyoutRef.current;
    const anchorEl =
      activeFlyout === 'language' ? languageItemRef.current : themeItemRef.current;
    if (!flyoutEl || !anchorEl) return;

    function updatePosition() {
      if (!flyoutEl || !anchorEl) return;
      positionFlyout(flyoutEl, anchorEl);
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, activeFlyout]);

  function toggleOpen() {
    setOpen((value) => {
      if (value) setActiveFlyout(null);
      return !value;
    });
  }

  function toggleFlyout(next: Flyout) {
    setActiveFlyout((current) => (current === next ? null : next));
  }

  function openFlyout(next: Flyout) {
    setActiveFlyout(next);
  }

  function closeFlyout() {
    setActiveFlyout(null);
  }

  function selectLocale(next: Locale) {
    setOpen(false);
    setActiveFlyout(null);
    if (next === currentLocale) return;
    setLocale(next);
    window.location.reload();
  }

  function selectTheme(next: Theme) {
    setTheme(next);
    setThemeState(next);
  }

  function handleLogout() {
    setOpen(false);
    setActiveFlyout(null);
    onLogout();
  }

  return (
    <div className={`sidebar-user-menu${open ? ' is-open' : ''}`} ref={rootRef}>
      {open ? (
        <div id={menuId} className="sidebar-user-menu-popover" role="menu" aria-label={userLabel}>
          <div
            className="sidebar-user-menu-flyout-group"
            onMouseEnter={() => openFlyout('language')}
            onMouseLeave={closeFlyout}
          >
            <button
              ref={languageItemRef}
              type="button"
              role="menuitem"
              className={`sidebar-user-menu-item${activeFlyout === 'language' ? ' is-active' : ''}`}
              aria-expanded={activeFlyout === 'language'}
              aria-haspopup="listbox"
              onClick={() => toggleFlyout('language')}
            >
              <span className="sidebar-user-menu-item-label">{t('language')}</span>
              <span className="sidebar-user-menu-item-meta">{LOCALE_LABELS[currentLocale]}</span>
              <ChevronRightIcon active={activeFlyout === 'language'} />
            </button>
            {activeFlyout === 'language' ? (
              <ul
                ref={languageFlyoutRef}
                className="sidebar-user-menu-flyout"
                role="listbox"
                aria-label={t('language')}
              >
                {LOCALES.map((loc) => (
                  <li key={loc} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={loc === currentLocale}
                      className={`sidebar-user-menu-flyout-option${loc === currentLocale ? ' is-active' : ''}`}
                      onClick={() => selectLocale(loc)}
                    >
                      {LOCALE_LABELS[loc]}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div
            className="sidebar-user-menu-flyout-group"
            onMouseEnter={() => openFlyout('theme')}
            onMouseLeave={closeFlyout}
          >
            <button
              ref={themeItemRef}
              type="button"
              role="menuitem"
              className={`sidebar-user-menu-item${activeFlyout === 'theme' ? ' is-active' : ''}`}
              aria-expanded={activeFlyout === 'theme'}
              aria-haspopup="listbox"
              onClick={() => toggleFlyout('theme')}
            >
              <span className="sidebar-user-menu-item-label">{t('theme')}</span>
              <span className="sidebar-user-menu-item-meta">
                {theme === 'dark' ? t('themeDark') : t('themeLight')}
              </span>
              <ChevronRightIcon active={activeFlyout === 'theme'} />
            </button>
            {activeFlyout === 'theme' ? (
              <ul
                ref={themeFlyoutRef}
                className="sidebar-user-menu-flyout"
                role="listbox"
                aria-label={t('theme')}
              >
                {(['light', 'dark'] as const).map((value) => (
                  <li key={value} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={theme === value}
                      className={`sidebar-user-menu-flyout-option${theme === value ? ' is-active' : ''}`}
                      onClick={() => selectTheme(value)}
                    >
                      {value === 'dark' ? t('themeDark') : t('themeLight')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="sidebar-user-menu-separator" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="sidebar-user-menu-item sidebar-user-menu-item--danger"
            onClick={handleLogout}
          >
            <span className="sidebar-user-menu-item-label">{t('logout')}</span>
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className="sidebar-user-menu-trigger"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-label={`${t('accountMenu')} — ${userLabel}`}
      >
        <span className="sidebar-user-menu-trigger-icon">
          <UserIcon />
        </span>
        <span className="sidebar-user-menu-trigger-label">{userLabel}</span>
      </button>
    </div>
  );
}
