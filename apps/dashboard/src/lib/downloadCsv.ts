import { authenticatedFetch } from './api';
import { t } from './i18n';

export type CsvDownloadResult = {
  /** The server stopped at its row cap (`X-Truncated: true`). */
  truncated: boolean;
  rowCap: number | null;
};

/**
 * Fetches a CSV export with the session credentials and saves it. Throws with the API message
 * (for example a SQL error) so callers can show it inline.
 */
export async function downloadCsv(path: string, filename: string, init: RequestInit = {}): Promise<CsvDownloadResult> {
  const response = await authenticatedFetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message || t('exportFailed'));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  const cap = Number(response.headers.get('X-Row-Cap'));
  return {
    truncated: response.headers.get('X-Truncated') === 'true',
    rowCap: Number.isFinite(cap) && cap > 0 ? cap : null,
  };
}
