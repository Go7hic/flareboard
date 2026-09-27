import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { LandingPlan } from './landing-links';

/** Public `/api/config` fields the marketing pages read. */
export type PublicAppConfig = {
  hosted?: boolean;
  registrationEnabled?: boolean;
  plans?: LandingPlan[];
};

/** Shared, cached `/api/config` so nav, page body, and plan cards make one request. */
export function useAppConfig(): PublicAppConfig {
  const { data } = useQuery({
    queryKey: ['public-app-config'],
    queryFn: () => api<PublicAppConfig>('/api/config'),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data ?? {};
}

/** Sign-up target: register when open, otherwise sign in. */
export function useStartHref(): string {
  return useAppConfig().registrationEnabled ? '/register' : '/login';
}
