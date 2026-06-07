import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { api, INGEST_URL, type TrackingStatus } from '../lib/api';
import { t } from '../lib/i18n';

const RRWEB_CDN = 'https://cdn.jsdelivr.net/npm/rrweb@2/dist/rrweb.min.js';

const NEW_SITE_MS = 30 * 60 * 1000;
const STORAGE_PREFIX = 'flareboard.embed-expanded.';

type TestState = 'idle' | 'testing' | 'success' | 'waiting' | 'failed';

function storageKey(websiteId: string) {
  return `${STORAGE_PREFIX}${websiteId}`;
}

function isRecentlyCreated(createdAt?: string | number): boolean {
  if (createdAt == null) return false;
  const ts = typeof createdAt === 'number' ? createdAt : Date.parse(String(createdAt));
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < NEW_SITE_MS;
}

function readStoredExpanded(websiteId: string): boolean | null {
  const v = localStorage.getItem(storageKey(websiteId));
  if (v === '1') return true;
  if (v === '0') return false;
  return null;
}

function shouldStartExpanded(
  websiteId: string,
  createdAt: string | number | undefined,
  setup: boolean,
): boolean {
  if (setup) return true;
  if (isRecentlyCreated(createdAt)) return true;
  const stored = readStoredExpanded(websiteId);
  if (stored !== null) return stored;
  return false;
}

async function checkScriptReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${INGEST_URL}/script.js`, { method: 'GET', mode: 'cors' });
    return res.ok;
  } catch {
    return false;
  }
}

export function IngestSnippetPanel({
  websiteId,
  createdAt,
  replayEnabled,
}: {
  websiteId: string;
  createdAt?: string | number;
  replayEnabled?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const setup = searchParams.get('setup') === '1';

  const [open, setOpen] = useState(() => shouldStartExpanded(websiteId, createdAt, setup));
  const [testState, setTestState] = useState<TestState>('idle');
  const [testDetail, setTestDetail] = useState<string | null>(null);

  const mainSnippet = useMemo(
    () =>
      `<script defer src="${INGEST_URL}/script.js" data-website-id="${websiteId}"></script>`,
    [websiteId],
  );

  const replaySnippet = useMemo(
    () =>
      `<!-- ${t('replayEmbedCommentAnalytics')} -->
<script defer src="${INGEST_URL}/script.js" data-website-id="${websiteId}"></script>
<!-- ${t('replayEmbedCommentReplay')} -->
<script defer src="${RRWEB_CDN}"></script>
<script defer src="${INGEST_URL}/recorder.js" data-website-id="${websiteId}"></script>`,
    [websiteId],
  );

  const advancedSnippet = `<!-- ${t('trackEventComment')} -->
<script>flareboard.track('event_name', { key: 'value' })</script>`;

  useEffect(() => {
    if (!setup) return;
    setOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('setup');
    setSearchParams(next, { replace: true });
  }, [setup, searchParams, setSearchParams]);

  function onToggle(next: boolean) {
    setOpen(next);
    localStorage.setItem(storageKey(websiteId), next ? '1' : '0');
  }

  async function runTest() {
    setTestState('testing');
    setTestDetail(null);
    try {
      const [scriptOk, data] = await Promise.all([
        checkScriptReachable(),
        api<TrackingStatus>(`/api/websites/${websiteId}/tracking-status`),
      ]);

      if (!scriptOk) {
        setTestState('failed');
        setTestDetail(t('trackingTestScriptFailed'));
        return;
      }

      if (data.hasRecentData) {
        setTestState('success');
        setTestDetail(
          data.lastEventAt
            ? t('trackingTestSuccessWithTime').replace(
                '{time}',
                new Date(data.lastEventAt).toLocaleString(),
              )
            : t('trackingTestSuccess'),
        );
        return;
      }

      if (data.pageviews24h > 0) {
        setTestState('waiting');
        setTestDetail(t('trackingTestWaitingStale'));
        return;
      }

      setTestState('waiting');
      setTestDetail(t('trackingTestWaiting'));
    } catch (err) {
      setTestState('failed');
      setTestDetail((err as Error).message || t('trackingTestFailed'));
    }
  }

  const statusClass =
    testState === 'success'
      ? 'text-success'
      : testState === 'waiting'
        ? 'text-muted'
        : testState === 'failed'
          ? 'text-danger'
          : '';

  return (
    <details
      className="panel snippet-panel snippet-panel-collapsible"
      open={open}
      onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)}
    >
      <summary className="snippet-panel-summary">
        <span className="snippet-panel-label">{t('ingestSnippet')}</span>
        <span className="snippet-panel-toggle">{open ? t('hideEmbedCode') : t('showEmbedCode')}</span>
      </summary>
      <div className="snippet-panel-body">
        <pre className="code-block snippet-code">{mainSnippet}</pre>
        <details className="snippet-advanced">
          <summary>{t('embedAdvanced')}</summary>
          <pre className="code-block snippet-code">{advancedSnippet}</pre>
        </details>

        <Separator className="my-4" />

        <section className="snippet-replay-section" aria-labelledby={`replay-embed-${websiteId}`}>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 id={`replay-embed-${websiteId}`} className="snippet-replay-title m-0">
              {t('replayEmbedTitle')}
            </h3>
            {!replayEnabled ? (
              <Badge variant="warning">{t('replayEmbedRequiresSettings')}</Badge>
            ) : null}
          </div>
          <p className="section-lead snippet-replay-lead">{t('replayEmbedLead')}</p>
          <p className="text-sm text-[var(--text-muted)] mb-3">{t('replayEmbedScriptsNote')}</p>
          <pre className="code-block snippet-code">{replaySnippet}</pre>
          {!replayEnabled ? (
            <p className="mt-3 mb-0 text-sm">
              <Button asChild variant="secondary" size="sm">
                <Link to={`/websites/${websiteId}/settings`}>{t('goToReplaySettings')}</Link>
              </Button>
            </p>
          ) : null}
        </section>

        <div className="snippet-panel-actions">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={testState === 'testing'}
            onClick={() => void runTest()}
          >
            {testState === 'testing' ? t('trackingTestRunning') : t('testTracking')}
          </Button>
          {testState !== 'idle' ? (
            <p className={`snippet-test-status ${statusClass}`} role="status">
              {testState === 'success'
                ? t('trackingTestOk')
                : testState === 'waiting'
                  ? t('trackingTestPending')
                  : testState === 'failed'
                    ? t('trackingTestError')
                    : null}
              {testDetail ? ` — ${testDetail}` : null}
            </p>
          ) : null}
        </div>
      </div>
    </details>
  );
}
