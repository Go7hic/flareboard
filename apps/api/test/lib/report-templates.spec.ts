import { describe, expect, it } from 'vitest';
import { REPORT_TEMPLATES, readReportParams, summarizeReport } from '../../src/lib/report-templates';

describe('report templates', () => {
  it('exposes templates for saved product analytics reports', () => {
    expect(REPORT_TEMPLATES.map((template) => template.type)).toEqual(
      expect.arrayContaining([
        'funnel',
        'retention',
        'journey',
        'attribution',
        'breakdown',
        'performance',
        'utm',
        'revenue',
        'goals',
        'cohorts',
      ]),
    );
    for (const template of REPORT_TEMPLATES) {
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.defaultParameters).toEqual(expect.any(Object));
    }
  });

  it('summarizes saved report parameters for the dashboard list', () => {
    expect(
      summarizeReport('funnel', {
        steps: ['signup', 'checkout_completed'],
        segmentId: 'segment-1',
      }),
    ).toEqual([
      { label: 'Steps', value: 'signup -> checkout_completed' },
      { label: 'Segment', value: 'segment-1' },
    ]);

    expect(
      summarizeReport('attribution', {
        model: 'first',
        attributionType: 'event',
        step: 'purchase',
      }),
    ).toEqual([
      { label: 'Model', value: 'first' },
      { label: 'Type', value: 'event' },
      { label: 'Step', value: 'purchase' },
    ]);
  });

  it('ignores malformed report parameters safely', () => {
    expect(readReportParams(null)).toEqual({});
    expect(readReportParams(['not', 'an', 'object'])).toEqual({});
    expect(summarizeReport('funnel', { steps: ['signup', 1, null] })).toEqual([
      { label: 'Steps', value: 'signup' },
    ]);
  });
});
