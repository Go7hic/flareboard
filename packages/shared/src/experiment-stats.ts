/**
 * Statistics for experiment analysis. Pure and deterministic (the Monte Carlo helpers use a fixed
 * seed), so the same inputs always produce the same numbers on the server, in tests and in the
 * dashboard.
 *
 * Conventions: rates and lifts are fractions (0.05 = 5%), intervals are two-sided `[low, high]`,
 * `alpha` is the two-sided significance level.
 */

export const DEFAULT_ALPHA = 0.05;
export const DEFAULT_POWER = 0.8;
/** Sample ratio mismatch is flagged below this p-value (a deliberately strict threshold). */
export const SRM_P_VALUE_THRESHOLD = 0.001;
/** Chi-square needs a handful of expected units per arm before the approximation holds. */
export const SRM_MIN_EXPECTED_PER_ARM = 5;

export type Interval = [number, number];

// ---------------------------------------------------------------------------------------------
// Special functions
// ---------------------------------------------------------------------------------------------

const EPSILON = 1e-15;
const TINY = 1e-300;

/**
 * Standard normal CDF with ~1e-15 relative error in both tails (Hart 1968 rational form near
 * the center, see West 2005; Mills-ratio continued fraction in the tails).
 */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  const ax = Math.abs(x);
  let tail: number;
  if (ax > 37) {
    tail = 0;
  } else {
    const e = Math.exp((-ax * ax) / 2);
    if (ax < 3) {
      let n = 3.52624965998911e-2 * ax + 0.700383064443688;
      n = n * ax + 6.37396220353165;
      n = n * ax + 33.912866078383;
      n = n * ax + 112.079291497871;
      n = n * ax + 221.213596169931;
      n = n * ax + 220.206867912376;
      let d = 8.83883476483184e-2 * ax + 1.75566716318264;
      d = d * ax + 16.064177579207;
      d = d * ax + 86.7807322029461;
      d = d * ax + 296.564248779674;
      d = d * ax + 637.333633378831;
      d = d * ax + 793.826512519948;
      d = d * ax + 440.413735824752;
      tail = (e * n) / d;
    } else {
      // Mills-ratio continued fraction x + 1/(x + 2/(x + 3/(x + …))). Sixty levels converge
      // to ~1e-15 relative error for x >= 3, where the rational form loses relative precision.
      let d = ax;
      for (let k = 60; k >= 1; k--) d = ax + k / d;
      tail = e / d / Math.sqrt(2 * Math.PI);
    }
  }
  return x > 0 ? 1 - tail : tail;
}

const ACKLAM_A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
  -3.066479806614716e1, 2.506628277459239,
];
const ACKLAM_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
  -1.328068155288572e1,
];
const ACKLAM_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
  4.374664141464968, 2.938163982698783,
];
const ACKLAM_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

/** Inverse standard normal CDF (Acklam's approximation refined with one Halley step). */
export function normalQuantile(p: number): number {
  if (Number.isNaN(p) || p < 0 || p > 1) return Number.NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const low = 0.02425;
  let x: number;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((ACKLAM_C[0]! * q + ACKLAM_C[1]!) * q + ACKLAM_C[2]!) * q + ACKLAM_C[3]!) * q + ACKLAM_C[4]!) * q +
        ACKLAM_C[5]!) /
      ((((ACKLAM_D[0]! * q + ACKLAM_D[1]!) * q + ACKLAM_D[2]!) * q + ACKLAM_D[3]!) * q + 1);
  } else if (p <= 1 - low) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((ACKLAM_A[0]! * r + ACKLAM_A[1]!) * r + ACKLAM_A[2]!) * r + ACKLAM_A[3]!) * r + ACKLAM_A[4]!) * r +
        ACKLAM_A[5]!) *
        q) /
      (((((ACKLAM_B[0]! * r + ACKLAM_B[1]!) * r + ACKLAM_B[2]!) * r + ACKLAM_B[3]!) * r + ACKLAM_B[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((ACKLAM_C[0]! * q + ACKLAM_C[1]!) * q + ACKLAM_C[2]!) * q + ACKLAM_C[3]!) * q + ACKLAM_C[4]!) * q +
        ACKLAM_C[5]!) /
      ((((ACKLAM_D[0]! * q + ACKLAM_D[1]!) * q + ACKLAM_D[2]!) * q + ACKLAM_D[3]!) * q + 1);
  }
  // One Halley step on Φ(x) - p, computed from the smaller tail so it keeps precision near 1.
  const error = p > 0.5 ? 1 - p - normalCdf(-x) : normalCdf(x) - p;
  const u = error * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0 (Lanczos, g = 7). */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0]!;
  const t = z + 7.5;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/** Regularized upper incomplete gamma Q(a, x) = Γ(a, x) / Γ(a). */
export function regularizedGammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (!Number.isFinite(x)) return 0;
  const logPrefix = -x + a * Math.log(x) - logGamma(a);
  if (x < a + 1) {
    // Series for P(a, x).
    let term = 1 / a;
    let sum = term;
    let ap = a;
    for (let n = 0; n < 10_000; n++) {
      ap += 1;
      term *= x / ap;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * EPSILON) break;
    }
    return Math.min(1, Math.max(0, 1 - sum * Math.exp(logPrefix)));
  }
  // Continued fraction for Q(a, x) (modified Lentz).
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 10_000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPSILON) break;
  }
  return Math.min(1, Math.max(0, Math.exp(logPrefix) * h));
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 100_000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPSILON) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logFront = a * Math.log(x) + b * Math.log1p(-x) - logBeta(a, b);
  if (x < (a + 1) / (a + b + 2)) {
    return Math.min(1, Math.max(0, (Math.exp(logFront) * betaContinuedFraction(x, a, b)) / a));
  }
  return Math.min(1, Math.max(0, 1 - (Math.exp(logFront) * betaContinuedFraction(1 - x, b, a)) / b));
}

/** Quantile of Beta(a, b) by bisection on the CDF (converges to full double precision). */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 200 && high - low > 1e-15; i++) {
    const mid = (low + high) / 2;
    if (regularizedBeta(mid, a, b) < p) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** Two-sided tail probability P(|T| >= |t|) of Student's t with `df` degrees of freedom. */
export function studentTTwoSidedPValue(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  if (df > 1e7) return 2 * normalCdf(-Math.abs(t));
  return regularizedBeta(df / (df + t * t), df / 2, 0.5);
}

/** CDF of Student's t. */
export function studentTCdf(t: number, df: number): number {
  const tail = studentTTwoSidedPValue(t, df) / 2;
  return t > 0 ? 1 - tail : tail;
}

/** Quantile of Student's t (bisection on the CDF). */
export function studentTQuantile(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  if (df > 1e7) return normalQuantile(p);
  if (p < 0.5) return -studentTQuantile(1 - p, df);
  // Upper tail: find t with P(T > t) = 1 - p.
  const target = 2 * (1 - p);
  let low = 0;
  let high = Math.max(1, normalQuantile(p));
  while (studentTTwoSidedPValue(high, df) > target) high *= 2;
  for (let i = 0; i < 200 && high - low > 1e-13 * Math.max(1, high); i++) {
    const mid = (low + high) / 2;
    if (studentTTwoSidedPValue(mid, df) > target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** P(X >= x) for a chi-square distribution with `df` degrees of freedom. */
export function chiSquareSurvival(x: number, df: number): number {
  if (x <= 0) return 1;
  return regularizedGammaQ(df / 2, x / 2);
}

// ---------------------------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------------------------

/** Units exposed and units that converted. */
export type ProportionSample = { n: number; successes: number };
/** Units with a value, the mean and the sample variance (n - 1 denominator). */
export type MeanSample = { n: number; mean: number; variance: number };

export function meanSampleFromSums(n: number, sum: number, sumOfSquares: number): MeanSample {
  if (n <= 0) return { n: 0, mean: 0, variance: 0 };
  const mean = sum / n;
  const variance = n > 1 ? Math.max(0, (sumOfSquares - (sum * sum) / n) / (n - 1)) : 0;
  return { n, mean, variance };
}

/** Wilson score interval for a proportion. */
export function wilsonInterval(successes: number, n: number, alpha = DEFAULT_ALPHA): Interval | null {
  if (n <= 0) return null;
  const z = normalQuantile(1 - alpha / 2);
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return [Math.max(0, (center - margin) / denominator), Math.min(1, (center + margin) / denominator)];
}

/** t interval for a mean. */
export function meanInterval(sample: MeanSample, alpha = DEFAULT_ALPHA): Interval | null {
  if (sample.n < 2) return null;
  const se = Math.sqrt(sample.variance / sample.n);
  const t = studentTQuantile(1 - alpha / 2, sample.n - 1);
  return [sample.mean - t * se, sample.mean + t * se];
}

/**
 * Delta-method interval for the relative lift `variant / control - 1`, given the two estimates
 * and the variances of those estimates.
 */
function relativeLiftInterval(
  control: number,
  variant: number,
  controlEstimateVariance: number,
  variantEstimateVariance: number,
  critical: number,
): Interval | null {
  if (!(control > 0)) return null;
  const lift = variant / control - 1;
  const variance =
    variantEstimateVariance / (control * control) +
    (variant * variant * controlEstimateVariance) / (control * control * control * control);
  const margin = critical * Math.sqrt(variance);
  return [lift - margin, lift + margin];
}

export type FrequentistComparison = {
  /** Test statistic (z or t). */
  statistic: number | null;
  /** Welch degrees of freedom for means; null for proportions. */
  degreesOfFreedom: number | null;
  pValue: number | null;
  significant: boolean;
  difference: number;
  differenceInterval: Interval | null;
  lift: number | null;
  liftInterval: Interval | null;
};

/**
 * Two-proportion z-test (pooled standard error for the test, unpooled for the difference
 * interval) with a delta-method interval for the relative lift.
 */
export function twoProportionZTest(
  control: ProportionSample,
  variant: ProportionSample,
  alpha = DEFAULT_ALPHA,
): FrequentistComparison {
  const p1 = control.n > 0 ? control.successes / control.n : 0;
  const p2 = variant.n > 0 ? variant.successes / variant.n : 0;
  const difference = p2 - p1;
  const lift = p1 > 0 ? p2 / p1 - 1 : null;
  const empty: FrequentistComparison = {
    statistic: null,
    degreesOfFreedom: null,
    pValue: null,
    significant: false,
    difference,
    differenceInterval: null,
    lift,
    liftInterval: null,
  };
  if (control.n <= 0 || variant.n <= 0) return empty;
  const z = normalQuantile(1 - alpha / 2);
  const v1 = (p1 * (1 - p1)) / control.n;
  const v2 = (p2 * (1 - p2)) / variant.n;
  const unpooled = Math.sqrt(v1 + v2);
  const differenceInterval: Interval = [difference - z * unpooled, difference + z * unpooled];
  const liftInterval = relativeLiftInterval(p1, p2, v1, v2, z);
  const pooled = (control.successes + variant.successes) / (control.n + variant.n);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / control.n + 1 / variant.n));
  if (!(se > 0)) return { ...empty, differenceInterval, liftInterval };
  const statistic = difference / se;
  const pValue = Math.min(1, 2 * normalCdf(-Math.abs(statistic)));
  return {
    statistic,
    degreesOfFreedom: null,
    pValue,
    significant: pValue < alpha,
    difference,
    differenceInterval,
    lift,
    liftInterval,
  };
}

/** Welch's unequal-variance t-test with a t interval for the difference and the relative lift. */
export function welchTTest(control: MeanSample, variant: MeanSample, alpha = DEFAULT_ALPHA): FrequentistComparison {
  const difference = variant.mean - control.mean;
  const lift = control.mean > 0 ? variant.mean / control.mean - 1 : null;
  const empty: FrequentistComparison = {
    statistic: null,
    degreesOfFreedom: null,
    pValue: null,
    significant: false,
    difference,
    differenceInterval: null,
    lift,
    liftInterval: null,
  };
  if (control.n < 2 || variant.n < 2) return empty;
  const v1 = control.variance / control.n;
  const v2 = variant.variance / variant.n;
  const se = Math.sqrt(v1 + v2);
  if (!(se > 0)) return empty;
  const df = ((v1 + v2) * (v1 + v2)) / ((v1 * v1) / (control.n - 1) + (v2 * v2) / (variant.n - 1));
  const statistic = difference / se;
  const pValue = Math.min(1, studentTTwoSidedPValue(statistic, df));
  const critical = studentTQuantile(1 - alpha / 2, df);
  return {
    statistic,
    degreesOfFreedom: df,
    pValue,
    significant: pValue < alpha,
    difference,
    differenceInterval: [difference - critical * se, difference + critical * se],
    lift,
    liftInterval: relativeLiftInterval(control.mean, variant.mean, v1, v2, critical),
  };
}

// ---------------------------------------------------------------------------------------------
// Bayesian
// ---------------------------------------------------------------------------------------------

export type BetaParams = { alpha: number; beta: number };

/** Posterior Beta(1 + successes, 1 + failures) under a uniform prior. */
export function betaPosterior(sample: ProportionSample): BetaParams {
  return { alpha: 1 + sample.successes, beta: 1 + Math.max(0, sample.n - sample.successes) };
}

/** Largest closed-form sum evaluated before switching to the normal approximation. */
const MAX_CLOSED_FORM_TERMS = 200_000;

/**
 * P(Y > X) for X ~ Beta(aX, bX), Y ~ Beta(aY, bY) with integer aY, as a sum of aY terms
 * (Evan Miller's closed form), accumulated in log space.
 */
function betaGreaterSum(aX: number, bX: number, aY: number, bY: number): number {
  let logTerm = logBeta(aX, bX + bY) - logBeta(aX, bX);
  let maxLog = logTerm;
  let scaled = 1;
  for (let i = 0; i < aY - 1; i++) {
    logTerm += Math.log(((aX + i) * (bY + i)) / ((aX + bX + bY + i) * (1 + i)));
    if (logTerm > maxLog) {
      scaled = scaled * Math.exp(maxLog - logTerm) + 1;
      maxLog = logTerm;
    } else {
      scaled += Math.exp(logTerm - maxLog);
    }
  }
  return Math.exp(maxLog + Math.log(scaled));
}

function betaMoments({ alpha, beta }: BetaParams) {
  const total = alpha + beta;
  return { mean: alpha / total, variance: (alpha * beta) / (total * total * (total + 1)) };
}

/**
 * P(B > A) for independent Beta variables. Exact closed form summed over whichever parameter is
 * smallest (all four are equivalent by symmetry); normal approximation only when every
 * parameter is huge or not an integer.
 */
export function probabilityBetaGreater(a: BetaParams, b: BetaParams): number {
  const candidates: Array<{ size: number; compute: () => number }> = [
    { size: b.alpha, compute: () => betaGreaterSum(a.alpha, a.beta, b.alpha, b.beta) },
    { size: a.alpha, compute: () => 1 - betaGreaterSum(b.alpha, b.beta, a.alpha, a.beta) },
    // 1 - p flips the order: B > A  <=>  (1 - A) > (1 - B).
    { size: a.beta, compute: () => betaGreaterSum(b.beta, b.alpha, a.beta, a.alpha) },
    { size: b.beta, compute: () => 1 - betaGreaterSum(a.beta, a.alpha, b.beta, b.alpha) },
  ].filter((candidate) => Number.isInteger(candidate.size) && candidate.size <= MAX_CLOSED_FORM_TERMS);
  candidates.sort((left, right) => left.size - right.size);
  const best = candidates[0];
  if (best) return Math.min(1, Math.max(0, best.compute()));
  const ma = betaMoments(a);
  const mb = betaMoments(b);
  return normalCdf((mb.mean - ma.mean) / Math.sqrt(ma.variance + mb.variance));
}

/** Seeded PRNG (mulberry32): deterministic uniform draws in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function standardNormalDraw(random: () => number): number {
  let u = 0;
  while (u <= Number.MIN_VALUE) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** Gamma(shape, 1) draw (Marsaglia–Tsang). */
function gammaDraw(shape: number, random: () => number): number {
  if (shape < 1) {
    let u = 0;
    while (u <= Number.MIN_VALUE) u = random();
    return gammaDraw(shape + 1, random) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = standardNormalDraw(random);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaDraw({ alpha, beta }: BetaParams, random: () => number): number {
  const x = gammaDraw(alpha, random);
  const y = gammaDraw(beta, random);
  return x / (x + y);
}

function quantileOfSorted(sorted: Float64Array, p: number): number {
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export const MONTE_CARLO_DRAWS = 20_000;
export const MONTE_CARLO_SEED = 0x5eed_f1a2;

/** Credible interval of `variant / control - 1` from paired posterior draws. */
function liftCredibleInterval(
  drawControl: (random: () => number) => number,
  drawVariant: (random: () => number) => number,
  alpha: number,
  draws: number,
  seed: number,
): Interval | null {
  const random = seededRandom(seed);
  const lifts = new Float64Array(draws);
  for (let i = 0; i < draws; i++) {
    const control = drawControl(random);
    const variant = drawVariant(random);
    if (!(control > 0)) return null;
    lifts[i] = variant / control - 1;
  }
  lifts.sort();
  return [quantileOfSorted(lifts, alpha / 2), quantileOfSorted(lifts, 1 - alpha / 2)];
}

export type BayesianComparison = {
  /** P(variant > control) under the posterior. */
  probabilityToBeatControl: number;
  controlInterval: Interval;
  variantInterval: Interval;
  /** Credible interval of the relative lift, null when the control posterior reaches 0. */
  liftInterval: Interval | null;
};

export type MonteCarloOptions = { draws?: number; seed?: number };

/** Beta-Binomial comparison with uniform priors. */
export function bayesianProportionComparison(
  control: ProportionSample,
  variant: ProportionSample,
  alpha = DEFAULT_ALPHA,
  options: MonteCarloOptions = {},
): BayesianComparison {
  const a = betaPosterior(control);
  const b = betaPosterior(variant);
  return {
    probabilityToBeatControl: probabilityBetaGreater(a, b),
    controlInterval: betaCredibleInterval(control, alpha),
    variantInterval: betaCredibleInterval(variant, alpha),
    liftInterval: liftCredibleInterval(
      (random) => betaDraw(a, random),
      (random) => betaDraw(b, random),
      alpha,
      options.draws ?? MONTE_CARLO_DRAWS,
      options.seed ?? MONTE_CARLO_SEED,
    ),
  };
}

/** Equal-tailed credible interval of the Beta posterior for a proportion. */
export function betaCredibleInterval(sample: ProportionSample, alpha = DEFAULT_ALPHA): Interval {
  const { alpha: a, beta: b } = betaPosterior(sample);
  return [betaQuantile(alpha / 2, a, b), betaQuantile(1 - alpha / 2, a, b)];
}

/** Normal posterior N(mean, variance / n) for a mean (flat prior, normal approximation). */
export function normalCredibleInterval(sample: MeanSample, alpha = DEFAULT_ALPHA): Interval | null {
  if (sample.n < 2) return null;
  const se = Math.sqrt(sample.variance / sample.n);
  const z = normalQuantile(1 - alpha / 2);
  return [sample.mean - z * se, sample.mean + z * se];
}

/**
 * Bayesian comparison of means using normal posteriors N(mean, variance / n). The lift interval
 * is the delta-method interval of the ratio of the two posteriors. Null when either arm has
 * fewer than 2 units.
 */
export function bayesianMeanComparison(
  control: MeanSample,
  variant: MeanSample,
  alpha = DEFAULT_ALPHA,
): BayesianComparison | null {
  const controlInterval = normalCredibleInterval(control, alpha);
  const variantInterval = normalCredibleInterval(variant, alpha);
  if (!controlInterval || !variantInterval) return null;
  const v1 = control.variance / control.n;
  const v2 = variant.variance / variant.n;
  const spread = Math.sqrt(v1 + v2);
  const difference = variant.mean - control.mean;
  const probabilityToBeatControl =
    spread > 0 ? normalCdf(difference / spread) : difference > 0 ? 1 : difference < 0 ? 0 : 0.5;
  return {
    probabilityToBeatControl,
    controlInterval,
    variantInterval,
    liftInterval: relativeLiftInterval(control.mean, variant.mean, v1, v2, normalQuantile(1 - alpha / 2)),
  };
}

// ---------------------------------------------------------------------------------------------
// Sample ratio mismatch
// ---------------------------------------------------------------------------------------------

/**
 * How a feature flag splits traffic, captured when an experiment starts. Mirrors the inputs of
 * `evaluateFeatureFlag` (feature-flag-evaluator.ts) that decide the variant.
 */
export type ExperimentAllocation = {
  enabled: boolean;
  rollout: number;
  variants: Array<{ key: string; weight?: number }>;
  /** True when targeting rules exist: non-matching units are served `control`. */
  targeted: boolean;
};

/**
 * Expected share of exposures per variant under `evaluateFeatureFlag`: units outside the
 * rollout, or on the remainder of variant weights below 100, are served `control`; a flag
 * without variants serves `test` inside the rollout. Buckets are integers 0–99.
 */
export function expectedVariantShares(allocation: ExperimentAllocation): {
  shares: Record<string, number>;
  /** False when targeting rules send an unknown share of traffic to `control`. */
  controlShareKnown: boolean;
} {
  const shares: Record<string, number> = {};
  const add = (key: string, share: number) => {
    if (share > 0) shares[key] = (shares[key] ?? 0) + share;
  };
  if (!allocation.enabled) {
    add('control', 1);
    return { shares, controlShareKnown: !allocation.targeted };
  }
  const rollout = Number.isFinite(allocation.rollout) ? allocation.rollout : 100;
  const inRollout = rollout >= 100 ? 1 : rollout <= 0 ? 0 : Math.min(100, Math.ceil(rollout)) / 100;
  add('control', 1 - inRollout);
  const variants = (allocation.variants ?? []).filter((variant) => variant && variant.key);
  if (!variants.length) {
    add('test', inRollout);
  } else {
    let cumulative = 0;
    for (const variant of variants) {
      const weight = Math.max(0, Math.min(100, Number(variant.weight ?? 0) || 0));
      const previous = cumulative;
      cumulative += weight;
      const buckets = Math.min(100, Math.ceil(cumulative)) - Math.min(100, Math.ceil(previous));
      add(String(variant.key), (inRollout * buckets) / 100);
    }
    add('control', (inRollout * (100 - Math.min(100, Math.ceil(cumulative)))) / 100);
  }
  return { shares, controlShareKnown: !allocation.targeted };
}

export type SampleRatioCheck = {
  status: 'ok' | 'mismatch' | 'insufficient_data' | 'not_applicable';
  reason: 'unexpected_variant' | 'single_arm' | 'targeting_rules' | null;
  pValue: number | null;
  chiSquare: number | null;
  degreesOfFreedom: number | null;
  /** Expected share per arm included in the test (renormalized). */
  expectedShares: Record<string, number>;
};

/** Chi-square goodness-of-fit of observed units per arm against expected shares. */
export function sampleRatioMismatch(
  observed: Record<string, number>,
  expectedShares: Record<string, number>,
  threshold = SRM_P_VALUE_THRESHOLD,
): SampleRatioCheck {
  const arms = Object.keys(expectedShares).filter((key) => (expectedShares[key] ?? 0) > 0);
  const shareTotal = arms.reduce((sum, key) => sum + expectedShares[key]!, 0);
  const normalized = Object.fromEntries(arms.map((key) => [key, expectedShares[key]! / shareTotal]));
  const base = { pValue: null, chiSquare: null, degreesOfFreedom: null, expectedShares: normalized };
  if (Object.entries(observed).some(([key, count]) => count > 0 && !(key in normalized))) {
    return { status: 'not_applicable', reason: 'unexpected_variant', ...base };
  }
  if (arms.length < 2) return { status: 'not_applicable', reason: 'single_arm', ...base };
  const total = arms.reduce((sum, key) => sum + (observed[key] ?? 0), 0);
  if (arms.some((key) => total * normalized[key]! < SRM_MIN_EXPECTED_PER_ARM)) {
    return { status: 'insufficient_data', reason: null, ...base };
  }
  let chiSquare = 0;
  for (const key of arms) {
    const expected = total * normalized[key]!;
    const diff = (observed[key] ?? 0) - expected;
    chiSquare += (diff * diff) / expected;
  }
  const degreesOfFreedom = arms.length - 1;
  const pValue = chiSquareSurvival(chiSquare, degreesOfFreedom);
  return {
    status: pValue < threshold ? 'mismatch' : 'ok',
    reason: null,
    pValue,
    chiSquare,
    degreesOfFreedom,
    expectedShares: normalized,
  };
}

/**
 * SRM check against a flag allocation. With targeting rules the `control` share is unknown, so
 * control is left out and the remaining arms are compared with each other.
 */
export function checkSampleRatio(
  observed: Record<string, number>,
  allocation: ExperimentAllocation,
  threshold = SRM_P_VALUE_THRESHOLD,
): SampleRatioCheck {
  const { shares, controlShareKnown } = expectedVariantShares(allocation);
  if (controlShareKnown) return sampleRatioMismatch(observed, shares, threshold);
  const withoutControl = (record: Record<string, number>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'control'));
  const result = sampleRatioMismatch(withoutControl(observed), withoutControl(shares), threshold);
  return result.reason === 'single_arm' ? { ...result, reason: 'targeting_rules' } : result;
}

// ---------------------------------------------------------------------------------------------
// Sample size guidance
// ---------------------------------------------------------------------------------------------

function criticalValues(alpha: number, power: number) {
  return { zAlpha: normalQuantile(1 - alpha / 2), zBeta: normalQuantile(power) };
}

/**
 * Units per variant needed to detect a relative lift `relativeMde` over `baseline` conversion
 * with a two-sided two-proportion z-test. Null when the target rate would leave (0, 1).
 */
export function requiredSampleSizeForProportion(
  baseline: number,
  relativeMde: number,
  alpha = DEFAULT_ALPHA,
  power = DEFAULT_POWER,
): number | null {
  if (!(baseline > 0 && baseline < 1) || !(relativeMde > 0)) return null;
  const target = baseline * (1 + relativeMde);
  if (!(target < 1)) return null;
  const { zAlpha, zBeta } = criticalValues(alpha, power);
  const average = (baseline + target) / 2;
  const numerator =
    zAlpha * Math.sqrt(2 * average * (1 - average)) +
    zBeta * Math.sqrt(baseline * (1 - baseline) + target * (1 - target));
  return Math.ceil((numerator * numerator) / ((target - baseline) * (target - baseline)));
}

/** Units per variant needed to detect a relative change `relativeMde` of a mean with sd `sqrt(variance)`. */
export function requiredSampleSizeForMean(
  mean: number,
  variance: number,
  relativeMde: number,
  alpha = DEFAULT_ALPHA,
  power = DEFAULT_POWER,
): number | null {
  const delta = Math.abs(mean) * relativeMde;
  if (!(delta > 0) || !(variance > 0)) return null;
  const { zAlpha, zBeta } = criticalValues(alpha, power);
  const z = zAlpha + zBeta;
  return Math.ceil((2 * z * z * variance) / (delta * delta));
}

/** Smallest relative lift detectable with `n` units per variant at the given baseline conversion. */
export function minimumDetectableEffectForProportion(
  baseline: number,
  n: number,
  alpha = DEFAULT_ALPHA,
  power = DEFAULT_POWER,
): number | null {
  if (!(baseline > 0 && baseline < 1) || !(n > 0)) return null;
  const { zAlpha, zBeta } = criticalValues(alpha, power);
  return ((zAlpha + zBeta) * Math.sqrt((2 * baseline * (1 - baseline)) / n)) / baseline;
}

/** Smallest relative change of a mean detectable with `n` units per variant. */
export function minimumDetectableEffectForMean(
  mean: number,
  variance: number,
  n: number,
  alpha = DEFAULT_ALPHA,
  power = DEFAULT_POWER,
): number | null {
  if (!(Math.abs(mean) > 0) || !(variance > 0) || !(n > 0)) return null;
  const { zAlpha, zBeta } = criticalValues(alpha, power);
  return ((zAlpha + zBeta) * Math.sqrt((2 * variance) / n)) / Math.abs(mean);
}
