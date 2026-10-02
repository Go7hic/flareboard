import { formatPercent } from '../../lib/format';

/** 2.4% / 37% — one decimal under 10 so small rates do not round to 0; "—" when unknown. */
export function formatRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return formatPercent(value, { digits: value > 0 && value < 10 ? 1 : 0 });
}
