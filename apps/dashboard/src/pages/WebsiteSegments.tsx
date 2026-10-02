import { useParams } from 'react-router-dom';
import { Page } from '../components/Page';
import { SegmentsPanel } from '../components/SegmentsPanel';

export default function WebsiteSegmentsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();

  return <Page className="page-segments">{websiteId ? <SegmentsPanel websiteId={websiteId} /> : null}</Page>;
}
