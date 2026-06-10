import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, type Website } from '../lib/api';
import { t } from '../lib/i18n';

export function WebsiteSwitcher() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const websitesQuery = useQuery({
    queryKey: ['websites'],
    queryFn: () => api<Website[]>('/api/websites'),
    staleTime: 60_000,
  });

  const websites = websitesQuery.data ?? [];
  const current =
    websites.find((site) => site.id === websiteId) ??
    (websiteId ? { id: websiteId, name: t('website') } : null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function switchTo(nextId: string) {
    if (!websiteId || nextId === websiteId) {
      setOpen(false);
      return;
    }
    const suffix = location.pathname.replace(`/websites/${websiteId}`, '') || '';
    navigate(`/websites/${nextId}${suffix}${location.search}`);
    setOpen(false);
  }

  if (!websiteId || !current) return null;

  return (
    <div className={`website-switcher${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="website-switcher-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-label={t('switchWebsite')}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
      >
        <svg
          className="website-switcher-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span className="website-switcher-name">{current.name}</span>
        <svg
          className="website-switcher-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="website-switcher-menu"
          aria-label={t('switchWebsite')}
        >
          {websitesQuery.isLoading ? (
            <li className="website-switcher-status">{t('loading')}</li>
          ) : null}
          {!websitesQuery.isLoading && websites.length === 0 ? (
            <li className="website-switcher-status">{t('noWebsites')}</li>
          ) : null}
          {websites.map((site) => (
            <li key={site.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={site.id === websiteId}
                className={`website-switcher-option${site.id === websiteId ? ' is-active' : ''}`}
                onClick={() => switchTo(site.id)}
              >
                <span className="website-switcher-option-name">{site.name}</span>
                {site.domain ? (
                  <span className="website-switcher-option-domain">{site.domain}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
