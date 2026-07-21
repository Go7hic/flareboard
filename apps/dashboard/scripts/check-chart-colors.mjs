#!/usr/bin/env node
/**
 * Lever: prove chart series colors stay off chrome neutrals and stay in sync
 * with legend tokens. Re-run: node apps/dashboard/scripts/check-chart-colors.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const srcRoot = join(root, 'src');
const tokensPath = join(srcRoot, 'styles/geist-tokens.css');
const globalCssPath = join(srcRoot, 'styles/global.css');
const chartColorsPath = join(srcRoot, 'lib/chart-colors.ts');

const REQUIRED_TOKEN_KEYS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--chart-pageviews',
  '--chart-visitors',
  '--chart-visits',
  '--chart-line',
];

const FORBIDDEN_SERIES_VARS = [
  '--text',
  '--text-muted',
  '--accent',
  '--primary',
  '--foreground',
  '--bg',
  '--background',
  '--chart-axis',
  '--geist-gray-1000',
  '--geist-gray-900',
  '--geist-gray-700',
];

const SERIES_ATTR_RE =
  /\b(?:stroke|fill)=\{[^}]*\}|\bstroke:\s*[^;]+|\bfill:\s*[^;]+|background:\s*`[^`]*--|background:\s*['"][^'"]*--|color-mix\([^)]*\)/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  }
}

const tokens = readFileSync(tokensPath, 'utf8');
const themeBlocks = tokens.split(/\[data-theme=/);
assert(themeBlocks.length >= 2, 'expected light and dark theme blocks in geist-tokens.css');

for (const key of REQUIRED_TOKEN_KEYS) {
  const hits = tokens.split(key).length - 1;
  assert(hits >= 2, `${key} must appear in both light and dark themes (found ${hits})`);
}

assert(
  /--chart-pageviews:\s*var\(--chart-1\)/.test(tokens),
  '--chart-pageviews must alias --chart-1',
);
assert(
  /--chart-visitors:\s*var\(--chart-2\)/.test(tokens),
  '--chart-visitors must alias --chart-2',
);
assert(
  /--chart-visits:\s*var\(--chart-3\)/.test(tokens),
  '--chart-visits must alias --chart-3',
);
assert(/--chart-2:\s*var\(--cf-orange\)/.test(tokens), '--chart-2 should be CF orange');
assert(/--chart-line:\s*var\(--chart-1\)/.test(tokens), '--chart-line must alias --chart-1');

const globalCss = readFileSync(globalCssPath, 'utf8');
assert(
  /\.dashboard-aggregate-legend-swatch--pageviews\s*\{[^}]*var\(--chart-pageviews\)/s.test(
    globalCss,
  ),
  'legend pageviews swatch must use --chart-pageviews',
);
assert(
  /\.dashboard-aggregate-legend-swatch--visitors\s*\{[^}]*var\(--chart-visitors\)/s.test(
    globalCss,
  ),
  'legend visitors swatch must use --chart-visitors',
);
assert(
  /\.dashboard-aggregate-legend-swatch--visits\s*\{[^}]*var\(--chart-visits\)/s.test(globalCss),
  'legend visits swatch must use --chart-visits',
);

const chartColorsSrc = readFileSync(chartColorsPath, 'utf8');
assert(
  /pageviews:\s*'--chart-pageviews'/.test(chartColorsSrc),
  'chart-colors.ts pageviews must map to --chart-pageviews',
);
assert(
  /visitors:\s*'--chart-visitors'/.test(chartColorsSrc),
  'chart-colors.ts visitors must map to --chart-visitors',
);

const websiteStats = readFileSync(join(srcRoot, 'pages/WebsiteStats.tsx'), 'utf8');
assert(
  /chartColors\.series\.visitors/.test(websiteStats),
  'WebsiteStats visitors stroke must use chartColors.series.visitors',
);
assert(
  !/--chart-axis/.test(websiteStats),
  'WebsiteStats must not use --chart-axis as a series color',
);

const files = walk(srcRoot);
const allowlist = new Set([
  relative(srcRoot, join(srcRoot, 'lib/chart-colors.ts')),
  relative(srcRoot, join(srcRoot, 'lib/useChartColors.ts')),
  relative(srcRoot, join(srcRoot, 'lib/styles.ts')),
  relative(srcRoot, join(srcRoot, 'styles/geist-tokens.css')),
]);

for (const file of files) {
  const rel = relative(srcRoot, file);
  if (allowlist.has(rel)) continue;
  if (rel === 'styles/global.css' && !rel.includes('chart')) {
    // Still scan global.css for series-ish rules below.
  }
  const text = readFileSync(file, 'utf8');
  const attrs = text.match(SERIES_ATTR_RE) ?? [];
  for (const attr of attrs) {
    for (const bad of FORBIDDEN_SERIES_VARS) {
      // Axis/tick text and chrome borders may use muted/axis; only flag data stroke/fill.
      if (!/\b(?:stroke|fill)=|^\s*(?:stroke|fill):|background:/.test(attr)) continue;
      if (attr.includes('chartColors.muted') || attr.includes('chartColors.border')) continue;
      if (attr.includes('chartColors.text')) continue;
      if (attr.includes(`var(${bad})`) || attr.includes(`'${bad}'`) || attr.includes(`"${bad}"`)) {
        // heat/map chrome using border is fine; accent on buttons is outside SERIES_ATTR if not stroke/fill
        if (bad === '--bg' && attr.includes('--bg-elevated')) continue;
        if (bad === '--bg' && attr.includes('--bg-subtle')) continue;
        if (bad === '--text' && /labelStyle|color:\s*chartColors\.text/.test(attr)) continue;
        assert(false, `${rel}: series color uses forbidden ${bad} in ${attr.slice(0, 120)}`);
      }
    }
  }
}

/** Resolve `var(--x)` chains inside the light theme block to leaf values. */
function lightThemeBlock(css) {
  const m = css.match(/:root,\s*\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/);
  assert(m, 'could not parse light theme block');
  return m[1];
}

function parseDecls(block) {
  const map = new Map();
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*(--[\w-]+):\s*(.+?);\s*$/);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

function resolveVar(map, name, depth = 0) {
  if (depth > 12) return '';
  const raw = map.get(name);
  if (!raw) return '';
  const nested = raw.match(/^var\((--[\w-]+)\)/);
  if (nested) return resolveVar(map, nested[1], depth + 1);
  return raw;
}

const lightMap = parseDecls(lightThemeBlock(tokens));
const resolved = {
  pageviews: resolveVar(lightMap, '--chart-pageviews'),
  visitors: resolveVar(lightMap, '--chart-visitors'),
  visits: resolveVar(lightMap, '--chart-visits'),
  accentChrome: resolveVar(lightMap, '--accent'),
  textChrome: resolveVar(lightMap, '--text'),
};
assert(resolved.pageviews === '#006bff', `pageviews leaf expected #006bff got ${resolved.pageviews}`);
assert(resolved.visitors === '#e85d04', `visitors leaf expected #e85d04 got ${resolved.visitors}`);
assert(resolved.visits === '#28a948', `visits leaf expected #28a948 got ${resolved.visits}`);
assert(
  resolved.pageviews !== resolved.visitors,
  'Overview series colors must differ (legend vs line share tokens)',
);
assert(
  resolved.visitors !== resolved.accentChrome && resolved.visitors !== resolved.textChrome,
  'visitors series must not equal chrome --accent/--text',
);
assert(
  resolved.pageviews !== resolved.accentChrome,
  'pageviews series must not equal chrome --accent',
);

if (process.exitCode) {
  console.error('chart color check failed');
  process.exit(1);
}

console.log('OK: chart series palette + Overview legend/stroke tokens aligned');
console.log(JSON.stringify({ resolved, legendCss: 'uses same --chart-pageviews|visitors|visits' }, null, 2));

