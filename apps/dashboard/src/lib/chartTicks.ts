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
