import { useParams } from 'react-router-dom';
import { RealtimeWidget } from '../components/RealtimeWidget';
import { WebsitePageShell } from '../components/WebsitePageShell';

export default function WebsiteRealtimePage() {
  const { websiteId } = useParams<{ websiteId: string }>();

  return (
    <div className="page page-realtime">
      <WebsitePageShell websiteId={websiteId} />
      {websiteId ? <RealtimeWidget websiteId={websiteId} /> : null}
    </div>
  );
}
