/**
 * A small Markdown subset for notebook text blocks, parsed into a tree that React renders as
 * elements. Nothing is ever passed to innerHTML: HTML in the source stays literal text, and
 * links are kept only for http(s), mailto and same-origin paths.
 *
 * Blocks: `#`–`###` headings, paragraphs, `-` / `*` and `1.` lists, `>` quotes, ``` fences, `---`.
 * Inline: `**bold**`, `*italic*` / `_italic_`, `` `code` ``, `[text](url)`.
 */

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: MdInline[] };

export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: MdInline[] }
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'list'; ordered: boolean; items: MdInline[][] }
  | { type: 'quote'; children: MdInline[] }
  | { type: 'code'; text: string }
  | { type: 'hr' };

/** A link target that is safe to put in href, or null. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\')) return href;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function pushText(out: MdInline[], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === 'text') last.text += text;
  else out.push({ type: 'text', text });
}

export function parseInline(source: string, depth = 0): MdInline[] {
  const out: MdInline[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    if (rest.startsWith('`')) {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        out.push({ type: 'code', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (depth < 4 && rest.startsWith('**')) {
      const end = source.indexOf('**', i + 2);
      if (end > i + 2) {
        out.push({ type: 'strong', children: parseInline(source.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }
    if (depth < 4 && (rest[0] === '*' || rest[0] === '_') && rest[1] && rest[1] !== ' ' && rest[1] !== rest[0]) {
      const end = source.indexOf(rest[0], i + 1);
      if (end > i + 1 && source[end - 1] !== ' ') {
        out.push({ type: 'em', children: parseInline(source.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }
    if (depth < 4 && rest[0] === '[') {
      const match = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest);
      if (match) {
        const href = safeHref(match[2]!);
        if (href) out.push({ type: 'link', href, children: parseInline(match[1]!, depth + 1) });
        else pushText(out, match[1]!);
        i += match[0].length;
        continue;
      }
    }
    pushText(out, source[i]!);
    i++;
  }
  return out;
}

export function parseNotebookMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line.trim())) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!.trim())) body.push(lines[i++]!);
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3, children: parseInline(heading[2]!.trim()) });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      blocks.push({ type: 'hr' });
      continue;
    }
    const bullet = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      const ordered = /\d/.test(bullet[1]!);
      const items: MdInline[][] = [parseInline(bullet[2]!)];
      while (i + 1 < lines.length) {
        const next = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(lines[i + 1]!);
        if (!next || /\d/.test(next[1]!) !== ordered) break;
        items.push(parseInline(next[2]!));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      const body = [quote[1]!];
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1]!)) body.push(lines[++i]!.replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', children: parseInline(body.join('\n')) });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}
