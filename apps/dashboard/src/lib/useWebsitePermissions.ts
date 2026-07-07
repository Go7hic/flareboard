import { useQuery } from '@tanstack/react-query';
import { api, type WebsiteModule, type WebsitePermissions } from './api';

export function useWebsitePermissions(websiteId: string | undefined, module?: WebsiteModule) {
  const query = useQuery({
    queryKey: ['website-permissions', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<WebsitePermissions>(`/api/websites/${websiteId}/permissions`),
    staleTime: 60_000,
  });

  const permissions = query.data;
  const canEdit = module
    ? (permissions?.modules[module]?.canEdit ?? permissions?.canEdit ?? false)
    : (permissions?.canEdit ?? false);

  return {
    permissions,
    canEdit,
    isLoading: query.isLoading,
  };
}
