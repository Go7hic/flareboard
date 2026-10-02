import { Area, AreaChart } from 'recharts';
import { areaMark } from '../../lib/chartMarks';
import { useChartColors } from '../../lib/useChartColors';
import { AnalyticsChart } from '../AnalyticsChart';

export type TrendPoint = { label: string; value: number | null };

/**
 * One series over time: a 2px line with a 10% wash (dataviz: single-series trend). No legend;
 * the section title names the series.
 */
export function TrendAreaChart({
  data,
  name,
  height = 200,
  valueFormatter,
  color,
}: {
  data: TrendPoint[];
  name: string;
  height?: number;
  valueFormatter?: (value: number) => string;
  /** Resolved color (SVG attributes cannot read CSS variables); defaults to series slot 1. */
  color?: string;
}) {
  const colors = useChartColors();
  const stroke = color ?? colors.accent;
  return (
    <div className="traffic-chart">
      <AnalyticsChart
        Chart={AreaChart}
        data={data}
        responsive={{ height }}
        valueFormatter={valueFormatter}
        xAxis={{ dataKey: 'label', interval: 'preserveStartEnd', minTickGap: 40 }}
      >
        <Area dataKey="value" name={name} stroke={stroke} fill={stroke} connectNulls {...areaMark(colors.panel)} />
      </AnalyticsChart>
    </div>
  );
}
