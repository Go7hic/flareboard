import { describe, expect, it } from 'vitest';
import { buildSegmentSql } from '../../src/lib/segment-filters';

describe('buildSegmentSql', () => {
  it('returns empty fragments for null/empty params', () => {
    expect(buildSegmentSql(null)).toEqual({
      joinSession: false,
      sessionClauses: [],
      eventClauses: [],
      binds: [],
    });
    expect(buildSegmentSql({})).toEqual({
      joinSession: false,
      sessionClauses: [],
      eventClauses: [],
      binds: [],
    });
  });

  it('builds event clauses for path and UTM filters', () => {
    const result = buildSegmentSql({
      path: '/pricing',
      utmSource: 'newsletter',
      pathContains: 'docs',
    });
    expect(result.joinSession).toBe(false);
    expect(result.eventClauses).toEqual([
      'e.url_path = ?',
      'e.utm_source = ?',
      'e.url_path LIKE ?',
    ]);
    expect(result.binds).toEqual(['/pricing', 'newsletter', '%docs%']);
  });

  it('builds session clauses and sets joinSession for geo/device filters', () => {
    const result = buildSegmentSql({
      country: 'US',
      browser: 'Chrome',
      device: 'mobile',
    });
    expect(result.joinSession).toBe(true);
    expect(result.sessionClauses).toEqual(['s.country = ?', 's.browser = ?', 's.device = ?']);
    expect(result.binds).toEqual(['US', 'Chrome', 'mobile']);
  });

  it('skips empty values', () => {
    const result = buildSegmentSql({ country: '', path: '/ok', tag: null });
    expect(result.eventClauses).toEqual(['e.url_path = ?']);
    expect(result.binds).toEqual(['/ok']);
  });
});
