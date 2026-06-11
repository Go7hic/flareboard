import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { PageHeader } from '../components/PageHeader';
import { PlanUpgradeBanner } from '../components/PlanUpgradeBanner';
import { WebsiteFormDialog } from '../components/WebsiteFormDialog';
import { WebsiteNameLabel } from '../components/WebsiteNameLabel';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, type Website } from '../lib/api';
import { t } from '../lib/i18n';

function formatCreatedAt(value?: string | number) {
  if (value == null) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function AddWebsiteForm({
  onSuccess,
}: {
  onSuccess: (website: Website) => void;
}) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');

  const createMutation = useMutation({
    mutationFn: (body: { name: string; domain: string }) =>
      api<Website>('/api/websites', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (website) => {
      setName('');
      setDomain('');
      onSuccess(website);
    },
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({ name: name.trim(), domain: domain.trim() || '' });
  }

  return (
    <form onSubmit={onCreate}>
      <div className="form-row">
        <div className="field">
          <Label htmlFor="site-name">{t('name')}</Label>
          <Input
            id="site-name"
            placeholder={t('mySite')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <Label htmlFor="site-domain">{t('domain')}</Label>
          <Input
            id="site-domain"
            placeholder="example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
        </div>
        <Button variant="primary" type="submit" disabled={createMutation.isPending}>
          {t('create')}
        </Button>
      </div>
      {createMutation.error ? (
        <p className="text-danger">{(createMutation.error as Error).message}</p>
      ) : null}
    </form>
  );
}

export default function Websites() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editingSite, setEditingSite] = useState<Website | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['websites'],
    queryFn: () => api<Website[]>('/api/websites'),
  });

  const billingQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () =>
      api<{
        hosted: boolean;
        plan?: { maxWebsites?: number };
      }>('/api/billing/subscription'),
  });

  const sites = data ?? [];
  const hasSites = sites.length > 0;
  const maxWebsites = billingQuery.data?.plan?.maxWebsites;
  const atWebsiteLimit =
    billingQuery.data?.hosted === true &&
    typeof maxWebsites === 'number' &&
    sites.length >= maxWebsites;

  function renderAddWebsite() {
    if (atWebsiteLimit) {
      return <PlanUpgradeBanner message={t('websitesRequiresUpgrade')} />;
    }
    return <AddWebsiteForm onSuccess={onCreated} />;
  }

  function onCreated(website: Website) {
    queryClient.invalidateQueries({ queryKey: ['websites'] });
    navigate(`/websites/${website.id}/settings?setup=1`);
  }

  return (
    <div className="page page-websites">
      <PageHeader title={t('websites')} subtitle={t('websitesSubtitle')} />

      {hasSites ? (
        <CollapsibleSection title={t('collapseAddWebsite')} summary={t('addWebsiteLead')}>
          {renderAddWebsite()}
        </CollapsibleSection>
      ) : (
        <section className="panel">
          <h2 className="section-title">{t('addWebsite')}</h2>
          <p className="section-lead">{t('addWebsiteLead')}</p>
          {renderAddWebsite()}
        </section>
      )}

      <section className="section-gap-lg">
        {isLoading ? (
          <div className="panel">
            <div className="skeleton" style={{ width: '40%', marginBottom: '0.75rem' }} />
            <div className="skeleton" style={{ width: '60%' }} />
          </div>
        ) : null}
        {error ? <p className="text-danger">{(error as Error).message}</p> : null}
        {!isLoading && !hasSites ? (
          <div className="panel empty-state-rich">
            <h3>{t('noWebsites')}</h3>
            <p className="text-muted">{t('noWebsitesHint')}</p>
            <ol className="empty-state-steps">
              <li data-step="1">{t('emptyStep1')}</li>
              <li data-step="2">{t('emptyStep2')}</li>
              <li data-step="3">{t('emptyStep3')}</li>
            </ol>
          </div>
        ) : null}
        <ul className="list-plain site-grid">
          {sites.map((site) => (
            <li key={site.id}>
              <article className="panel site-card">
                <div className="site-card-header">
                  <Link to={`/websites/${site.id}`} className="site-card-link">
                    <WebsiteNameLabel name={site.name} domain={site.domain} className="site-card-name" />
                    {site.domain ? <span className="site-card-domain">{site.domain}</span> : null}
                  </Link>
                  <div className="site-card-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="site-card-edit"
                      onClick={() => setEditingSite(site)}
                      aria-label={t('editWebsite')}
                      title={t('editWebsite')}
                    >
                      <Pencil size={14} strokeWidth={2} aria-hidden />
                    </Button>
                    <Link to={`/websites/${site.id}`} className="site-card-open" aria-hidden>
                      →
                    </Link>
                  </div>
                </div>
                {site.createdAt != null ? (
                  <p className="site-card-meta text-muted">
                    {t('segmentCreated')}: {formatCreatedAt(site.createdAt)}
                  </p>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      </section>

      <WebsiteFormDialog
        open={editingSite != null}
        website={editingSite}
        onClose={() => setEditingSite(null)}
      />
    </div>
  );
}
