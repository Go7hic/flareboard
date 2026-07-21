import type { ComponentProps, ElementType, ReactNode } from 'react';
import {
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chartTooltipStyle } from '../lib/chartStyles';
import { formatNumber } from '../lib/format';
import { useChartColors } from '../lib/useChartColors';

type ChartShellProps = {
  data?: unknown[];
  margin?: { top?: number; right?: number; left?: number; bottom?: number };
  layout?: 'horizontal' | 'vertical';
  children?: ReactNode;
};

type ResponsiveSize = number | `${number}%`;

type AnalyticsChartProps = {
  Chart: ElementType<ChartShellProps>;
  data: unknown[];
  children: ReactNode;
  margin?: ChartShellProps['margin'];
  layout?: ChartShellProps['layout'];
  xAxis?: ComponentProps<typeof XAxis>;
  yAxis?: ComponentProps<typeof YAxis>;
  grid?: ComponentProps<typeof CartesianGrid>;
  tooltip?: ComponentProps<typeof Tooltip>;
  responsive?: {
    width?: ResponsiveSize;
    height?: ResponsiveSize;
  };
};

export function AnalyticsChart({
  Chart,
  data,
  children,
  margin,
  layout,
  xAxis,
  yAxis,
  grid,
  tooltip,
  responsive,
}: AnalyticsChartProps) {
  const colors = useChartColors();
  const yAxisType = yAxis?.type ?? 'number';
  const localeYTick =
    yAxisType === 'category' || yAxis?.tickFormatter
      ? undefined
      : (value: number) => formatNumber(value);

  return (
    <ResponsiveContainer width={responsive?.width ?? '100%'} height={responsive?.height}>
      <Chart data={data} margin={margin} layout={layout}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke={colors.border}
          vertical={false}
          {...grid}
        />
        <XAxis
          tick={{ fontSize: 11, fill: colors.muted }}
          stroke={colors.border}
          {...xAxis}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: colors.muted }}
          stroke={colors.border}
          tickFormatter={localeYTick}
          {...yAxis}
        />
        <Tooltip contentStyle={chartTooltipStyle(colors, { fontSize: 13 })} {...tooltip} />
        {children}
      </Chart>
    </ResponsiveContainer>
  );
}
