import { Plus } from 'lucide-react';
import { useState } from 'react';
import { GoalFormDialog, type GoalFormState } from '../components/GoalFormDialog';
import { GoalsPanel } from '../components/GoalsPanel';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { Button } from '../components/ui/button';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

export default function WebsiteGoalsPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone } =
    useWebsiteReportContext('30d');
  // View-only members (and the demo) see progress without create, edit or delete.
  const { canEdit } = useWebsitePermissions(websiteId, 'settings');
  const [form, setForm] = useState<GoalFormState | null>(null);

  return (
    <Page className="page-goals">
      <PageHeader
        title={t('goals')}
        lead={t('behaviorGoalsLead')}
        actions={
          <>
            <WebsiteReportControls
              range={range}
              onRangeChange={setRange}
              segmentId={segmentId}
              onSegmentChange={setSegmentId}
              segments={segments}
              timezone={timezone}
            />
            {canEdit ? (
              <Button type="button" variant="primary" onClick={() => setForm({ mode: 'create' })}>
                <Plus aria-hidden />
                {t('behaviorGoalNew')}
              </Button>
            ) : null}
          </>
        }
      />

      <PageBody>
        {websiteId ? (
          <GoalsPanel
            websiteId={websiteId}
            reportUrl={reportUrl}
            range={range}
            segmentId={segmentId}
            canEdit={canEdit}
            onOpenForm={setForm}
          />
        ) : null}
      </PageBody>

      {websiteId ? <GoalFormDialog state={form} onClose={() => setForm(null)} websiteId={websiteId} /> : null}
    </Page>
  );
}
