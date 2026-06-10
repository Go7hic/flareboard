type AppTopBarProps = {
  menuOpen: boolean;
  onMenuToggle: () => void;
};

export function AppTopBar({ menuOpen, onMenuToggle }: AppTopBarProps) {
  return (
    <header className="shell-topbar shell-topbar--mobile">
      <button
        type="button"
        className="shell-menu-toggle"
        onClick={onMenuToggle}
        aria-expanded={menuOpen}
        aria-controls="app-sidebar"
        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    </header>
  );
}
