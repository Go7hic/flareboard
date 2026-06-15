import { describe, expect, it } from 'vitest';
import { safeDecodeURI, safeDecodeURIComponent } from '../../src/lib/response';

describe('safeDecodeURIComponent', () => {
  it('decodes valid percent-encoded strings', () => {
    expect(safeDecodeURIComponent('hello%20world')).toBe('hello world');
  });

  it('returns the original value for malformed sequences', () => {
    expect(safeDecodeURIComponent('%E0%A4%A')).toBe('%E0%A4%A');
  });

  it('passes through empty values', () => {
    expect(safeDecodeURIComponent(undefined)).toBeUndefined();
  });
});

describe('safeDecodeURI', () => {
  it('decodes valid URIs', () => {
    expect(safeDecodeURI('/path%20with%20spaces')).toBe('/path with spaces');
  });

  it('returns the original value for malformed URIs', () => {
    expect(safeDecodeURI('%')).toBe('%');
  });
});
