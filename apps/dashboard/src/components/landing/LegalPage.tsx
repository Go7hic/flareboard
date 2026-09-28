import { useEffect, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getLocale, t } from '../../lib/i18n';
import { LandingChrome } from './LandingChrome';
import '../../styles/legal.css';

export type LegalLang = 'en' | 'zh-CN';

export type LegalSection = {
  id: string;
  title: string;
  body: ReactNode;
};

export type LegalDoc = {
  title: string;
  /** Human-readable date in the document's language. */
  updated: string;
  intro: ReactNode;
  sections: LegalSection[];
};

const LANGS: LegalLang[] = ['en', 'zh-CN'];

/** Labels that belong to the document (not the UI locale), so a Chinese document reads fully in Chinese. */
const DOC_CHROME: Record<LegalLang, { name: string; updated: string; contents: string }> = {
  en: { name: 'English', updated: 'Last updated: ', contents: 'Contents' },
  'zh-CN': { name: '简体中文', updated: '最后更新：', contents: '目录' },
};

const TRANSLATION_NOTICE = '本中文版本译自英文原文，仅供参考；如中英文版本有任何不一致，以英文版本为准。';

function resolveLang(param: string | null): LegalLang {
  if (param === 'en' || param === 'zh-CN') return param;
  return getLocale() === 'zh-CN' ? 'zh-CN' : 'en';
}

/**
 * Shared shell for /privacy and /terms. English is the binding text; Simplified Chinese is a
 * translation. The version follows the UI locale unless `?lang=en|zh-CN` picks one.
 */
export function LegalPage({ docs }: { docs: Record<LegalLang, LegalDoc> }) {
  const [searchParams] = useSearchParams();
  const lang = resolveLang(searchParams.get('lang'));
  const doc = docs[lang];
  const chrome = DOC_CHROME[lang];
  const uiLocale = getLocale();

  useEffect(() => {
    const previous = document.title;
    document.title = `${doc.title} - Flareboard`;
    // Honor deep links such as /terms#data-processing; otherwise start at the top.
    const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
    return () => {
      document.title = previous;
    };
  }, [doc.title]);

  let notice: ReactNode = null;
  if (lang === 'zh-CN') {
    notice = <p className="legal-notice">{TRANSLATION_NOTICE}</p>;
  } else if (uiLocale !== 'en-US' && uiLocale !== 'zh-CN') {
    notice = (
      <p className="legal-notice" lang={uiLocale}>
        {t('legalEnglishOnly')}
      </p>
    );
  }

  return (
    <LandingChrome activeNav="none">
      <main className="legal-page" lang={lang}>
        <header className="legal-header">
          <div className="legal-header-top">
            <h1 className="legal-title">{doc.title}</h1>
            <nav className="legal-lang-switch" aria-label="Language / 语言">
              {LANGS.map((code) => (
                <Link
                  key={code}
                  to={{ search: `?lang=${code}` }}
                  lang={code}
                  className={code === lang ? 'is-active' : undefined}
                  aria-current={code === lang ? 'true' : undefined}
                >
                  {DOC_CHROME[code].name}
                </Link>
              ))}
            </nav>
          </div>
          <p className="legal-updated">
            {chrome.updated}
            {doc.updated}
          </p>
          {notice}
        </header>

        <div className="legal-layout">
          <nav className="legal-toc" aria-label={chrome.contents}>
            <p className="legal-toc-heading">{chrome.contents}</p>
            <ol>
              {doc.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="legal-body">
            <div className="legal-intro">{doc.intro}</div>
            {doc.sections.map((section, index) => (
              <section key={section.id} id={section.id} className="legal-section">
                <h2>
                  <span className="legal-section-num">{index + 1}.</span> {section.title}
                </h2>
                {section.body}
              </section>
            ))}
          </article>
        </div>
      </main>
    </LandingChrome>
  );
}
