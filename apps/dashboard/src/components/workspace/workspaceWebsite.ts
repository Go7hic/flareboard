/**
 * The website picked on a workspace page (reports, insights, notebooks, board templates) follows
 * the visitor to the next one for the rest of the browser session.
 */
const STORAGE_KEY = 'flareboard_workspace_website';

export function rememberWorkspaceWebsite(websiteId: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, websiteId);
  } catch {
    /* storage blocked: the choice still applies on this page */
  }
}

/** The remembered website when it is still accessible, else `preferred`, else the first one. */
export function pickWorkspaceWebsite(websites: ReadonlyArray<{ id: string }>, preferred?: string | null): string {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored && websites.some((site) => site.id === stored)) return stored;
  if (preferred && websites.some((site) => site.id === preferred)) return preferred;
  return websites[0]?.id ?? '';
}
