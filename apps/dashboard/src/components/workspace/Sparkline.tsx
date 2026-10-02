import type { CSSProperties } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { cn } from '../../lib/utils';

/**
 * Decorative trend line for cards and table rows (no axes, no tooltip): a 1.5px line with a 10%
 * wash in the series color. `color` must be a resolved color (SVG attributes cannot read CSS
 * variables), e.g. `useChartColors().series.pageviews`. Fewer than two points draw a flat rule.
 */
export function Sparkline({
  values,
  color,
  height = 40,
  width,
  className,
}: {
  values: number[];
  color: string;
  height?: number;
  /** Fixed width (table cells); fills the container when omitted. */
  width?: number;
  className?: string;
}) {
  const style: CSSProperties = { height, ...(width ? { width } : {}) };
  if (values.length < 2) {
    return <span className={cn('ws-spark ws-spark--flat', className)} style={style} aria-hidden />;
  }
  const data = values.map((value, index) => ({ index, value }));
  return (
    <span className={cn('ws-spark', className)} style={style} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 1, bottom: 1, left: 1 }}>
          <YAxis hide domain={[0, 'dataMax']} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={color}
            fillOpacity={0.1}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </span>
  );
}
