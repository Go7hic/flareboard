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

  it('binds event-clause values before session-clause values', () => {
    // Callers place event clauses first; binds used to follow key order instead.
    const result = buildSegmentSql({ country: 'US', path: '/pricing' });
    expect([...result.eventClauses, ...result.sessionClauses]).toEqual(['e.url_path = ?', 's.country = ?']);
    expect(result.binds).toEqual(['/pricing', 'US']);
  });

  it('compiles `properties` into positional clauses and joins the session for person filters', () => {
    const result = buildSegmentSql({
      country: 'US',
      properties: [
        { type: 'event', key: 'plan', operator: 'is', value: ['pro'] },
        { type: 'person', key: 'email', operator: 'is_set' },
      ],
    });
    expect(result.joinSession).toBe(true);
    expect(result.eventClauses).toHaveLength(1);
    expect(result.eventClauses[0]).toContain('EXISTS (SELECT 1 FROM event_data d');
    expect(result.eventClauses[0]!.match(/\?/g)).toHaveLength(3);
    expect(result.binds).toEqual(['plan', 'pro', 'email', 'US']);
  });

  it('ignores invalid property filters', () => {
    const result = buildSegmentSql({ properties: [{ type: 'event', key: 'x', operator: 'gt', value: 'many' }] });
    expect(result.eventClauses).toEqual([]);
  });

  it('skips empty values', () => {
    const result = buildSegmentSql({ country: '', path: '/ok', tag: null });
    expect(result.eventClauses).toEqual(['e.url_path = ?']);
    expect(result.binds).toEqual(['/ok']);
  });
});
