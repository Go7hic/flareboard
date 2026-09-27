import { describe, expect, it } from 'vitest';
import { csvCell, csvRow } from './csv';

describe('csvCell', () => {
  it('quotes separators, quotes, and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('neutralizes formula-looking values', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('leaves plain values and numbers alone', () => {
    expect(csvRow(['/pricing', 42, -3, null, undefined])).toBe('/pricing,42,-3,,');
  });
});
