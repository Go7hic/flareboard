import { describe, expect, it } from 'vitest';
import { replaySettings } from '../../src/routes/tracker-config';

const DEFAULTS = {
  sampleRate: 1,
  maskInputs: true,
  maskAllText: false,
  maskSelector: null,
  blockSelector: null,
  console: false,
  network: false,
  minDurationMs: 0,
};

describe('replaySettings', () => {
  it('defaults to masking every input, recording every visit and capturing no console or network', () => {
    expect(replaySettings(null)).toEqual(DEFAULTS);
    expect(replaySettings({})).toEqual(DEFAULTS);
    expect(replaySettings('garbage')).toEqual(DEFAULTS);
  });

  it('only disables masking on an explicit false', () => {
    expect(replaySettings({ maskInputs: false }).maskInputs).toBe(false);
    expect(replaySettings({ maskInputs: 'false' }).maskInputs).toBe(true);
    expect(replaySettings({ maskInputs: 0 }).maskInputs).toBe(true);
  });

  it('only enables text masking and console / network capture on an explicit true', () => {
    expect(replaySettings({ maskAllText: true, captureConsole: true, captureNetwork: true })).toMatchObject({
      maskAllText: true,
      console: true,
      network: true,
    });
    expect(replaySettings({ maskAllText: 'true', captureConsole: 1, captureNetwork: 'yes' })).toMatchObject({
      maskAllText: false,
      console: false,
      network: false,
    });
  });

  it('clamps the sample rate and ignores non-numbers', () => {
    expect(replaySettings({ sampleRate: 2 }).sampleRate).toBe(1);
    expect(replaySettings({ sampleRate: -1 }).sampleRate).toBe(0);
    expect(replaySettings({ sampleRate: Number.NaN }).sampleRate).toBe(1);
    expect(replaySettings({ sampleRate: '0.5' }).sampleRate).toBe(1);
  });

  it('converts the minimum duration to milliseconds and caps it at a minute', () => {
    expect(replaySettings({ minDurationSeconds: 5 }).minDurationMs).toBe(5000);
    expect(replaySettings({ minDurationSeconds: 600 }).minDurationMs).toBe(60_000);
    expect(replaySettings({ minDurationSeconds: -3 }).minDurationMs).toBe(0);
    expect(replaySettings({ minDurationSeconds: '5' }).minDurationMs).toBe(0);
  });

  it('trims block and mask selectors, caps their length and drops empty values', () => {
    expect(replaySettings({ blockSelectors: '  .a, #b  ' }).blockSelector).toBe('.a, #b');
    expect(replaySettings({ blockSelectors: '   ' }).blockSelector).toBeNull();
    expect(replaySettings({ blockSelectors: 'x'.repeat(5000) }).blockSelector).toHaveLength(1000);
    expect(replaySettings({ maskSelectors: ' .pii ' }).maskSelector).toBe('.pii');
    expect(replaySettings({ maskSelectors: 42 }).maskSelector).toBeNull();
  });
});
