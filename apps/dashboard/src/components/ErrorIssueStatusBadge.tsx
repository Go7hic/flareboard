import type { ErrorIssueStatus } from '../lib/api';
import { t } from '../lib/i18n';

export function ErrorIssueStatusBadge({ status }: { status: ErrorIssueStatus }) {
  return <span className={`badge error-status-${status}`}>{t(`errorIssueStatus_${status}`)}</span>;
}
