import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { BarStack } from 'recharts';

/*
 * Reads a Recharts chart's children to find what it plots. Kept apart from chartTicks.ts so pages
 * that only need clean ticks (the landing preview) do not load Recharts.
 */

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
