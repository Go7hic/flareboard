/*
 * The console shells are lazy chunks, so the marketing pages (landing, pricing, sign-in) do not
 * download the console, its charts or the assistant. Pages that lead into the console fetch them
 * early, so the first console screen does not wait on a chain of chunk loads.
 */
export const loadAppShell = () => import('../components/AppShell');
export const loadWebsiteShell = () => import('../components/WebsiteShell');

export function preloadConsole() {
  // A failed preload is retried by the route that needs the chunk.
  loadAppShell().catch(() => {});
  loadWebsiteShell().catch(() => {});
}
