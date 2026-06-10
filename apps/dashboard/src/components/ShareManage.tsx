import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { api, type ShareLink } from '../lib/api';
import { t } from '../lib/i18n';

export function ShareManage({ websiteId }: { websiteId: string }) {
  const queryClient = useQueryClient();

  const sharesQuery = useQuery({
    queryKey: ['shares'],
    queryFn: () => api<ShareLink[]>('/api/share'),
  });

  const shares = (sharesQuery.data ?? []).filter((s) => s.entityId === websiteId);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/share/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shares'] }),
  });

  const revokingId =
    deleteMutation.isPending && typeof deleteMutation.variables === 'string'
      ? deleteMutation.variables
      : null;

  return (
    <section className="section-gap-lg">
      <h3 className="section-title">{t('shareLinks')}</h3>
      {sharesQuery.isLoading ? (
        <Skeleton className="h-8 w-full" aria-hidden />
      ) : !shares.length ? (
        <p className="text-muted section-lead">No share links yet. Create one below.</p>
      ) : (
        <ul className="list-plain">
          {shares.map((s) => (
            <li key={s.id} className="list-item list-row">
              <div>
                <strong>{s.name}</strong>
                <div style={{ fontSize: '0.8125rem', wordBreak: 'break-all' }}>
                  <a href={`${window.location.origin}/share/${s.slug}`} target="_blank" rel="noreferrer">
                    {window.location.origin}/share/{s.slug}
                  </a>
                </div>
              </div>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={revokingId === s.id}
                onClick={() => deleteMutation.mutate(s.id)}
              >
                {revokingId === s.id ? t('revokingShareLink') : t('revokeShareLink')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {deleteMutation.error ? (
        <p className="text-danger">{(deleteMutation.error as Error).message}</p>
      ) : null}
    </section>
  );
}
