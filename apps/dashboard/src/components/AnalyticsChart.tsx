import type { ComponentProps, ElementType, ReactNode } from 'react';
import {
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { niceSignedTicks, plottedRange } from '../lib/chartTicks';
import { formatNumber } from '../lib/format';
import { useChartColors } from '../lib/useChartColors';
import { ChartTooltipContent } from './ChartTooltipContent';

type ChartShellProps = {
  data?: unknown[];
  margin?: { top?: number; right?: number; left?: number; bottom?: number };
  layout?: 'horizontal' | 'vertical';
  barCategoryGap?: number | string;
  barGap?: number | string;
  stackOffset?: 'none' | 'sign' | 'expand' | 'wiggle' | 'silhouette' | 'positive';
  children?: ReactNode;
};

type ResponsiveSize = number | `${number}%`;

type AnalyticsChartProps = {
  Chart: ElementType<ChartShellProps>;
  data: unknown[];
  children: ReactNode;
  margin?: ChartShellProps['margin'];
  layout?: ChartShellProps['layout'];
  /** `sign` stacks negative values below zero (lifecycle dormant, MRR churn). */
  stackOffset?: ChartShellProps['stackOffset'];
  xAxis?: ComponentProps<typeof XAxis>;
  yAxis?: ComponentProps<typeof YAxis>;
  grid?: ComponentProps<typeof CartesianGrid>;
  tooltip?: ComponentProps<typeof Tooltip>;
  responsive?: {
    width?: ResponsiveSize;
    height?: ResponsiveSize;
  };
  /** Formats values in the tooltip (and the y ticks unless yAxis.tickFormatter is set). */
  valueFormatter?: (value: number) => string;
};

/**
 * Shared chart frame (console v2 / dataviz method): solid hairline horizontal grid, no axis
 * lines, muted 12px ticks, crosshair (lines) or band highlight (bars), and one tooltip that
 * lists every series value-first. Series marks come from the children; use the presets in
 * lib/chartMarks.ts so bars stay ≤ 24px with a rounded data end and lines stay 2px.
 */
export function AnalyticsChart({
  Chart,
  data,
  children,
  margin,
  layout,
  stackOffset,
  xAxis,
  yAxis,
  grid,
  tooltip,
  responsive,
  valueFormatter,
}: AnalyticsChartProps) {
  const colors = useChartColors();
  const isBar = Chart === (BarChart as unknown as ElementType);
  const vertical = layout === 'vertical';
  const yAxisType = yAxis?.type ?? (vertical ? 'category' : 'number');
  const numberTick =
    valueFormatter ?? ((value: number) => formatNumber(value, { compact: Math.abs(value) >= 10_000 }));
  const yTick = yAxisType === 'category' || yAxis?.tickFormatter ? undefined : numberTick;
  const xTick = vertical && !xAxis?.tickFormatter && (xAxis?.type ?? 'number') === 'number' ? numberTick : undefined;
  const tick = { fontSize: 12, fill: colors.muted };
  // Clean value ticks (0/50/100/150) unless the caller set its own domain or ticks.
  const valueAxis = vertical ? xAxis : yAxis;
  const valueAxisIsNumber = (valueAxis?.type ?? 'number') === 'number' && (vertical ? (xAxis?.type ?? 'number') : yAxisType) === 'number';
  const autoTicks =
    valueAxisIsNumber && !valueAxis?.domain && !valueAxis?.ticks
      ? (() => {
          const range = plottedRange(data, children);
          if (range === null) return undefined;
          const ticks = niceSignedTicks(range.min, range.max, 4, valueAxis?.allowDecimals ?? false);
          return { ticks, domain: [ticks[0], ticks[ticks.length - 1]] as [number, number] };
        })()
      : undefined;

  return (
    <ResponsiveContainer width={responsive?.width ?? '100%'} height={responsive?.height}>
      <Chart
        data={data}
        margin={margin ?? { top: 8, right: 8, bottom: 0, left: 0 }}
        layout={layout}
        {...(stackOffset ? { stackOffset } : {})}
        {...(isBar ? { barCategoryGap: '24%', barGap: 2 } : {})}
      >
        <CartesianGrid
          stroke={colors.border}
          strokeWidth={1}
          vertical={vertical}
          horizontal={!vertical}
          {...grid}
        />
        <XAxis
          tick={tick}
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={xTick}
          {...(vertical && autoTicks ? autoTicks : {})}
          {...xAxis}
        />
        <YAxis
          allowDecimals={false}
          tick={tick}
          axisLine={false}
          tickLine={false}
          tickMargin={6}
          width={vertical ? 120 : 48}
          tickFormatter={yTick}
          {...(!vertical && autoTicks ? autoTicks : {})}
          {...yAxis}
        />
        <Tooltip
          cursor={
            isBar
              ? { fill: colors.border, fillOpacity: 0.5 }
              : { stroke: colors.muted, strokeWidth: 1, strokeOpacity: 0.35 }
          }
          content={<ChartTooltipContent valueFormatter={valueFormatter} indicator={isBar ? 'box' : 'line'} />}
          isAnimationActive={false}
          {...tooltip}
        />
        {children}
      </Chart>
    </ResponsiveContainer>
  );
}
