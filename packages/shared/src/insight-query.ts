/**
 * Product-analytics query model shared by the API (SQL compiler) and the dashboard (builders).
 *
 * Saved insights store `InsightQuery` (version 2) in `insight.query`. Rows written before v2 hold
 * the legacy flat shape (`{ metric, event, events, unit, ... }`); `parseInsightQuery` upgrades them
 * on read, so no data migration is needed.
 *
 * The date range is intentionally not part of the query: callers (insight page, boards, shares)
 * pass it at run time. Dashboard-wide property filters can be merged with `mergeInsightFilters`.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------------------------
// Property filters
// ---------------------------------------------------------------------------------------------

/** event: custom event property (event_data). person: person property. dimension: built-in column. */
export const PROPERTY_FILTER_TYPES = ['event', 'person', 'dimension'] as const;
export type PropertyFilterType = (typeof PROPERTY_FILTER_TYPES)[number];

export const PROPERTY_OPERATORS = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'regex',
  'not_regex',
  'is_set',
  'is_not_set',
  'gt',
  'lt',
  'between',
] as const;
export type PropertyOperator = (typeof PROPERTY_OPERATORS)[number];

export const NUMERIC_PROPERTY_OPERATORS: readonly PropertyOperator[] = ['gt', 'lt', 'between'];
export const VALUELESS_PROPERTY_OPERATORS: readonly PropertyOperator[] = ['is_set', 'is_not_set'];

/** Built-in event and session columns usable as filters and breakdowns. */
export const INSIGHT_DIMENSIONS = [
  'path',
  'hostname',
  'page_title',
  'referrer',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'event',
  'tag',
  'browser',
  'os',
  'device',
  'screen',
  'country',
  'region',
  'city',
  'language',
] as const;
export type InsightDimension = (typeof INSIGHT_DIMENSIONS)[number];

export const MAX_PROPERTY_FILTERS = 10;
export const MAX_PROPERTY_FILTER_VALUES = 10;
export const MAX_PROPERTY_KEY_LENGTH = 200;
export const MAX_PROPERTY_VALUE_LENGTH = 500;

const scalarValueSchema = z.union([
  z.string().max(MAX_PROPERTY_VALUE_LENGTH),
  z.number().finite(),
  z.boolean(),
]);

export type PropertyFilterValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>
  | null;

export type PropertyFilter = {
  type: PropertyFilterType;
  key: string;
  operator: PropertyOperator;
  value?: PropertyFilterValue;
};

/** Non-empty string values of an `is` / `is_not` filter (numbers and booleans as strings). */
export function propertyFilterValues(filter: PropertyFilter): string[] {
  const raw = Array.isArray(filter.value) ? filter.value : [filter.value];
  const out: string[] = [];
  for (const value of raw) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** The number of a `gt` / `lt` filter. */
export function propertyFilterNumber(filter: PropertyFilter): number | null {
  const raw = Array.isArray(filter.value) ? filter.value[0] : filter.value;
  return toFiniteNumber(raw);
}

/** `[min, max]` of a `between` filter. */
export function propertyFilterRange(filter: PropertyFilter): [number, number] | null {
  if (!Array.isArray(filter.value) || filter.value.length !== 2) return null;
  const min = toFiniteNumber(filter.value[0]);
  const max = toFiniteNumber(filter.value[1]);
  if (min === null || max === null || min > max) return null;
  return [min, max];
}

/** Single text operand of `contains` / `regex` filters. */
export function propertyFilterText(filter: PropertyFilter): string {
  const raw = Array.isArray(filter.value) ? filter.value[0] : filter.value;
  return raw === null || raw === undefined ? '' : String(raw);
}

/** Why a filter cannot run, or null when it is valid. Shared by the API schema and the UI. */
export function propertyFilterProblem(filter: PropertyFilter): string | null {
  if (filter.type === 'dimension' && !(INSIGHT_DIMENSIONS as readonly string[]).includes(filter.key)) {
    return `Unknown dimension "${filter.key}"`;
  }
  switch (filter.operator) {
    case 'is':
    case 'is_not':
      return propertyFilterValues(filter).length ? null : 'Enter at least one value';
    case 'contains':
    case 'not_contains':
      if (Array.isArray(filter.value)) return 'Enter a single value';
      return propertyFilterText(filter).trim() ? null : 'Enter a value';
    case 'regex':
    case 'not_regex': {
      if (Array.isArray(filter.value)) return 'Enter a single pattern';
      const compiled = regexToGlob(propertyFilterText(filter));
      return compiled.ok ? null : compiled.reason;
    }
    case 'gt':
    case 'lt':
      if (filter.type === 'dimension') return 'Numeric comparisons need an event or person property';
      return propertyFilterNumber(filter) === null ? 'Enter a number' : null;
    case 'between':
      if (filter.type === 'dimension') return 'Numeric comparisons need an event or person property';
      return propertyFilterRange(filter) ? null : 'Enter a minimum and a maximum';
    case 'is_set':
    case 'is_not_set':
      return null;
  }
}

export const propertyFilterSchema = z
  .object({
    type: z.enum(PROPERTY_FILTER_TYPES),
    key: z.string().trim().min(1).max(MAX_PROPERTY_KEY_LENGTH),
    operator: z.enum(PROPERTY_OPERATORS),
    value: z
      .union([scalarValueSchema, z.array(scalarValueSchema).max(MAX_PROPERTY_FILTER_VALUES)])
      .nullable()
      .optional(),
  })
  .superRefine((filter, ctx) => {
    const problem = propertyFilterProblem(filter);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ['value'] });
  });

export const propertyFiltersSchema = z.array(propertyFilterSchema).max(MAX_PROPERTY_FILTERS);

// ---------------------------------------------------------------------------------------------
// Regular expressions without REGEXP: D1 / Durable Object SQLite has no regex function, so
// "matches regex" supports the subset that translates exactly to GLOB patterns.
// ---------------------------------------------------------------------------------------------

export type RegexToGlobResult = { ok: true; globs: string[] } | { ok: false; reason: string };

const MAX_REGEX_ALTERNATIVES = 5;
const REGEX_UNSUPPORTED =
  'Supported regex: literals, ^ and $ anchors, ., .*, .+, [classes], \\d \\w \\s and top-level |';

type ClassItem = { from: string; to: string };

function classFromShorthand(letter: string): ClassItem[] | null {
  switch (letter) {
    case 'd':
      return [{ from: '0', to: '9' }];
    case 'w':
      return [
        { from: 'A', to: 'Z' },
        { from: 'a', to: 'z' },
        { from: '0', to: '9' },
        { from: '_', to: '_' },
      ];
    case 's':
      return [' ', '\t', '\n', '\r', '\f', '\v'].map((c) => ({ from: c, to: c }));
    default:
      return null;
  }
}

function escapeLiteral(letter: string): string | null {
  if (letter === 'n') return '\n';
  if (letter === 't') return '\t';
  if (/[A-Za-z0-9]/.test(letter)) return null;
  return letter;
}

/**
 * GLOB character class. GLOB has no escapes inside [...]: `]` is literal only first, `-` is
 * literal when nothing precedes it (or before the closing `]`), `^` only when not first.
 * Ranges that start or end on those characters are rejected.
 */
function globClass(items: ClassItem[], negated: boolean): string | null {
  let hasBracket = false;
  let hasDash = false;
  let hasCaret = false;
  const parts: string[] = [];
  for (const item of items) {
    if (item.from === item.to) {
      if (item.from === ']') hasBracket = true;
      else if (item.from === '-') hasDash = true;
      else if (item.from === '^') hasCaret = true;
      else if (!parts.includes(item.from)) parts.push(item.from);
    } else {
      if ([']', '-', '^'].includes(item.from) || [']', '-', '^'].includes(item.to)) return null;
      parts.push(`${item.from}-${item.to}`);
    }
  }
  const head = `${hasBracket ? ']' : ''}${hasDash ? '-' : ''}${parts.join('')}`;
  // A lone literal ^ needs no class; a leading ^ would negate the class.
  if (!head && hasCaret && !negated) return '^';
  const body = `${head}${hasCaret ? '^' : ''}`;
  if (!body) return null;
  return `[${negated ? '^' : ''}${body}]`;
}

function globLiteral(ch: string): string {
  if (ch === '*' || ch === '?' || ch === '[') return `[${ch}]`;
  return ch;
}

function splitTopLevel(pattern: string): string[] | null {
  const parts: string[] = [];
  let current = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      current += ch + (pattern[i + 1] ?? '');
      i++;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      current += ch;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      current += ch;
      // A ] right after [ or [^ is a literal member.
      if (pattern[i + 1] === '^') {
        current += '^';
        i++;
      }
      if (pattern[i + 1] === ']') {
        current += ']';
        i++;
      }
      continue;
    }
    if (ch === '(' || ch === ')') return null;
    if (ch === '|') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (inClass) return null;
  parts.push(current);
  return parts;
}

function alternativeToGlob(source: string): string | null {
  let pattern = source;
  let anchoredStart = false;
  let anchoredEnd = false;
  if (pattern.startsWith('^')) {
    anchoredStart = true;
    pattern = pattern.slice(1);
  }
  if (pattern.endsWith('$')) {
    let backslashes = 0;
    for (let i = pattern.length - 2; i >= 0 && pattern[i] === '\\'; i--) backslashes++;
    if (backslashes % 2 === 0) {
      anchoredEnd = true;
      pattern = pattern.slice(0, -1);
    }
  }

  // Tokens: literal glob text, "any one char" or "any run".
  const out: string[] = [];
  let lastAtom: 'any' | 'other' | null = null;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next === undefined) return null;
      i++;
      const shorthand = classFromShorthand(next);
      if (shorthand) {
        out.push(globClass(shorthand, false)!);
      } else if (next === 'D' || next === 'W' || next === 'S') {
        out.push(globClass(classFromShorthand(next.toLowerCase())!, true)!);
      } else {
        const literal = escapeLiteral(next);
        if (literal === null) return null;
        out.push(globLiteral(literal));
      }
      lastAtom = 'other';
      continue;
    }
    if (ch === '.') {
      out.push('?');
      lastAtom = 'any';
      continue;
    }
    if (ch === '*' || ch === '+') {
      if (lastAtom !== 'any') return null;
      out.pop();
      out.push(ch === '*' ? '*' : '?*');
      lastAtom = null;
      // Lazy modifier does not change whether a string matches.
      if (pattern[i + 1] === '?') i++;
      continue;
    }
    if (ch === '?' || ch === '{' || ch === '}' || ch === '$' || ch === '^') return null;
    if (ch === '[') {
      let j = i + 1;
      let negated = false;
      if (pattern[j] === '^') {
        negated = true;
        j++;
      }
      const items: ClassItem[] = [];
      let first = true;
      while (j < pattern.length && (pattern[j] !== ']' || first)) {
        let member = pattern[j]!;
        first = false;
        if (member === '\\') {
          const next = pattern[j + 1];
          if (next === undefined) return null;
          j += 2;
          const shorthand = classFromShorthand(next);
          if (shorthand) {
            items.push(...shorthand);
            continue;
          }
          const literal = escapeLiteral(next);
          if (literal === null) return null;
          member = literal;
        } else {
          j++;
        }
        if (pattern[j] === '-' && pattern[j + 1] !== undefined && pattern[j + 1] !== ']') {
          let to = pattern[j + 1]!;
          j += 2;
          if (to === '\\') {
            const next = pattern[j];
            if (next === undefined) return null;
            const literal = escapeLiteral(next);
            if (literal === null) return null;
            to = literal;
            j++;
          }
          if (to < member) return null;
          items.push({ from: member, to });
        } else {
          items.push({ from: member, to: member });
        }
      }
      if (pattern[j] !== ']' || !items.length) return null;
      const cls = globClass(items, negated);
      if (cls === null) return null;
      out.push(cls);
      i = j;
      lastAtom = 'other';
      continue;
    }
    out.push(globLiteral(ch));
    lastAtom = 'other';
  }

  let glob = out.join('');
  if (!anchoredStart) glob = `*${glob}`;
  if (!anchoredEnd) glob = `${glob}*`;
  return glob.replace(/\*{2,}/g, '*');
}

/**
 * Translate a regular expression into equivalent SQLite GLOB patterns (any of them matching
 * means the regex matches). Unsupported syntax (groups, quantifiers on literals, lookarounds,
 * flags) is rejected instead of silently approximated.
 */
export function regexToGlob(pattern: string): RegexToGlobResult {
  if (!pattern) return { ok: false, reason: 'Enter a pattern' };
  if (pattern.length > MAX_PROPERTY_VALUE_LENGTH) return { ok: false, reason: 'Pattern is too long' };
  const alternatives = splitTopLevel(pattern);
  if (!alternatives) return { ok: false, reason: REGEX_UNSUPPORTED };
  if (alternatives.length > MAX_REGEX_ALTERNATIVES) {
    return { ok: false, reason: `At most ${MAX_REGEX_ALTERNATIVES} alternatives` };
  }
  const globs: string[] = [];
  for (const alternative of alternatives) {
    if (!alternative) return { ok: false, reason: REGEX_UNSUPPORTED };
    const glob = alternativeToGlob(alternative);
    if (glob === null) return { ok: false, reason: REGEX_UNSUPPORTED };
    if (!globs.includes(glob)) globs.push(glob);
  }
  return { ok: true, globs };
}

// ---------------------------------------------------------------------------------------------
// Formulas over trend series (A, B, ... E): + - * / parentheses, numbers. No eval.
// ---------------------------------------------------------------------------------------------

export type FormulaNode =
  | { type: 'num'; value: number }
  | { type: 'ref'; index: number }
  | { type: 'neg'; operand: FormulaNode }
  | { type: 'bin'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode };

export type FormulaParseResult = { ok: true; ast: FormulaNode; refs: number[] } | { ok: false; reason: string };

export const MAX_FORMULA_LENGTH = 200;
const MAX_FORMULA_DEPTH = 32;

export function parseFormula(source: string, seriesCount: number): FormulaParseResult {
  const text = source.trim();
  if (!text) return { ok: false, reason: 'Enter a formula' };
  if (text.length > MAX_FORMULA_LENGTH) return { ok: false, reason: 'Formula is too long' };

  type Token = { kind: 'num'; value: number } | { kind: 'ref'; index: number } | { kind: 'op'; op: string };
  const tokens: Token[] = [];
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = /^(\d+(\.\d+)?|\.\d+)/.exec(text.slice(i));
      if (!match) return { ok: false, reason: `Invalid number at position ${i + 1}` };
      tokens.push({ kind: 'num', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      if (/[A-Za-z]/.test(text[i + 1] ?? '')) return { ok: false, reason: 'Series are single letters (A, B, …)' };
      const index = ch.toUpperCase().charCodeAt(0) - 65;
      if (index >= seriesCount) return { ok: false, reason: `Series ${ch.toUpperCase()} does not exist` };
      tokens.push({ kind: 'ref', index });
      i++;
      continue;
    }
    if ('+-*/()'.includes(ch)) {
      tokens.push({ kind: 'op', op: ch });
      i++;
      continue;
    }
    return { ok: false, reason: `Unexpected "${ch}"` };
  }

  let pos = 0;
  const refs = new Set<number>();
  const fail = (reason: string): never => {
    throw new Error(reason);
  };

  function parseExpr(depth: number): FormulaNode {
    if (depth > MAX_FORMULA_DEPTH) fail('Formula is nested too deeply');
    let left = parseTerm(depth);
    for (;;) {
      const token = tokens[pos];
      if (token?.kind === 'op' && (token.op === '+' || token.op === '-')) {
        pos++;
        left = { type: 'bin', op: token.op, left, right: parseTerm(depth) };
      } else return left;
    }
  }

  function parseTerm(depth: number): FormulaNode {
    let left = parseFactor(depth);
    for (;;) {
      const token = tokens[pos];
      if (token?.kind === 'op' && (token.op === '*' || token.op === '/')) {
        pos++;
        left = { type: 'bin', op: token.op, left, right: parseFactor(depth) };
      } else return left;
    }
  }

  function parseFactor(depth: number): FormulaNode {
    const token = tokens[pos];
    if (!token) return fail('Formula ends unexpectedly');
    if (token.kind === 'num') {
      pos++;
      return { type: 'num', value: token.value };
    }
    if (token.kind === 'ref') {
      pos++;
      refs.add(token.index);
      return { type: 'ref', index: token.index };
    }
    if (token.op === '-') {
      pos++;
      return { type: 'neg', operand: parseFactor(depth + 1) };
    }
    if (token.op === '(') {
      pos++;
      const inner = parseExpr(depth + 1);
      if (tokens[pos]?.kind !== 'op' || (tokens[pos] as { op: string }).op !== ')') fail('Missing )');
      pos++;
      return inner;
    }
    return fail(`Unexpected "${token.op}"`);
  }

  try {
    const ast = parseExpr(0);
    if (pos < tokens.length) return { ok: false, reason: 'Unexpected input after the formula' };
    if (!refs.size) return { ok: false, reason: 'Use at least one series (A, B, …)' };
    return { ok: true, ast, refs: [...refs].sort((a, b) => a - b) };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

/** Evaluate a parsed formula. Division by zero and non-finite results yield 0. */
export function evaluateFormula(ast: FormulaNode, values: readonly number[]): number {
  const evaluate = (node: FormulaNode): number => {
    switch (node.type) {
      case 'num':
        return node.value;
      case 'ref':
        return values[node.index] ?? 0;
      case 'neg':
        return -evaluate(node.operand);
      case 'bin': {
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        if (node.op === '+') return left + right;
        if (node.op === '-') return left - right;
        if (node.op === '*') return left * right;
        return right === 0 ? 0 : left / right;
      }
    }
  };
  const result = evaluate(ast);
  return Number.isFinite(result) ? result : 0;
}

// ---------------------------------------------------------------------------------------------
// Insight query (version 2)
// ---------------------------------------------------------------------------------------------

export const INSIGHT_TYPES = ['trend', 'funnel', 'retention', 'lifecycle', 'path', 'stickiness', 'table'] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];

export const INSIGHT_INTERVALS = ['hour', 'day', 'week', 'month'] as const;
export type InsightInterval = (typeof INSIGHT_INTERVALS)[number];

export const INSIGHT_MATHS = [
  'total',
  'unique_users',
  'unique_sessions',
  'sum',
  'avg',
  'min',
  'max',
  'median',
] as const;
export type InsightMath = (typeof INSIGHT_MATHS)[number];
export const PROPERTY_MATHS: readonly InsightMath[] = ['sum', 'avg', 'min', 'max', 'median'];

export const MAX_INSIGHT_SERIES = 5;
export const MAX_FUNNEL_STEPS = 20;
export const MIN_FUNNEL_WINDOW_MS = 60_000;
export const MAX_FUNNEL_WINDOW_MS = 90 * 86_400_000;
export const DEFAULT_RETENTION_PERIODS = 8;
export const MAX_RETENTION_PERIODS = 12;
export const BREAKDOWN_LIMIT = 10;

const URL_MATCHES = ['exact', 'contains', 'regex'] as const;

export const insightEventSchema = z
  .object({
    /** event: custom event (optionally one name). pageview: optionally URL-matched. all: both. */
    kind: z.enum(['event', 'pageview', 'all']).default('event'),
    event: z.string().trim().max(120).nullable().optional(),
    url: z
      .object({ match: z.enum(URL_MATCHES), value: z.string().trim().min(1).max(MAX_PROPERTY_VALUE_LENGTH) })
      .nullable()
      .optional(),
    filters: propertyFiltersSchema.optional(),
    label: z.string().trim().max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.url?.match === 'regex') {
      const compiled = regexToGlob(value.url.value);
      if (!compiled.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: compiled.reason, path: ['url', 'value'] });
    }
  });
export type InsightEvent = z.infer<typeof insightEventSchema>;

export const insightSeriesSchema = z
  .object({
    kind: z.enum(['event', 'pageview', 'all']).default('event'),
    event: z.string().trim().max(120).nullable().optional(),
    url: z
      .object({ match: z.enum(URL_MATCHES), value: z.string().trim().min(1).max(MAX_PROPERTY_VALUE_LENGTH) })
      .nullable()
      .optional(),
    filters: propertyFiltersSchema.optional(),
    label: z.string().trim().max(120).optional(),
    math: z.enum(INSIGHT_MATHS).default('total'),
    /** Numeric event property for sum / avg / min / max / median. */
    mathProperty: z.string().trim().max(MAX_PROPERTY_KEY_LENGTH).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.url?.match === 'regex') {
      const compiled = regexToGlob(value.url.value);
      if (!compiled.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: compiled.reason, path: ['url', 'value'] });
    }
    if (PROPERTY_MATHS.includes(value.math) && !value.mathProperty) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose a numeric property', path: ['mathProperty'] });
    }
  });
export type InsightSeries = z.infer<typeof insightSeriesSchema>;

export const insightBreakdownSchema = z
  .object({
    type: z.enum(PROPERTY_FILTER_TYPES),
    key: z.string().trim().min(1).max(MAX_PROPERTY_KEY_LENGTH),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'dimension' && !(INSIGHT_DIMENSIONS as readonly string[]).includes(value.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown dimension "${value.key}"`, path: ['key'] });
    }
  });
export type InsightBreakdown = z.infer<typeof insightBreakdownSchema>;

export const FUNNEL_WINDOW_UNITS = ['minute', 'hour', 'day', 'week'] as const;
export type FunnelWindowUnit = (typeof FUNNEL_WINDOW_UNITS)[number];
const FUNNEL_UNIT_MS: Record<FunnelWindowUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
};

export function funnelWindowMs(window: { value: number; unit: FunnelWindowUnit } | undefined | null): number {
  if (!window) return 14 * 86_400_000;
  return window.value * FUNNEL_UNIT_MS[window.unit];
}

const funnelWindowSchema = z
  .object({ value: z.number().int().min(1).max(10_000), unit: z.enum(FUNNEL_WINDOW_UNITS) })
  .superRefine((value, ctx) => {
    const ms = funnelWindowMs(value);
    if (ms < MIN_FUNNEL_WINDOW_MS || ms > MAX_FUNNEL_WINDOW_MS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Conversion window must be 1 minute to 90 days' });
    }
  });

export const insightQueryV2Schema = z.object({
  version: z.literal(2),
  /** Trend series (A…E). Lifecycle and stickiness use the first series. */
  series: z.array(insightSeriesSchema).max(MAX_INSIGHT_SERIES).optional(),
  /** Trend formula over series letters, e.g. `A / B * 100`. */
  formula: z.string().trim().max(MAX_FORMULA_LENGTH).nullable().optional(),
  interval: z.enum(INSIGHT_INTERVALS).optional(),
  /** Trends: also return the previous period of the same length. */
  compare: z.boolean().optional(),
  breakdown: insightBreakdownSchema.nullable().optional(),
  /** Global filters, AND-ed and applied to every series / step / event of the insight. */
  filters: propertyFiltersSchema.optional(),
  /** Counting unit of funnels, retention, lifecycle and stickiness. person = distinct id, else session. */
  countBy: z.enum(['person', 'session']).optional(),
  funnel: z
    .object({
      steps: z.array(insightEventSchema).max(MAX_FUNNEL_STEPS).default([]),
      window: funnelWindowSchema.optional(),
      /** strict: steps must happen in the listed order. any: in any order. */
      order: z.enum(['strict', 'any']).optional(),
    })
    .optional(),
  retention: z
    .object({
      startEvent: insightEventSchema.optional(),
      returnEvent: insightEventSchema.optional(),
      period: z.enum(['day', 'week', 'month']).optional(),
      periods: z.number().int().min(2).max(MAX_RETENTION_PERIODS).optional(),
    })
    .optional(),
  path: z
    .object({
      steps: z.array(z.string().trim().min(1).max(500)).max(8).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
  table: z
    .object({
      dimension: z
        .enum(['path', 'url', 'referrer', 'channel', 'browser', 'os', 'device', 'country', 'region', 'city', 'language', 'event'])
        .optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
});
export type InsightQuery = z.infer<typeof insightQueryV2Schema>;

/** Query shape saved before v2. Still accepted on write and upgraded on read. */
export const legacyInsightQuerySchema = z.object({
  event: z.string().max(120).optional().nullable(),
  events: z.array(z.string().min(1).max(120)).max(8).optional(),
  path: z.string().max(500).optional().nullable(),
  steps: z.array(z.string().min(1).max(500)).max(8).optional(),
  metric: z.enum(['pageviews', 'visitors', 'visits', 'events']).optional().default('pageviews'),
  dimension: z
    .enum(['path', 'url', 'referrer', 'channel', 'browser', 'os', 'device', 'country', 'region', 'city', 'language', 'event'])
    .optional()
    .default('path'),
  actor: z.enum(['person', 'session']).optional().default('person'),
  unit: z.enum(['hour', 'day', 'week', 'month']).optional().default('day'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
});
export type LegacyInsightQuery = z.infer<typeof legacyInsightQuerySchema>;

function isV2(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { version?: unknown }).version === 2);
}

function upgradeLegacy(type: InsightType, legacy: LegacyInsightQuery): InsightQuery {
  const interval = legacy.unit;
  if (type === 'trend') {
    if (legacy.metric === 'events' || legacy.event) {
      const event = legacy.event || legacy.events?.[0] || null;
      return { version: 2, interval, series: [{ kind: 'event', event, math: 'total' }] };
    }
    if (legacy.metric === 'visitors') {
      return { version: 2, interval, series: [{ kind: 'pageview', math: 'unique_sessions' }] };
    }
    return { version: 2, interval, series: [{ kind: 'pageview', math: 'total' }] };
  }
  if (type === 'funnel') {
    // v1 funnels counted sessions with no conversion window; keep their numbers stable.
    return {
      version: 2,
      countBy: 'session',
      funnel: {
        steps: (legacy.events ?? []).filter(Boolean).map((event) => ({ kind: 'event' as const, event })),
        window: { value: 90, unit: 'day' },
        order: 'strict',
      },
    };
  }
  if (type === 'retention') {
    return {
      version: 2,
      countBy: 'session',
      retention: {
        startEvent: { kind: 'pageview' },
        returnEvent: { kind: 'pageview' },
        period: 'week',
        periods: 9,
      },
    };
  }
  if (type === 'path') {
    const steps = (legacy.steps?.length ? legacy.steps : legacy.path ? [legacy.path] : []).filter(Boolean);
    return { version: 2, path: { steps, limit: legacy.limit ?? 20 } };
  }
  if (type === 'stickiness') {
    const event = legacy.event ?? legacy.events?.[0] ?? null;
    return {
      version: 2,
      countBy: legacy.actor,
      series: [event ? { kind: 'event', event, math: 'total' } : { kind: 'all', math: 'total' }],
    };
  }
  if (type === 'lifecycle') {
    return { version: 2, interval, series: [{ kind: 'pageview', math: 'total' }] };
  }
  const dimension = legacy.dimension ?? (legacy.metric === 'events' ? 'event' : 'path');
  return { version: 2, table: { dimension, limit: legacy.limit } };
}

export type InsightQueryParseResult = { ok: true; query: InsightQuery } | { ok: false; error: string };

function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid insight query';
  const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
  return `${path}${issue.message}`;
}

/** Validate a stored or submitted query (v2 or legacy) and return it as v2. */
export function parseInsightQuery(type: InsightType, raw: unknown): InsightQueryParseResult {
  if (isV2(raw)) {
    const parsed = insightQueryV2Schema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: zodMessage(parsed.error) };
    return checkInsightQuery(type, parsed.data);
  }
  const legacy = legacyInsightQuerySchema.safeParse(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
  if (!legacy.success) return { ok: false, error: zodMessage(legacy.error) };
  return { ok: true, query: upgradeLegacy(type, legacy.data) };
}

/** Rules that depend on the insight type (formula letters, required steps, ...). */
function checkInsightQuery(type: InsightType, query: InsightQuery): InsightQueryParseResult {
  if (type === 'trend' && query.formula?.trim()) {
    const formula = parseFormula(query.formula, Math.max(query.series?.length ?? 0, 1));
    if (!formula.ok) return { ok: false, error: `formula: ${formula.reason}` };
  }
  return { ok: true, query };
}

/** Wire format accepted by the create / update / preview endpoints. */
export const insightQuerySchema = z.unknown().superRefine((raw, ctx) => {
  const schema = isV2(raw) ? insightQueryV2Schema : legacyInsightQuerySchema;
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    for (const issue of parsed.error.issues) ctx.addIssue({ ...issue });
  }
});

/** Append dashboard-wide filters to an insight's own global filters. */
export function mergeInsightFilters(query: InsightQuery, filters: readonly PropertyFilter[] | null | undefined): InsightQuery {
  if (!filters?.length) return query;
  return { ...query, filters: [...(query.filters ?? []), ...filters] };
}

/**
 * Legacy segment parameters (`{ country: 'US', pathContains: '/docs', properties: [...] }`) as
 * v2 property filters, so saved segments apply to insights.
 */
export function segmentParamsToFilters(params: Record<string, unknown> | null | undefined): PropertyFilter[] {
  if (!params) return [];
  const filters: PropertyFilter[] = [];
  const equals = (key: InsightDimension, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    filters.push({ type: 'dimension', key, operator: 'is', value: [String(value)] });
  };
  for (const [key, value] of Object.entries(params)) {
    if (key === 'properties') continue;
    if (key === 'pathContains') {
      if (value !== undefined && value !== null && value !== '') {
        filters.push({ type: 'dimension', key: 'path', operator: 'contains', value: String(value) });
      }
      continue;
    }
    if (key === 'path' || key === 'url') equals('path', value);
    else if (key === 'utmSource' || key === 'utm_source') equals('utm_source', value);
    else if (key === 'utmMedium' || key === 'utm_medium') equals('utm_medium', value);
    else if (key === 'utmCampaign' || key === 'utm_campaign') equals('utm_campaign', value);
    else if (key === 'event' || key === 'eventName') equals('event', value);
    else if (key === 'referrer') equals('referrer', value);
    else if (key === 'hostname' || key === 'tag') equals(key, value);
    else if (['country', 'browser', 'os', 'device', 'language', 'city', 'region'].includes(key)) {
      equals(key as InsightDimension, value);
    }
  }
  const properties = propertyFiltersSchema.safeParse(params.properties ?? []);
  if (properties.success) filters.push(...properties.data);
  return filters;
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

export type TrendResultSeries = {
  /** Series letter (A…E) or `formula`. */
  key: string;
  seriesIndex: number | null;
  label: string;
  math: InsightMath | null;
  /** Breakdown value; null = property not set. Absent without a breakdown. */
  breakdownValue?: string | null;
  isOther?: boolean;
  data: number[];
  /** Aggregate over the whole range (distinct units for unique maths). */
  total: number;
};

export type TrendResult = {
  kind: 'trend';
  interval: InsightInterval;
  labels: string[];
  results: TrendResultSeries[];
  formula: string | null;
  compare: { startAt: number; endAt: number; labels: string[]; results: TrendResultSeries[] } | null;
  /** First result as `{ x, y }` points, for clients built before v2. */
  series: Array<{ x: string; y: number }>;
  startAt: number;
  endAt: number;
};

export type FunnelStepResult = {
  index: number;
  label: string;
  count: number;
  /** Percent of the previous step (100 for the first step). */
  rate: number;
  /** Percent of the first step. */
  conversionRate: number;
  droppedOff: number;
  avgTimeToConvertMs: number | null;
  medianTimeToConvertMs: number | null;
  /** Legacy alias of `label`. */
  step: string;
};

export type FunnelResult = {
  kind: 'funnel';
  order: 'strict' | 'any';
  countBy: 'person' | 'session';
  windowMs: number;
  steps: FunnelStepResult[];
  /** Overall conversion percent (last / first). */
  conversion: number;
  breakdown: Array<{ value: string | null; isOther: boolean; steps: FunnelStepResult[]; conversion: number }> | null;
  startAt: number;
  endAt: number;
};

export type RetentionCohort = { cohort: string; size: number; values: number[] };

export type RetentionResult = {
  kind: 'retention';
  period: 'day' | 'week' | 'month';
  periods: number;
  countBy: 'person' | 'session';
  cohorts: RetentionCohort[];
  startAt: number;
  endAt: number;
};

export type LifecycleResult = {
  kind: 'lifecycle';
  interval: InsightInterval;
  labels: string[];
  new: number[];
  returning: number[];
  resurrecting: number[];
  /** Negative counts (people active in the previous interval but not this one). */
  dormant: number[];
  startAt: number;
  endAt: number;
};

export type StickinessResult = {
  kind: 'stickiness';
  event: string | null;
  actor: 'person' | 'session';
  totalActors: number;
  actorDays: number;
  averageActiveDays: number;
  distribution: Array<{ activeDays: number; actors: number; events: number; percentage: number }>;
  startAt: number;
  endAt: number;
};

export type PathResult = {
  kind: 'path';
  prefix: string[];
  depth: number;
  total: number;
  next: Array<{ path: string; count: number }>;
  paths: Array<{ path: string; count: number }>;
  startAt: number;
  endAt: number;
  limit: number;
};

export type TableResult = {
  kind: 'table';
  dimension: string;
  rows: Array<{ x: string; y: number }>;
  startAt: number;
  endAt: number;
};

export type InsightResult =
  | TrendResult
  | FunnelResult
  | RetentionResult
  | LifecycleResult
  | StickinessResult
  | PathResult
  | TableResult;

export type FunnelActorsResult = {
  step: number;
  outcome: 'converted' | 'dropped';
  countBy: 'person' | 'session';
  total: number;
  actors: string[];
};
