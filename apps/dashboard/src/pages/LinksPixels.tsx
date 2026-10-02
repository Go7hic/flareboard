import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, ExternalLink, Image, Link2, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { ModalDialog } from '../components/ModalDialog';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { CopyButton } from '../components/workspace/CopyButton';
import { api, INGEST_URL, type Team, type TrackingLink, type TrackingPixel } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';

function pixelSnippet(slug: string) {
  return `<img src="${INGEST_URL}/p/${slug}.gif" width="1" height="1" alt="" />`;
}

function TableSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1].map((key) => (
        <div key={key} className="ws-table-skeleton-row">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function CreateDialog({
  kind,
  teamName,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  kind: 'link' | 'pixel';
  teamName?: string;
  pending: boolean;
  error: unknown;
  onSubmit: (input: { name: string; url: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const isLink = kind === 'link';
  const valid = name.trim() && (!isLink || url.trim());
  const title = isLink ? t('createLink') : t('createPixel');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) onSubmit({ name: name.trim(), url: url.trim() });
  }

  return (
    <ModalDialog className="ws-dialog--sm" aria-label={title} onClose={onClose}>
      <form onSubmit={submit}>
        <header className="dialog-header">
          <h2 className="dialog-title">{title}</h2>
          <p>{isLink ? t('shortLinksLead') : t('trackingPixelsLead')}</p>
        </header>
        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="ws-create-name">{t('name')}</Label>
            <Input id="ws-create-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          {isLink ? (
            <div className="field">
              <Label htmlFor="ws-create-url">{t('workspaceLinkDestination')}</Label>
              <Input
                id="ws-create-url"
                type="url"
                placeholder="https://example.com/landing?utm_source=…"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
          ) : null}
          <p className="field-hint">
            {teamName ? t('workspaceCreatesInTeam').replace('{team}', teamName) : t('workspaceCreatesPersonal')}
          </p>
          {error ? (
            <p className="text-danger" role="alert">
              {(error as Error).message}
            </p>
          ) : null}
        </div>
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || pending}>
            {title}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  );
}

export default function LinksPixelsPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [teamId, setTeamId] = useState(searchParams.get('teamId') ?? '');
  const [dialog, setDialog] = useState<'link' | 'pixel' | null>(null);

  const teamsQuery = useQuery({
    queryKey: ['teams'],
    queryFn: () => api<Team[]>('/api/teams'),
  });
  const team = (teamsQuery.data ?? []).find((row) => row.id === teamId);

  const linksQueryKey = ['links', teamId || 'all'];
  const pixelsQueryKey = ['pixels', teamId || 'all'];

  const linksQuery = useQuery({
    queryKey: linksQueryKey,
    queryFn: () => api<TrackingLink[]>(teamId ? `/api/links?teamId=${teamId}` : '/api/links'),
  });

  const pixelsQuery = useQuery({
    queryKey: pixelsQueryKey,
    queryFn: () => api<TrackingPixel[]>(teamId ? `/api/pixels?teamId=${teamId}` : '/api/pixels'),
  });

  const createLink = useMutation({
    mutationFn: (input: { name: string; url: string }) =>
      api<TrackingLink>('/api/links', {
        method: 'POST',
        body: JSON.stringify({ name: input.name, url: input.url, ...(teamId ? { teamId } : {}) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['links'] });
      setDialog(null);
    },
  });

  const createPixel = useMutation({
    mutationFn: (input: { name: string }) =>
      api<TrackingPixel>('/api/pixels', {
        method: 'POST',
        body: JSON.stringify({ name: input.name, ...(teamId ? { teamId } : {}) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pixels'] });
      setDialog(null);
    },
  });

  const links = linksQuery.data ?? [];
  const pixels = pixelsQuery.data ?? [];

  return (
    <Page className="ws-page-links">
      <PageHeader
        title={t('linksAndPixels')}
        lead={t('linksSubtitle')}
        actions={
          <div className="ws-header-controls">
            <select
              className="select ws-header-select"
              aria-label={t('scopeTeam')}
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
            >
              <option value="">{t('personalNoTeam')}</option>
              {(teamsQuery.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={() => setDialog('pixel')}>
              <Image aria-hidden />
              {t('createPixel')}
            </Button>
            <Button variant="primary" onClick={() => setDialog('link')}>
              <Plus aria-hidden />
              {t('createLink')}
            </Button>
          </div>
        }
      />

      <PageBody className="stack">
        <SectionCard
          flush
          title={t('shortLinks')}
          description={t('shortLinksLead')}
          actions={links.length ? <span className="ws-section-count">{formatNumber(links.length)}</span> : undefined}
        >
          <DataViewState
            loading={linksQuery.isLoading}
            error={linksQuery.isError ? linksQuery.error : null}
            onRetry={() => linksQuery.refetch()}
            loadingFallback={<TableSkeleton />}
          >
            {links.length ? (
              <div className="table-scroll">
                <table className="data-table ws-links-table">
                  <thead>
                    <tr>
                      <th>{t('name')}</th>
                      <th>{t('workspaceShortUrl')}</th>
                      <th>{t('workspaceLinkDestination')}</th>
                      <th className="ws-row-actions">
                        <span className="visually-hidden">{t('actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {links.map((link) => {
                      const shortUrl = `${INGEST_URL}/l/${link.slug}`;
                      return (
                        <tr key={link.id}>
                          <td>
                            <span className="ws-cell-title">{link.name}</span>
                            {link.teamId ? (
                              <StatusBadge tone="info" dot={false} className="ws-cell-badge">
                                {t('teamBadge')}
                              </StatusBadge>
                            ) : null}
                          </td>
                          <td>
                            <span className="ws-copy-cell">
                              <code className="ws-mono-value" title={shortUrl}>
                                {shortUrl.replace(/^https?:\/\//, '')}
                              </code>
                              <CopyButton text={shortUrl} iconOnly />
                            </span>
                          </td>
                          <td>
                            <a className="ws-external" href={link.url} target="_blank" rel="noreferrer" title={link.url}>
                              <span>{link.url.replace(/^https?:\/\//, '')}</span>
                              <ExternalLink aria-hidden />
                            </a>
                          </td>
                          <td className="ws-row-actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              render={<Link to={`/links/analytics?linkId=${encodeURIComponent(link.id)}`} />}
                            >
                              {t('viewLinkStats')}
                              <ArrowUpRight aria-hidden />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<Link2 />}
                title={t('noLinksScope')}
                description={t('workspaceLinksEmpty')}
                action={
                  <Button variant="outline" size="sm" onClick={() => setDialog('link')}>
                    {t('createLink')}
                  </Button>
                }
              />
            )}
          </DataViewState>
        </SectionCard>

        <SectionCard
          flush
          title={t('trackingPixels')}
          description={t('trackingPixelsLead')}
          actions={pixels.length ? <span className="ws-section-count">{formatNumber(pixels.length)}</span> : undefined}
        >
          <DataViewState
            loading={pixelsQuery.isLoading}
            error={pixelsQuery.isError ? pixelsQuery.error : null}
            onRetry={() => pixelsQuery.refetch()}
            loadingFallback={<TableSkeleton />}
          >
            {pixels.length ? (
              <div className="table-scroll">
                <table className="data-table ws-links-table">
                  <thead>
                    <tr>
                      <th>{t('name')}</th>
                      <th>{t('workspacePixelSnippet')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pixels.map((pixel) => {
                      const snippet = pixelSnippet(pixel.slug);
                      return (
                        <tr key={pixel.id}>
                          <td>
                            <span className="ws-cell-title">{pixel.name}</span>
                            {pixel.teamId ? (
                              <StatusBadge tone="info" dot={false} className="ws-cell-badge">
                                {t('teamBadge')}
                              </StatusBadge>
                            ) : null}
                          </td>
                          <td>
                            <span className="ws-copy-cell">
                              <code className="ws-mono-value ws-snippet" title={snippet}>
                                {snippet}
                              </code>
                              <CopyButton text={snippet} iconOnly />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<Image />}
                title={t('noPixelsScope')}
                description={t('workspacePixelsEmpty')}
                action={
                  <Button variant="outline" size="sm" onClick={() => setDialog('pixel')}>
                    {t('createPixel')}
                  </Button>
                }
              />
            )}
          </DataViewState>
        </SectionCard>
      </PageBody>

      {dialog ? (
        <CreateDialog
          kind={dialog}
          teamName={team?.name}
          pending={dialog === 'link' ? createLink.isPending : createPixel.isPending}
          error={dialog === 'link' ? createLink.error : createPixel.error}
          onSubmit={(input) => (dialog === 'link' ? createLink.mutate(input) : createPixel.mutate(input))}
          onClose={() => {
            createLink.reset();
            createPixel.reset();
            setDialog(null);
          }}
        />
      ) : null}
    </Page>
  );
}
