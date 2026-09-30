import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Outlet, useParams } from 'react-router-dom';
import { fetchAssistantStatus } from '../lib/assistant';
import { t } from '../lib/i18n';
import { useDemoSession } from '../lib/useDemoSession';
import { AssistantPanel } from './assistant/AssistantPanel';
import { WebsiteContentHeader } from './WebsiteContentHeader';
import { Button } from './ui/button';

export function WebsiteShell() {
  const { websiteId } = useParams();
  const [assistantOpen, setAssistantOpen] = useState(false);
  // The demo account may not use the assistant (every answer costs money): not even asked.
  const demo = useDemoSession();
  // Off unless the API has DEEPSEEK_API_KEY: then the button is not shown at all.
  const assistant = useQuery({
    queryKey: ['assistant-status', websiteId],
    queryFn: () => fetchAssistantStatus(websiteId!),
    enabled: Boolean(websiteId) && demo.ready && !demo.isDemo,
    staleTime: 60_000,
    retry: false,
  });
  const assistantEnabled = Boolean(websiteId && !demo.isDemo && assistant.data?.enabled);

  return (
    <div className="website-layout">
      <WebsiteContentHeader
        actions={
          assistantEnabled ? (
            <Button variant="outline" size="sm" onClick={() => setAssistantOpen((open) => !open)} aria-expanded={assistantOpen}>
              <Sparkles aria-hidden />
              {t('assistantTitle')}
            </Button>
          ) : null
        }
      />
      {/* Remount per site so page state (forms, filters, selections) never carries across. */}
      <Outlet key={websiteId} />
      {assistantEnabled && assistantOpen ? (
        <AssistantPanel key={websiteId} websiteId={websiteId!} status={assistant.data!} onClose={() => setAssistantOpen(false)} />
      ) : null}
    </div>
  );
}
