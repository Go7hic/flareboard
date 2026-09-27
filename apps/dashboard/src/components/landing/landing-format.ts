import { getLocale } from '../../lib/i18n';

let compactFormatter: Intl.NumberFormat | null = null;

/** Locale-aware short numbers for marketing samples (e.g. 90.4K, 9万). */
export function compactNumber(value: number): string {
  compactFormatter ??= new Intl.NumberFormat(getLocale(), {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  return compactFormatter.format(value);
}

/** Catmull-Rom spline through the points, emitted as an SVG cubic path. */
export function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return '';
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1] ?? points[i];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const [x3, y3] = points[i + 2] ?? points[i + 1];
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = y2 - (y3 - y1) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  return d;
}
