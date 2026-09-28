import { describe, expect, it } from 'vitest';
import {
  bayesianMeanComparison,
  bayesianProportionComparison,
  betaCredibleInterval,
  betaQuantile,
  checkSampleRatio,
  chiSquareSurvival,
  expectedVariantShares,
  meanSampleFromSums,
  minimumDetectableEffectForMean,
  minimumDetectableEffectForProportion,
  normalCdf,
  normalQuantile,
  probabilityBetaGreater,
  regularizedBeta,
  requiredSampleSizeForMean,
  requiredSampleSizeForProportion,
  sampleRatioMismatch,
  studentTCdf,
  studentTQuantile,
  twoProportionZTest,
  welchTTest,
  wilsonInterval,
} from './experiment-stats';
import { evaluateFeatureFlag } from './feature-flag-evaluator';

// Reference values were computed independently with Python's math.erfc / math.lgamma and
// brute-force numerical integration of the densities (not with the algorithms under test).

describe('special functions', () => {
  it('normal CDF matches erfc to double precision', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517795, 14);
    expect(normalCdf(-3)).toBeCloseTo(0.0013498980316300957, 15);
    expect(normalCdf(0)).toBe(0.5);
    expect(normalCdf(1)).toBeCloseTo(0.8413447460685429, 14);
    expect(normalCdf(5)).toBeCloseTo(0.9999997133484281, 14);
    // Tails keep their relative precision on both sides of the |x| = 3 branch point.
    const tails: Array<[number, number]> = [
      [-2, 0.022750131948179216],
      [-2.9, 0.0018658133003840378],
      [-3.1, 0.0009676032132183563],
      [-4, 3.167124183311996e-5],
      [-5, 2.866515718791945e-7],
      [-6, 9.865876450377014e-10],
      [-7, 1.2798125438858348e-12],
      [-7.5, 3.1908916729109203e-14],
      [-8, 6.22096057427182e-16],
      [-10, 7.619853024160593e-24],
      [-20, 2.7536241186063314e-89],
    ];
    for (const [x, reference] of tails) expect(normalCdf(x) / reference).toBeCloseTo(1, 12);
    expect(normalCdf(-40)).toBe(0);
    expect(normalCdf(40)).toBe(1);
  });

  it('normal quantile inverts the CDF, including far tails', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.9599639845400532, 12);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959963984540054, 12);
    expect(normalQuantile(0.8)).toBeCloseTo(0.8416212335729141, 12);
    expect(normalQuantile(0.999)).toBeCloseTo(3.090232306167797, 11);
    expect(normalQuantile(1e-10)).toBeCloseTo(-6.3613409024040575, 9);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 14);
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
  });

  it('chi-square survival matches the closed forms for 1, 2 and 3 degrees of freedom', () => {
    expect(chiSquareSurvival(3.841458820694124, 1)).toBeCloseTo(0.05, 12);
    expect(chiSquareSurvival(10.827566170662733, 1)).toBeCloseTo(0.001, 13);
    expect(chiSquareSurvival(0.5, 1)).toBeCloseTo(0.4795001221869535, 12);
    expect(chiSquareSurvival(13.815510557964274, 2)).toBeCloseTo(0.001, 13);
    expect(chiSquareSurvival(4.2, 2)).toBeCloseTo(0.1224564282529819, 12);
    expect(chiSquareSurvival(7.814727903251178, 3)).toBeCloseTo(0.05, 12);
    expect(chiSquareSurvival(20, 3)).toBeCloseTo(0.00016974243555282643, 14);
    expect(chiSquareSurvival(0, 3)).toBe(1);
  });

  it('Student t CDF and quantile match numerical integration', () => {
    expect(studentTCdf(2.228138851986274, 10)).toBeCloseTo(0.975, 12);
    expect(studentTCdf(1.5, 10)).toBeCloseTo(0.9177463367772825, 12);
    expect(studentTCdf(-2, 3)).toBeCloseTo(0.06966298427942452, 12);
    expect(studentTCdf(2.46, 24.9)).toBeCloseTo(0.9894072663555131, 12);
    expect(studentTCdf(3, 1)).toBeCloseTo(0.5 + Math.atan(3) / Math.PI, 12);
    expect(studentTQuantile(0.975, 10)).toBeCloseTo(2.228138851986274, 9);
    expect(studentTQuantile(0.975, 3)).toBeCloseTo(3.182446305283711, 9);
    expect(studentTQuantile(0.025, 3)).toBeCloseTo(-3.182446305283711, 9);
    expect(studentTQuantile(0.975, 1)).toBeCloseTo(Math.tan(Math.PI * 0.475), 8);
  });

  it('incomplete beta and beta quantiles match exact and numerical references', () => {
    // Beta(a, 1) has CDF x^a and Beta(1, b) has CDF 1 - (1 - x)^b.
    expect(regularizedBeta(0.3, 4, 1)).toBeCloseTo(0.3 ** 4, 14);
    expect(regularizedBeta(0.3, 1, 5)).toBeCloseTo(1 - 0.7 ** 5, 14);
    expect(betaQuantile(0.9, 3, 1)).toBeCloseTo(0.9 ** (1 / 3), 12);
    expect(betaQuantile(0.025, 11, 91)).toBeCloseTo(0.055637223780852896, 7);
    expect(betaQuantile(0.975, 11, 91)).toBeCloseTo(0.17455282640560066, 7);
  });
});

describe('frequentist tests', () => {
  it('two-proportion z-test: 200/1000 vs 250/1000', () => {
    const result = twoProportionZTest({ n: 1000, successes: 200 }, { n: 1000, successes: 250 });
    expect(result.statistic).toBeCloseTo(2.677397763008329, 12);
    expect(result.pValue).toBeCloseTo(0.007419649261025691, 13);
    expect(result.significant).toBe(true);
    expect(result.difference).toBeCloseTo(0.05, 14);
    expect(result.differenceInterval![0]).toBeCloseTo(0.013463621687539853, 12);
    expect(result.differenceInterval![1]).toBeCloseTo(0.08653637831246012, 12);
    expect(result.lift).toBeCloseTo(0.25, 14);
    // Delta method: var(p2/p1) = v2/p1^2 + p2^2 v1/p1^4.
    const v1 = (0.2 * 0.8) / 1000;
    const v2 = (0.25 * 0.75) / 1000;
    const se = Math.sqrt(v2 / 0.04 + (0.0625 * v1) / 0.0016);
    expect(result.liftInterval![0]).toBeCloseTo(0.25 - 1.9599639845400532 * se, 12);
    expect(result.liftInterval![1]).toBeCloseTo(0.25 + 1.9599639845400532 * se, 12);
  });

  it('two-proportion z-test degrades gracefully without data or variance', () => {
    const empty = twoProportionZTest({ n: 0, successes: 0 }, { n: 10, successes: 3 });
    expect(empty.pValue).toBeNull();
    expect(empty.significant).toBe(false);
    const flat = twoProportionZTest({ n: 50, successes: 0 }, { n: 50, successes: 0 });
    expect(flat.pValue).toBeNull();
    expect(flat.lift).toBeNull();
    expect(flat.liftInterval).toBeNull();
  });

  it('Wilson interval matches the closed form, including zero successes', () => {
    const interval = wilsonInterval(250, 1000)!;
    expect(interval[0]).toBeCloseTo(0.2241530989836914, 12);
    expect(interval[1]).toBeCloseTo(0.2777602802590861, 12);
    const zero = wilsonInterval(0, 20)!;
    expect(zero[0]).toBe(0);
    expect(zero[1]).toBeCloseTo(0.16112515805281924, 12);
    expect(wilsonInterval(0, 0)).toBeNull();
  });

  it("Welch's t-test reproduces the reference example", () => {
    const a1 = [27.5, 21.0, 19.0, 23.6, 17.0, 17.9, 16.9, 20.1, 21.9, 22.6, 23.1, 19.6, 19.0, 21.7, 21.4];
    const a2 = [27.1, 22.0, 20.8, 23.4, 23.4, 23.5, 25.8, 22.0, 24.8, 20.2, 21.9, 22.1, 22.9, 20.5, 24.4];
    const sample = (values: number[]) =>
      meanSampleFromSums(
        values.length,
        values.reduce((sum, value) => sum + value, 0),
        values.reduce((sum, value) => sum + value * value, 0),
      );
    const control = sample(a1);
    const variant = sample(a2);
    expect(control.mean).toBeCloseTo(20.82, 12);
    expect(control.variance).toBeCloseTo(7.867428571428574, 10);
    expect(variant.variance).toBeCloseTo(3.8126666666666678, 10);
    const result = welchTTest(control, variant);
    expect(result.statistic).toBeCloseTo(2.455356398286006, 10);
    expect(result.degreesOfFreedom).toBeCloseTo(24.98852929023142, 9);
    expect(result.pValue).toBeCloseTo(0.02137800146285418, 10);
    expect(result.significant).toBe(true);
    expect(result.differenceInterval![0]).toBeCloseTo(0.349237066192454, 8);
    expect(result.differenceInterval![1]).toBeCloseTo(3.984096267140882, 8);
  });

  it("Welch's t-test needs two units per arm and some variance", () => {
    expect(welchTTest({ n: 1, mean: 3, variance: 0 }, { n: 10, mean: 4, variance: 1 }).pValue).toBeNull();
    expect(welchTTest({ n: 10, mean: 3, variance: 0 }, { n: 10, mean: 3, variance: 0 }).pValue).toBeNull();
    // One arm without variance still yields a test (df = n - 1 of the other arm).
    const oneSided = welchTTest({ n: 10, mean: 1, variance: 0 }, { n: 10, mean: 2, variance: 1 });
    expect(oneSided.degreesOfFreedom).toBeCloseTo(9, 12);
  });
});

describe('Bayesian comparisons', () => {
  it('P(B > A) matches numerical integration of the Beta posteriors', () => {
    expect(probabilityBetaGreater({ alpha: 11, beta: 91 }, { alpha: 16, beta: 86 })).toBeCloseTo(0.8532837898749629, 7);
    expect(probabilityBetaGreater({ alpha: 121, beta: 881 }, { alpha: 151, beta: 851 })).toBeCloseTo(
      0.9750678365579664,
      7,
    );
    expect(probabilityBetaGreater({ alpha: 1, beta: 1 }, { alpha: 2, beta: 1 })).toBeCloseTo(2 / 3, 13);
    expect(probabilityBetaGreater({ alpha: 3, beta: 8 }, { alpha: 3, beta: 8 })).toBeCloseTo(0.5, 12);
    expect(probabilityBetaGreater({ alpha: 2, beta: 30 }, { alpha: 1, beta: 31 })).toBeCloseTo(0.24590163898709344, 7);
  });

  it('P(B > A) is symmetric and stays finite with large counts', () => {
    const a = { alpha: 4001, beta: 96001 };
    const b = { alpha: 4201, beta: 95801 };
    const forward = probabilityBetaGreater(a, b);
    const backward = probabilityBetaGreater(b, a);
    expect(forward + backward).toBeCloseTo(1, 10);
    // Normal approximation is excellent at this size.
    const mean = (x: { alpha: number; beta: number }) => x.alpha / (x.alpha + x.beta);
    const variance = (x: { alpha: number; beta: number }) =>
      (x.alpha * x.beta) / ((x.alpha + x.beta) ** 2 * (x.alpha + x.beta + 1));
    expect(forward).toBeCloseTo(normalCdf((mean(b) - mean(a)) / Math.sqrt(variance(a) + variance(b))), 3);
    // Beyond the closed-form limit it falls back to the normal approximation.
    const huge = probabilityBetaGreater({ alpha: 300001, beta: 700001 }, { alpha: 301001, beta: 699001 });
    expect(huge).toBeGreaterThan(0.9);
    expect(huge).toBeLessThanOrEqual(1);
  });

  it('proportion comparison: exact probability, Beta credible intervals, deterministic lift interval', () => {
    const control = { n: 100, successes: 10 };
    const variant = { n: 100, successes: 15 };
    const result = bayesianProportionComparison(control, variant);
    expect(result.probabilityToBeatControl).toBeCloseTo(0.8532837898749629, 7);
    expect(result.controlInterval[0]).toBeCloseTo(0.055637223780852896, 7);
    expect(result.controlInterval[1]).toBeCloseTo(0.17455282640560066, 7);
    expect(betaCredibleInterval(control)).toEqual(result.controlInterval);
    expect(result.liftInterval).not.toBeNull();
    const [low, high] = result.liftInterval!;
    expect(low).toBeLessThan(0);
    expect(high).toBeGreaterThan(0.5);
    // Seeded: identical inputs give identical intervals.
    expect(bayesianProportionComparison(control, variant).liftInterval).toEqual(result.liftInterval);
  });

  it('Monte Carlo lift interval agrees with the delta method on large samples', () => {
    const control = { n: 20000, successes: 2000 };
    const variant = { n: 20000, successes: 2200 };
    const bayes = bayesianProportionComparison(control, variant).liftInterval!;
    const frequentist = twoProportionZTest(control, variant).liftInterval!;
    expect(bayes[0]).toBeCloseTo(frequentist[0], 2);
    expect(bayes[1]).toBeCloseTo(frequentist[1], 2);
  });

  it('mean comparison uses normal posteriors', () => {
    const control = { n: 400, mean: 10, variance: 25 };
    const variant = { n: 400, mean: 10.5, variance: 36 };
    const result = bayesianMeanComparison(control, variant)!;
    const spread = Math.sqrt(25 / 400 + 36 / 400);
    expect(result.probabilityToBeatControl).toBeCloseTo(normalCdf(0.5 / spread), 14);
    expect(result.controlInterval[0]).toBeCloseTo(10 - 1.9599639845400532 * 0.25, 12);
    expect(result.variantInterval[1]).toBeCloseTo(10.5 + 1.9599639845400532 * 0.3, 12);
    expect(result.liftInterval![0]).toBeLessThan(0.05);
    expect(result.liftInterval![1]).toBeGreaterThan(0.05);
    expect(bayesianMeanComparison({ n: 1, mean: 1, variance: 0 }, variant)).toBeNull();
    expect(bayesianMeanComparison({ n: 10, mean: 0, variance: 1 }, variant)!.liftInterval).toBeNull();
  });
});

describe('sample ratio mismatch', () => {
  it('chi-square p-value against expected shares', () => {
    const fine = sampleRatioMismatch({ control: 5100, test: 4900 }, { control: 0.5, test: 0.5 });
    expect(fine.status).toBe('ok');
    expect(fine.chiSquare).toBeCloseTo(4, 12);
    expect(fine.pValue).toBeCloseTo(0.045500263896358396, 12);
    const broken = sampleRatioMismatch({ control: 5300, test: 4700 }, { control: 0.5, test: 0.5 });
    expect(broken.status).toBe('mismatch');
    expect(broken.pValue).toBeCloseTo(1.973175290075403e-9, 20);
  });

  it('needs enough units, known arms and at least two arms', () => {
    expect(sampleRatioMismatch({ control: 3, test: 4 }, { control: 0.5, test: 0.5 }).status).toBe('insufficient_data');
    expect(sampleRatioMismatch({ control: 60, test: 40, other: 5 }, { control: 0.5, test: 0.5 })).toMatchObject({
      status: 'not_applicable',
      reason: 'unexpected_variant',
    });
    expect(sampleRatioMismatch({ control: 100 }, { control: 1 })).toMatchObject({
      status: 'not_applicable',
      reason: 'single_arm',
    });
  });

  it('expected shares mirror the flag evaluator (rollout, weights, control remainder)', () => {
    expect(expectedVariantShares({ enabled: true, rollout: 100, variants: [], targeted: false }).shares).toEqual({
      test: 1,
    });
    expect(expectedVariantShares({ enabled: true, rollout: 30, variants: [], targeted: false }).shares).toEqual({
      control: 0.7,
      test: 0.3,
    });
    const weighted = expectedVariantShares({
      enabled: true,
      rollout: 50,
      variants: [
        { key: 'a', weight: 30 },
        { key: 'b', weight: 50 },
      ],
      targeted: false,
    }).shares;
    expect(weighted.a).toBeCloseTo(0.15, 14);
    expect(weighted.b).toBeCloseTo(0.25, 14);
    expect(weighted.control).toBeCloseTo(0.6, 14);
    expect(expectedVariantShares({ enabled: false, rollout: 100, variants: [], targeted: false }).shares).toEqual({
      control: 1,
    });

    // Empirical check against the real evaluator so the two cannot silently drift apart.
    const flag = {
      key: 'exp.allocation',
      enabled: true,
      rollout: 80,
      variants: [
        { key: 'control', weight: 40 },
        { key: 'test', weight: 40 },
        { key: 'fancy', weight: 30 },
      ],
    };
    const expected = expectedVariantShares({ ...flag, targeted: false }).shares;
    const counts: Record<string, number> = {};
    const total = 40_000;
    for (let i = 0; i < total; i++) {
      const variant = String(evaluateFeatureFlag(flag, { distinctId: `user-${i}` }).variant);
      counts[variant] = (counts[variant] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected)) {
      expect(Math.abs(counts[key]! / total - expected[key]!)).toBeLessThan(0.015);
    }
  });

  it('with targeting rules, compares the non-control arms with each other', () => {
    const allocation = {
      enabled: true,
      rollout: 100,
      variants: [
        { key: 'a', weight: 50 },
        { key: 'b', weight: 50 },
      ],
      targeted: true,
    };
    const result = checkSampleRatio({ control: 10_000, a: 520, b: 480 }, allocation);
    expect(result.status).toBe('ok');
    expect(result.expectedShares).toEqual({ a: 0.5, b: 0.5 });
    const noVariants = checkSampleRatio({ control: 10, test: 40 }, { ...allocation, variants: [] });
    expect(noVariants).toMatchObject({ status: 'not_applicable', reason: 'targeting_rules' });
  });
});

describe('sample size guidance', () => {
  it('required units per variant for a conversion metric', () => {
    expect(requiredSampleSizeForProportion(0.1, 0.1)).toBe(14751);
    expect(requiredSampleSizeForProportion(0, 0.1)).toBeNull();
    expect(requiredSampleSizeForProportion(0.95, 0.1)).toBeNull();
  });

  it('required units per variant for a mean metric', () => {
    expect(requiredSampleSizeForMean(20, 400, 0.05)).toBe(Math.ceil(6279.103787479265));
    expect(requiredSampleSizeForMean(0, 400, 0.05)).toBeNull();
    expect(requiredSampleSizeForMean(20, 0, 0.05)).toBeNull();
  });

  it('detectable effect with the current sample', () => {
    expect(minimumDetectableEffectForProportion(0.1, 5000)).toBeCloseTo(0.168095113086778, 12);
    expect(minimumDetectableEffectForMean(20, 400, 1000)).toBeCloseTo(0.12529069984918337, 12);
    expect(minimumDetectableEffectForProportion(0.1, 0)).toBeNull();
  });
});
