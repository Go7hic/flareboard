/**
 * Tiny bar sparkline of an issue's occurrences across the selected range (one bar per slice, a
 * hairline tick where a slice is empty). Bars use the series slot 1 color through CSS
 * (`.q-spark-bar`), so they follow the theme.
 */
export function ErrorIssueTrend({
  values,
  label,
  width = 72,
  height = 20,
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(1, ...values);
  const slot = values.length ? width / values.length : width;
  const gap = slot > 3 ? 1 : 0;
  const barWidth = Math.max(1, slot - gap);
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    <svg
      className="q-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: ${total}`}
    >
      {values.map((value, index) => {
        const barHeight = value > 0 ? Math.max(2, (value / max) * height) : 1;
        return (
          <rect
            key={index}
            className={value > 0 ? 'q-spark-bar' : 'q-spark-empty'}
            x={index * slot}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx={value > 0 ? 1 : 0}
          >
            {value > 0 ? <title>{value}</title> : null}
          </rect>
        );
      })}
    </svg>
  );
}
