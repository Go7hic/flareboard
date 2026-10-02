/**
 * Mark presets for Recharts series (console v2 / dataviz method). Spread them onto <Bar>,
 * <Line> and <Area> so every chart shares the same thin, quiet marks:
 *
 *   <Bar dataKey="count" fill={colors.accent} {...BAR_MARK} />
 *   <Bar dataKey="count" fill={colors.accent} {...HBAR_MARK} />   // layout="vertical"
 *   <Line dataKey="visitors" stroke={colors.series.visitors} {...lineMark(colors.panel)} />
 *   <Area dataKey="pageviews" stroke={c} fill={c} {...areaMark(colors.panel)} />
 */

/** Vertical bars: ≤ 24px thick, 4px rounded data end, square at the baseline. */
export const BAR_MARK = {
  maxBarSize: 24,
  radius: [4, 4, 0, 0] as [number, number, number, number],
  isAnimationActive: false,
};

/** Horizontal bars (layout="vertical"): rounded at the right end. */
export const HBAR_MARK = {
  maxBarSize: 20,
  radius: [0, 4, 4, 0] as [number, number, number, number],
  isAnimationActive: false,
};

/** Stacked segments: only the top segment should get the rounded end (pass radius there). */
export const STACK_MARK = {
  maxBarSize: 24,
  isAnimationActive: false,
};

/** 2px line, no resting dots; the hover dot is 8px with a 2px ring in the surface color. */
export function lineMark(surface: string) {
  return {
    type: 'monotone' as const,
    strokeWidth: 2,
    dot: false,
    activeDot: { r: 4, strokeWidth: 2, stroke: surface },
    isAnimationActive: false,
  };
}

/** Area for a single series: the line plus a 10% wash. */
export function areaMark(surface: string) {
  return {
    ...lineMark(surface),
    fillOpacity: 0.1,
  };
}

/** Comparison series (previous period): dashed-free, lighter line in the same hue. */
export function previousLineMark(surface: string) {
  return {
    ...lineMark(surface),
    strokeOpacity: 0.35,
    strokeWidth: 1.5,
  };
}
