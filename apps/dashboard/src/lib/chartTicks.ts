import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { BarStack } from 'recharts';

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

type MarkProps = {
  dataKey?: unknown;
  stackId?: unknown;
  hide?: boolean;
  yAxisId?: unknown;
  xAxisId?: unknown;
  children?: ReactNode;
};

/**
 * The marks of a chart with their effective stack: direct children, plus the bars inside a
 * <BarStack> (one implicit stack per BarStack) or a fragment.
 */
function collectMarks(children: ReactNode, stack?: string, path = 'm'): MarkProps[] {
  const marks: MarkProps[] = [];
  Children.toArray(children).forEach((child, index) => {
    if (!isValidElement(child)) return;
    const props = child.props as MarkProps;
    if (props.dataKey !== undefined) {
      if (!props.hide) marks.push(stack !== undefined && props.stackId === undefined ? { ...props, stackId: stack } : props);
      return;
    }
    if (child.type === BarStack || child.type === Fragment) {
      const ownStack = child.type === BarStack ? String(props.stackId ?? `${path}.${index}`) : stack;
      marks.push(...collectMarks(props.children, ownStack, `${path}.${index}`));
    }
  });
  return marks;
}

/**
 * Value range across the chart's series (stacked series summed per row, positives and negatives
 * apart), read from the marks' `dataKey`s. Null when a series uses a function key or nothing
 * numeric is found.
 */
export function plottedRange(data: unknown[], children: ReactNode): { min: number; max: number } | null {
  const marks = collectMarks(children);
  if (!marks.length || marks.some((props) => typeof props.dataKey !== 'string' && typeof props.dataKey !== 'number')) {
    return null;
  }
  let max = 0;
  let min = 0;
  let found = false;
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const stacks = new Map<string, { up: number; down: number }>();
    for (const props of marks) {
      const value = Number(record[String(props.dataKey)]);
      if (!Number.isFinite(value)) continue;
      found = true;
      if (props.stackId !== undefined) {
        const key = String(props.stackId);
        const total = stacks.get(key) ?? { up: 0, down: 0 };
        if (value >= 0) total.up += value;
        else total.down += value;
        stacks.set(key, total);
      } else {
        max = Math.max(max, value);
        min = Math.min(min, value);
      }
    }
    for (const total of stacks.values()) {
      max = Math.max(max, total.up);
      min = Math.min(min, total.down);
    }
  }
  return found ? { min, max } : null;
}

/** Largest plotted value (see `plottedRange`). */
export function plottedMax(data: unknown[], children: ReactNode): number | null {
  return plottedRange(data, children)?.max ?? null;
}

/**
 * Clean ticks covering [min, max] with zero on a tick: niceTicks for the positive side, mirrored
 * steps below zero (lifecycle "dormant", MRR churn).
 */
export function niceSignedTicks(min: number, max: number, count = 4, allowDecimals = false): number[] {
  if (!(min < 0)) return niceTicks(max, count, allowDecimals);
  const span = Math.max(max, 0) - min;
  let step = niceStep(span / count);
  if (!allowDecimals) step = Math.max(1, Math.round(step));
  const bottom = Math.floor(min / step + 1e-9) * step;
  const top = Math.max(0, Math.ceil(max / step - 1e-9) * step);
  const ticks: number[] = [];
  for (let value = bottom; value <= top + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}
