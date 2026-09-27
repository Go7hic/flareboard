import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { INGEST_URL_FOR_DOCS } from '../../lib/api';
import { t } from '../../lib/i18n';

const SNIPPET = `<script defer src="${INGEST_URL_FOR_DOCS}/script.js"\n  data-website-id="YOUR_WEBSITE_ID"></script>`;

const STEPS = [
  { titleKey: 'homeHowStep1Title', bodyKey: 'homeHowStep1Body' },
  { titleKey: 'homeHowStep2Title', bodyKey: 'homeHowStep2Body' },
  { titleKey: 'homeHowStep3Title', bodyKey: 'homeHowStep3Body' },
];

const STORES = [
  { product: 'D1', roleKey: 'homeArchD1' },
  { product: 'R2', roleKey: 'homeArchR2' },
  { product: 'KV', roleKey: 'homeArchKv' },
  { product: 'Durable Objects', roleKey: 'homeArchDo' },
];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function SnippetBlock() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function handleCopy() {
    if (!(await copyText(SNIPPET.replace('\n  ', ' ')))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="home-snippet">
      <pre>
        <code>{SNIPPET}</code>
      </pre>
      <button type="button" className="home-snippet-copy" onClick={handleCopy} aria-live="polite">
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        <span>{copied ? t('copied') : t('copyToClipboard')}</span>
      </button>
    </div>
  );
}

function ArchNode({ title, product }: { title: string; product: string }) {
  return (
    <div className="home-arch-node">
      <span className="home-arch-node-title">{title}</span>
      <span className="home-arch-node-product">{product}</span>
    </div>
  );
}

function Architecture() {
  return (
    <figure className="home-arch" aria-label={t('homeArchAria')}>
      <div className="home-arch-site">
        <ArchNode title={t('homeArchSite')} product="script.js" />
      </div>
      <span className="home-arch-link" aria-hidden />
      <div className="home-arch-account">
        <p className="home-arch-account-label">
          <span className="home-arch-cf" aria-hidden />
          {t('homeArchAccount')}
        </p>
        <div className="home-arch-row">
          <ArchNode title={t('homeArchIngest')} product="Workers" />
          <span className="home-arch-arrow" aria-hidden />
          <ArchNode title={t('homeArchQueue')} product="Queues" />
          <span className="home-arch-arrow" aria-hidden />
          <ArchNode title={t('homeArchAggregator')} product="Workers" />
        </div>
        <span className="home-arch-link" aria-hidden />
        <div className="home-arch-stores">
          {STORES.map((store) => (
            <ArchNode key={store.product} title={t(store.roleKey)} product={store.product} />
          ))}
        </div>
        <span className="home-arch-link" aria-hidden />
        <div className="home-arch-row home-arch-row-end">
          <ArchNode title={t('homeArchApi')} product="Workers" />
          <span className="home-arch-arrow" aria-hidden />
          <ArchNode title={t('homeArchDashboard')} product="Workers Assets" />
        </div>
      </div>
    </figure>
  );
}

export function LandingHowItWorks() {
  return (
    <div className="home-how">
      <ol className="home-steps">
        {STEPS.map((step, i) => (
          <li key={step.titleKey} className="home-step">
            <span className="home-step-index" aria-hidden>
              {i + 1}
            </span>
            <div className="home-step-copy">
              <h3 className="home-step-title">{t(step.titleKey)}</h3>
              <p className="home-step-body">{t(step.bodyKey)}</p>
              {i === 0 ? <SnippetBlock /> : null}
            </div>
          </li>
        ))}
      </ol>
      <Architecture />
    </div>
  );
}
