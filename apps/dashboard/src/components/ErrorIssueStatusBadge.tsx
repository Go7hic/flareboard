import type { ErrorIssueStatus } from '../lib/api';
import { t } from '../lib/i18n';
import { StatusBadge, type StatusTone } from './StatusBadge';

/** Open stays quiet; a regression is the one state that should catch the eye. */
const TONES: Record<ErrorIssueStatus, StatusTone> = {
  open: 'neutral',
  regressed: 'danger',
  resolved: 'success',
  ignored: 'neutral',
};

export function ErrorIssueStatusBadge({ status }: { status: ErrorIssueStatus }) {
  return (
    <StatusBadge tone={TONES[status]} dot={status !== 'ignored'}>
      {t(`errorIssueStatus_${status}`)}
    </StatusBadge>
  );
}
