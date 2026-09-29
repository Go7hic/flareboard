import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import type { SurveyAnswers, SurveyAppearance, SurveyQuestion } from '@flareboard/shared/survey-flow';
import { BrandLogo } from '../components/BrandLogo';
import { SurveyRenderer } from '../components/surveys/SurveyRenderer';
import { INGEST_URL } from '../lib/api';
import { t } from '../lib/i18n';
import { useResolvedTheme } from '../lib/useResolvedTheme';

type HostedSurveyDefinition = {
  id: string;
  websiteId: string;
  name: string;
  closed: boolean;
  questions: SurveyQuestion[];
  appearance: SurveyAppearance;
};

class HostedSurveyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function doneKey(surveyId: string) {
  return `flareboard.survey:${surveyId}`;
}

function alreadyAnswered(surveyId: string) {
  try {
    return window.localStorage.getItem(doneKey(surveyId)) === 'done';
  } catch {
    return false;
  }
}

function markAnswered(surveyId: string) {
  try {
    window.localStorage.setItem(doneKey(surveyId), 'done');
  } catch {
    /* private mode: the survey may be answered again, the server still rate-limits */
  }
}

function newResponseId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16),
      );
}

/**
 * Public survey page at /s/<surveyId or slug>: works without the tracker. Loads the definition
 * from ingest, walks the same branching rules as the widget, saves a partial response when the
 * respondent leaves mid-way, and completes it (same response id) on the last step.
 */
export default function HostedSurvey() {
  const { key = '' } = useParams<{ key: string }>();
  const [searchParams] = useSearchParams();
  const theme = useResolvedTheme();
  const responseId = useRef(newResponseId());
  const progress = useRef<SurveyAnswers>({});
  const lastPartial = useRef('');
  const finished = useRef(false);
  const [answeredBefore, setAnsweredBefore] = useState(false);
  const distinctId = (searchParams.get('distinct_id') ?? searchParams.get('uid') ?? '').slice(0, 200) || null;

  const surveyQuery = useQuery({
    queryKey: ['hosted-survey', key],
    enabled: Boolean(key && INGEST_URL),
    retry: false,
    queryFn: async () => {
      const response = await fetch(`${INGEST_URL}/api/surveys/hosted/${encodeURIComponent(key)}`);
      if (!response.ok) throw new HostedSurveyError(t('surveyHostedNotFound'), response.status);
      return (await response.json()) as HostedSurveyDefinition;
    },
  });
  const survey = surveyQuery.data;

  useEffect(() => {
    if (survey) {
      setAnsweredBefore(alreadyAnswered(survey.id));
      document.title = survey.name;
    }
  }, [survey]);

  async function send(answers: SurveyAnswers, completed: boolean, keepalive = false) {
    if (!survey) return;
    const response = await fetch(`${INGEST_URL}/api/surveys/response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive,
      body: JSON.stringify({
        website: survey.websiteId,
        surveyId: survey.id,
        responseId: responseId.current,
        answers,
        completed,
        source: 'hosted',
        distinctId,
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(response.status === 409 ? t('surveyHostedClosed') : body.message || t('surveyWidgetSendFailed'));
    }
  }

  // A respondent who leaves mid-way is recorded as a partial response (once per answer set).
  useEffect(() => {
    if (!survey || survey.closed) return;
    const flush = () => {
      if (finished.current || !Object.keys(progress.current).length) return;
      const snapshot = JSON.stringify(progress.current);
      if (snapshot === lastPartial.current) return;
      lastPartial.current = snapshot;
      void send(progress.current, false, true).catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // send() only depends on the survey (and the distinct id from the URL, fixed per page load).
  }, [survey]);

  let content;
  if (!INGEST_URL) {
    content = <p className="text-muted">{t('surveyHostedUnavailable')}</p>;
  } else if (surveyQuery.isLoading) {
    content = <div className="skeleton skeleton-block" aria-busy />;
  } else if (surveyQuery.error || !survey) {
    content = (
      <div className="hosted-survey-message">
        <h1 className="section-title">{t('surveyHostedNotFound')}</h1>
        <p className="text-muted">{t('surveyHostedNotFoundBody')}</p>
      </div>
    );
  } else if (survey.closed || !survey.questions.length) {
    content = (
      <div className="hosted-survey-message">
        <h1 className="section-title">{t('surveyHostedClosed')}</h1>
        <p className="text-muted">{t('surveyHostedClosedBody')}</p>
      </div>
    );
  } else if (answeredBefore) {
    content = (
      <div className="hosted-survey-message">
        <h1 className="section-title">{t('surveyHostedAlreadyAnswered')}</h1>
        <p className="text-muted">{t('surveyHostedAlreadyAnsweredBody')}</p>
      </div>
    );
  } else {
    content = (
      <SurveyRenderer
        className="hosted-survey-widget"
        questions={survey.questions}
        appearance={survey.appearance}
        scheme={theme}
        onProgress={(answers) => {
          progress.current = answers;
        }}
        onComplete={async (answers) => {
          await send(answers, true);
          finished.current = true;
          markAnswered(survey.id);
        }}
      />
    );
  }

  return (
    <main className="hosted-survey-page">
      <div className="hosted-survey-card">{content}</div>
      <footer className="hosted-survey-footer text-muted">
        <span>{t('surveyHostedPoweredBy')}</span>
        <BrandLogo size={16} />
      </footer>
    </main>
  );
}
