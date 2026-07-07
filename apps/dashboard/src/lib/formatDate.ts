/** Locale-aware date + time, e.g. "Jul 7, 2026, 05:12 AM". Returns '-' for missing/invalid values. */
export function formatDate(value: string | number | null | undefined) {
  if (value == null) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
