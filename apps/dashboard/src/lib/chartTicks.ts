import { Children, isValidElement, type ReactNode } from 'react';

/** Rounds a rough step up to 1, 2 or 5 × 10^n (dataviz: clean axis values). */
export function niceStep(rough: number): number {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1;
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** Ticks from 0 to a clean ceiling above `max`, about `count` intervals (0/50/100/150, not 0/35/70). */
export function niceTicks(max: number, count = 4, allowDecimals = false): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0, 1];
  let step = niceStep(max / count);
  if (!allowDecimals) step = Math.max(1, Math.round(step));
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

type MarkProps = { dataKey?: unknown; stackId?: unknown; hide?: boolean; yAxisId?: unknown; xAxisId?: unknown };

/**
 * Largest plotted value across the chart's series (stacked series summed per row), read from
 * the marks' `dataKey`s. Null when a series uses a function key or nothing numeric is found.
 */
export function plottedMax(data: unknown[], children: ReactNode): number | null {
  const marks = Children.toArray(children)
    .filter(isValidElement)
    .map((element) => element.props as MarkProps)
    .filter((props) => props.dataKey !== undefined && !props.hide);
  if (!marks.length || marks.some((props) => typeof props.dataKey !== 'string' && typeof props.dataKey !== 'number')) {
    return null;
  }
  let max = 0;
  let found = false;
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const stacks = new Map<string, number>();
    for (const props of marks) {
      const value = Number(record[String(props.dataKey)]);
      if (!Number.isFinite(value)) continue;
      found = true;
      if (props.stackId !== undefined) {
        const key = String(props.stackId);
        stacks.set(key, (stacks.get(key) ?? 0) + Math.max(0, value));
      } else {
        max = Math.max(max, value);
      }
    }
    for (const total of stacks.values()) max = Math.max(max, total);
  }
  return found ? max : null;
}
