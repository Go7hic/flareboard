import { Area, AreaChart } from 'recharts';
import { areaMark } from '../../lib/chartMarks';
import { useChartColors } from '../../lib/useChartColors';
import { AnalyticsChart } from '../AnalyticsChart';

export type TrendAreaPoint = { label: string; value: number };

/** One series over time: 2px line + 10% wash, no legend (the section title names it). */
export function TrendArea({
  data,
  name,
  height = 180,
  valueFormatter,
}: {
  data: TrendAreaPoint[];
  name: string;
  height?: number;
  valueFormatter?: (value: number) => string;
}) {
  const colors = useChartColors();
  return (
    <div className="audience-chart">
      <AnalyticsChart
        Chart={AreaChart}
        data={data}
        responsive={{ height }}
        valueFormatter={valueFormatter}
        xAxis={{ dataKey: 'label', interval: 'preserveStartEnd', minTickGap: 40 }}
      >
        <Area dataKey="value" name={name} stroke={colors.accent} fill={colors.accent} {...areaMark(colors.panel)} />
      </AnalyticsChart>
    </div>
  );
}
