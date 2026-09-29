import { describe, expect, it } from 'vitest';
import { parseInline, parseNotebookMarkdown, safeHref } from './notebook-markdown';

describe('notebook markdown', () => {
  it('parses headings, lists, quotes, code and paragraphs', () => {
    const blocks = parseNotebookMarkdown('# Title\n\nSome **bold** and *em* `x`\n- a\n- b\n1. one\n> quoted\n```\n<b>raw</b>\n```\n---');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote', 'code', 'hr']);
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', text: 'Some ' },
        { type: 'strong', children: [{ type: 'text', text: 'bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'em', children: [{ type: 'text', text: 'em' }] },
        { type: 'text', text: ' ' },
        { type: 'code', text: 'x' },
      ],
    });
    expect(blocks[5]).toEqual({ type: 'code', text: '<b>raw</b>' });
  });

  it('keeps HTML as literal text', () => {
    expect(parseNotebookMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '<script>alert(1)</script><img src=x onerror=alert(1)>' }] },
    ]);
  });

  it('only links safe URLs', () => {
    expect(parseInline('[docs](https://example.com/a)')).toEqual([
      { type: 'link', href: 'https://example.com/a', children: [{ type: 'text', text: 'docs' }] },
    ]);
    expect(parseInline('[x](javascript:alert(1))')[0]).toMatchObject({ type: 'text' });
    expect(parseInline('[x](data:text/html,hi)')).toEqual([{ type: 'text', text: 'x' }]);
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('/websites/1/sessions/2')).toBe('/websites/1/sessions/2');
    expect(safeHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(safeHref(' JAVASCRIPT:alert(1)')).toBeNull();
  });
});
