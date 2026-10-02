import type { ReactNode } from 'react';
import { formatNumber } from '../lib/format';

type TooltipEntry = {
  name?: ReactNode;
  value?: unknown;
  color?: string;
  stroke?: string;
  fill?: string;
  dataKey?: unknown;
  payload?: Record<string, unknown>;
  hide?: boolean;
};

type Formatter = (
  value: unknown,
  name: unknown,
  entry: TooltipEntry,
  index: number,
  payload: readonly TooltipEntry[],
) => ReactNode | [ReactNode, ReactNode];

/**
 * Tooltip body for every AnalyticsChart: title (the x value), then one row per series with a
 * line key (or box for bars), the series name muted and the value strong (dataviz: values lead).
 * Honors Recharts `formatter` / `labelFormatter` passed through `tooltip`.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  valueFormatter,
  indicator = 'line',
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: ReactNode;
  labelFormatter?: (label: ReactNode, payload: readonly TooltipEntry[]) => ReactNode;
  formatter?: Formatter;
  valueFormatter?: (value: number) => string;
  indicator?: 'line' | 'box';
}) {
  const rows = (payload ?? []).filter((entry) => !entry.hide && entry.value !== undefined);
  if (!active || rows.length === 0) return null;
  const title = labelFormatter ? labelFormatter(label, rows) : label;

  return (
    <div className="chart-tooltip">
      {title !== undefined && title !== null && title !== '' ? <div className="chart-tooltip-title">{title}</div> : null}
      {rows.map((entry, index) => {
        let value: ReactNode;
        let name: ReactNode = entry.name;
        if (formatter) {
          const formatted = formatter(entry.value, entry.name, entry, index, rows);
          if (Array.isArray(formatted)) {
            [value, name] = formatted as [ReactNode, ReactNode];
          } else {
            value = formatted;
          }
        } else if (typeof entry.value === 'number') {
          value = valueFormatter ? valueFormatter(entry.value) : formatNumber(entry.value);
        } else {
          value = String(entry.value ?? '');
        }
        const color = entry.color ?? entry.stroke ?? entry.fill;
        return (
          <div key={`${String(entry.dataKey ?? name)}-${index}`} className="chart-tooltip-row">
            <span
              className={indicator === 'box' ? 'chart-legend-key is-box' : 'chart-legend-key'}
              style={{ ['--legend-color' as string]: color }}
              aria-hidden
            />
            <span className="chart-tooltip-name">{name}</span>
            <span className="chart-tooltip-value">{value}</span>
          </div>
        );
      })}
    </div>
  );
}
