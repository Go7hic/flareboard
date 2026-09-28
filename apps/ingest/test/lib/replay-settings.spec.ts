import { describe, expect, it } from 'vitest';
import { replaySettings } from '../../src/routes/tracker-config';

describe('replaySettings', () => {
  it('defaults to masking every input and recording every visit', () => {
    expect(replaySettings(null)).toEqual({ sampleRate: 1, maskInputs: true, blockSelector: null });
    expect(replaySettings({})).toEqual({ sampleRate: 1, maskInputs: true, blockSelector: null });
    expect(replaySettings('garbage')).toEqual({ sampleRate: 1, maskInputs: true, blockSelector: null });
  });

  it('only disables masking on an explicit false', () => {
    expect(replaySettings({ maskInputs: false }).maskInputs).toBe(false);
    expect(replaySettings({ maskInputs: 'false' }).maskInputs).toBe(true);
    expect(replaySettings({ maskInputs: 0 }).maskInputs).toBe(true);
  });

  it('clamps the sample rate and ignores non-numbers', () => {
    expect(replaySettings({ sampleRate: 2 }).sampleRate).toBe(1);
    expect(replaySettings({ sampleRate: -1 }).sampleRate).toBe(0);
    expect(replaySettings({ sampleRate: Number.NaN }).sampleRate).toBe(1);
    expect(replaySettings({ sampleRate: '0.5' }).sampleRate).toBe(1);
  });

  it('trims block selectors, caps their length and drops empty values', () => {
    expect(replaySettings({ blockSelectors: '  .a, #b  ' }).blockSelector).toBe('.a, #b');
    expect(replaySettings({ blockSelectors: '   ' }).blockSelector).toBeNull();
    expect(replaySettings({ blockSelectors: 'x'.repeat(5000) }).blockSelector).toHaveLength(1000);
  });
});
