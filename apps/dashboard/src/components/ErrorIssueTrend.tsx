import { CHART_SERIES_COLORS } from '../lib/chart-colors';

/** Tiny bar sparkline of an issue's occurrences across the selected range. */
export function ErrorIssueTrend({
  values,
  label,
  width = 96,
  height = 24,
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(1, ...values);
  const slot = values.length ? width / values.length : width;
  const barWidth = Math.max(1, slot - 1);
  return (
    <svg
      className="error-issue-trend"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: ${values.reduce((sum, value) => sum + value, 0)}`}
    >
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} className="error-issue-trend-baseline" />
      {values.map((value, index) =>
        value > 0 ? (
          <rect
            key={index}
            x={index * slot}
            y={height - Math.max(2, (value / max) * height)}
            width={barWidth}
            height={Math.max(2, (value / max) * height)}
            rx={1}
            fill={CHART_SERIES_COLORS[0]}
          >
            <title>{value}</title>
          </rect>
        ) : null,
      )}
    </svg>
  );
}
