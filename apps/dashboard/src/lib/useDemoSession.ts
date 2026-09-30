import { useQuery } from '@tanstack/react-query';
import { api, hasSession, type MeResponse } from './api';

export function fetchMe() {
  return api<MeResponse>('/api/me');
}

/**
 * Whether the signed-in account is the shared read-only demo account. `ready` stays false until
 * `/api/me` answers, so callers can hold back requests the demo is refused (the assistant).
 */
export function useDemoSession() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    enabled: hasSession(),
    staleTime: 60_000,
  });
  return { isDemo: Boolean(me.data?.isDemo), ready: me.isSuccess || me.isError };
}

/** Pages a demo session has no use for (credentials, billing, team and link management). */
export const DEMO_HIDDEN_PATHS = ['/api-keys', '/account/security', '/billing', '/admin', '/teams', '/links'] as const;

/** Website pages a demo session has no use for (tracking snippet and project key, share links). */
const DEMO_HIDDEN_WEBSITE_PAGE = /^(\/websites\/[^/]+)\/(settings|share)(\/|$)/;

export function isDemoHiddenPath(pathname: string) {
  return (
    DEMO_HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    DEMO_HIDDEN_WEBSITE_PAGE.test(pathname)
  );
}

/** Where a demo session lands instead of a hidden page: the website overview, else the dashboard. */
export function demoRedirectTarget(pathname: string) {
  return DEMO_HIDDEN_WEBSITE_PAGE.exec(pathname)?.[1] ?? '/dashboard';
}
