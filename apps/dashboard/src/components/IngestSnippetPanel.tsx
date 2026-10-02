import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { Button } from './ui/button';
import { SectionCard } from './SectionCard';
import { StatusBadge } from './StatusBadge';
import { ProjectKeyField, useProjectKey } from './ProjectKeyField';
import { CodeBlock } from './quality/CodeBlock';
import { PageTabs } from './quality/PageTabs';
import { api, INGEST_URL, INGEST_URL_FOR_DOCS, type TrackingStatus } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';

// The UMD build defines window.rrweb. dist/rrweb.min.js is an ES module and fails in a classic script tag.
const RRWEB_CDN = 'https://cdn.jsdelivr.net/npm/rrweb@2/umd/rrweb.min.js';

type TestState = 'idle' | 'testing' | 'success' | 'waiting' | 'failed';
type SnippetTab = 'api' | 'options' | 'npm' | 'posthog' | 'declarative' | 'replay';

async function checkScriptReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${INGEST_URL}/script.js`, { method: 'GET', mode: 'cors' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Tracking code card of the website settings: the script tag with copy and a live "test
 * tracking" check, then the other ways to send data (API calls, script options, npm, PostHog
 * SDKs, declarative events, session replay) as tabs. `?setup=1` (new websites) scrolls here.
 */
export function IngestSnippetPanel({
  websiteId,
  replayEnabled,
  id,
}: {
  websiteId: string;
  replayEnabled?: boolean;
  id?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const setup = searchParams.get('setup') === '1';
  const cardRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SnippetTab>('api');
  const [testState, setTestState] = useState<TestState>('idle');
  const [testDetail, setTestDetail] = useState<string | null>(null);

  const mainSnippet = useMemo(
    () => `<script defer src="${INGEST_URL}/script.js" data-website-id="${websiteId}"></script>`,
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
<script>
  flareboard.track('event_name', { key: 'value' })

  // ${t('identifySnippetComment')}
  flareboard.identify('user_123', { email: 'user@example.com', plan: 'pro' })
  flareboard.group('account', 'acme_inc', { name: 'Acme Inc', plan: 'team' })
  // flareboard.reset()

  // ${t('superPropsSnippetComment')}
  flareboard.register({ app_version: '2.4.0' })

  // ${t('consentSnippetComment')}
  // flareboard.optOut()  ·  flareboard.optIn()  ·  flareboard.hasOptedOut()

  // ${t('featureFlagSnippetComment')}
  flareboard.featureFlagsReady().then(function () {
    if (flareboard.isFeatureEnabled('checkout.new_flow')) {
      // enable your feature
    }
  })

  // ${t('captureExceptionComment')}
  try {
    riskyCheckoutStep()
  } catch (error) {
    flareboard.captureException(error, { release: '1.0.0', environment: 'production' })
  }

  // ${t('logSnippetComment')}
  flareboard.log('info', 'Checkout step viewed', { step: 'payment' })

  // ${t('aiSnippetComment')}
  flareboard.ai({
    provider: 'openai',
    model: 'gpt-4.1-mini',
    inputTokens: 120,
    outputTokens: 48,
    costUsd: 0.004,
    latencyMs: 860,
    status: 'success'
  })
</script>`;

  const optionsSnippet = `<script defer src="${INGEST_URL}/script.js" data-website-id="${websiteId}"
  data-autocapture="false"
  data-pageleave="true"
  data-persistence="false"
  data-respect-dnt></script>

<div data-fb-no-capture>…</div>`;

  const npmSnippet = `npm install @flareboard/js

import { flareboard } from '@flareboard/js'

flareboard.init({
  host: '${INGEST_URL}',
  websiteId: '${websiteId}',
  // autocapture: false, persistence: false, respectDnt: true
})
flareboard.track('signup', { plan: 'pro' })

// ${t('embedNpmCommentReact')}
import { FlareboardProvider, useFeatureFlag } from '@flareboard/js/react'

<FlareboardProvider config={{ host: '${INGEST_URL}', websiteId: '${websiteId}' }}>
  <App />
</FlareboardProvider>

const variant = useFeatureFlag('checkout.new_flow')`;

  const projectKey = useProjectKey(websiteId).data?.key ?? 'fb_pk_…';
  const posthogSnippets = useMemo(
    () => ({
      js: `import posthog from 'posthog-js'

posthog.init('${projectKey}', {
  api_host: '${INGEST_URL_FOR_DOCS}',
  person_profiles: 'identified_only',
  // ${t('posthogSnippetUnsupportedComment')}
  disable_session_recording: true,
  disable_surveys: true,
})`,
      node: `import { PostHog } from 'posthog-node'

const posthog = new PostHog('${projectKey}', { host: '${INGEST_URL_FOR_DOCS}' })
posthog.capture({ distinctId: 'user_123', event: 'subscription_renewed', properties: { plan: 'pro' } })
await posthog.shutdown()`,
      python: `from posthog import Posthog

posthog = Posthog('${projectKey}', host='${INGEST_URL_FOR_DOCS}')
posthog.capture(distinct_id='user_123', event='subscription_renewed', properties={'plan': 'pro'})`,
    }),
    [projectKey],
  );

  const declarativeSnippet = `<!-- ${t('declarativeEvents')} -->
<button data-flareboard-event="signup" data-flareboard-event-plan="pro">Sign up</button>
<!-- Umami-compatible: data-umami-event="signup" data-umami-event-plan="pro" -->`;

  // New websites land here with ?setup=1: bring the snippet into view, then drop the flag.
  useEffect(() => {
    if (!setup) return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const next = new URLSearchParams(searchParams);
    next.delete('setup');
    setSearchParams(next, { replace: true });
  }, [setup, searchParams, setSearchParams]);

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
            ? t('trackingTestSuccessWithTime').replace('{time}', formatDateTime(data.lastEventAt))
            : t('trackingTestSuccess'),
        );
        return;
      }

      setTestState('waiting');
      setTestDetail(data.pageviews24h > 0 ? t('trackingTestWaitingStale') : t('trackingTestWaiting'));
    } catch (err) {
      setTestState('failed');
      setTestDetail((err as Error).message || t('trackingTestFailed'));
    }
  }

  const testBadge =
    testState === 'success' ? (
      <StatusBadge tone="success">{t('trackingTestOk')}</StatusBadge>
    ) : testState === 'waiting' ? (
      <StatusBadge tone="warning">{t('trackingTestPending')}</StatusBadge>
    ) : testState === 'failed' ? (
      <StatusBadge tone="danger">{t('trackingTestError')}</StatusBadge>
    ) : null;

  return (
    <div ref={cardRef} id={id} className="q-anchor">
      <SectionCard
        title={t('qualityTrackingCode')}
        description={t('qualityTrackingCodeLead')}
        actions={
          <Button type="button" variant="outline" size="sm" disabled={testState === 'testing'} onClick={() => void runTest()}>
            <Activity aria-hidden />
            {testState === 'testing' ? t('trackingTestRunning') : t('testTracking')}
          </Button>
        }
      >
        <div className="q-snippet">
          {!INGEST_URL ? (
            <p className="q-form-error" role="alert">
              {t('ingestUrlMissing')}
            </p>
          ) : null}
          <CodeBlock code={mainSnippet} wrap />
          {testState !== 'idle' && testState !== 'testing' ? (
            <p className="q-test-status" role="status">
              {testBadge}
              {testDetail ? <span>{testDetail}</span> : null}
            </p>
          ) : null}

          <div className="q-snippet-more">
            <PageTabs
              label={t('qualityMoreWaysToSend')}
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'api', label: t('embedAdvanced') },
                { id: 'options', label: t('embedOptions') },
                { id: 'npm', label: t('embedNpmTitle') },
                { id: 'posthog', label: t('posthogSdks') },
                { id: 'declarative', label: t('declarativeEvents') },
                { id: 'replay', label: t('replayEmbedTitle') },
              ]}
            />
            <div className="q-snippet-panel">
              {tab === 'api' ? <CodeBlock code={advancedSnippet} maxHeight="22rem" /> : null}
              {tab === 'options' ? (
                <>
                  <p className="q-field-hint">{t('embedOptionsLead')}</p>
                  <CodeBlock code={optionsSnippet} />
                  <dl className="kv-list kv-list--compact q-kv-narrow">
                    {(
                      [
                        ['data-autocapture', 'embedOptionAutocapture'],
                        ['data-pageleave', 'embedOptionPageleave'],
                        ['data-persistence', 'embedOptionPersistence'],
                        ['data-respect-dnt', 'embedOptionRespectDnt'],
                        ['data-fb-no-capture', 'embedOptionNoCapture'],
                      ] as const
                    ).map(([name, key]) => (
                      <Fragment key={name}>
                        <dt className="mono">{name}</dt>
                        <dd>{t(key)}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </>
              ) : null}
              {tab === 'npm' ? (
                <>
                  <p className="q-field-hint">{t('embedNpmLead')}</p>
                  <CodeBlock code={npmSnippet} maxHeight="22rem" />
                </>
              ) : null}
              {tab === 'posthog' ? (
                <>
                  <p className="q-field-hint">{t('posthogSdksLead')}</p>
                  <ProjectKeyField websiteId={websiteId} />
                  <CodeBlock caption="posthog-js" code={posthogSnippets.js} />
                  <CodeBlock caption="posthog-node" code={posthogSnippets.node} />
                  <CodeBlock caption="posthog-python" code={posthogSnippets.python} />
                  <p className="q-field-hint">{t('posthogSdksLimits')}</p>
                </>
              ) : null}
              {tab === 'declarative' ? (
                <>
                  <p className="q-field-hint">{t('declarativeEventsLead')}</p>
                  <CodeBlock code={declarativeSnippet} />
                </>
              ) : null}
              {tab === 'replay' ? (
                <>
                  <p className="q-field-hint">
                    {!replayEnabled ? (
                      <StatusBadge tone="warning" className="q-inline-badge">
                        {t('replayEmbedRequiresSettings')}
                      </StatusBadge>
                    ) : null}
                    {t('replayEmbedLead')} {t('replayEmbedScriptsNote')}
                  </p>
                  <CodeBlock code={replaySnippet} />
                  {!replayEnabled ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() => document.getElementById('settings-replay')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    >
                      {t('goToReplaySettings')}
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
