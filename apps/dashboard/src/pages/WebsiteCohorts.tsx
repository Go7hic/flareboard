import { useParams } from 'react-router-dom';
import { CohortsPanel } from '../components/CohortsPanel';
import { WebsitePageShell } from '../components/WebsitePageShell';

export default function WebsiteCohortsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();

  return (
    <div className="page page-cohorts">
      <WebsitePageShell websiteId={websiteId} />
      {websiteId ? <CohortsPanel websiteId={websiteId} /> : null}
    </div>
  );
}
