import { useParams } from 'react-router-dom';
import { SegmentsPanel } from '../components/SegmentsPanel';
import { WebsitePageShell } from '../components/WebsitePageShell';
export default function WebsiteSegmentsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();

  return (
    <div className="page page-segments">
      <WebsitePageShell websiteId={websiteId} />
      {websiteId ? <SegmentsPanel websiteId={websiteId} /> : null}
    </div>
  );
}
