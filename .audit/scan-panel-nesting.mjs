#!/usr/bin/env node
/**
 * Inventory decorative panel nesting smells in dashboard pages (+ key panel wrappers).
 *
 * Problem = decorative nesting, not “any border”:
 *   - EmptyState / DataViewState empty as sole child of .panel
 *   - MasterDetail wrapped in outer .panel when list/pane already bordered
 *   - panel empty-state-rich wrapping EmptyState (solid + dashed)
 *   - panel → EmptyState / dashed empty with little else (triple-frame risk)
 *
 * Heuristics are approximate. Triage lives in panel-nesting-triage.tsv.
 *
 * Usage:
 *   node .audit/scan-panel-nesting.mjs
 *   node .audit/scan-panel-nesting.mjs --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pagesDir = path.join(root, 'apps/dashboard/src/pages');
const componentsDir = path.join(root, 'apps/dashboard/src/components');

/** Thin page files that delegate chrome to these wrappers. */
const EXTRA_WRAPPERS = [
  'GoalsPanel.tsx',
  'SegmentsPanel.tsx',
  'CohortsPanel.tsx',
  'EventDataPanel.tsx',
  'WebsiteBreakdownPanel.tsx',
  'JourneyFlowPanel.tsx',
  'OverviewDimensionCard.tsx',
  'OverviewMapHeatmapPanel.tsx',
];

const SMELL = {
  panel_wraps_master_detail: 'outer .panel wraps MasterDetail*',
  panel_wraps_empty_sole: 'EmptyState is primary/sole child of .panel',
  panel_empty_state_rich: '.panel.empty-state-rich wraps EmptyState (solid+dashed)',
  panel_wraps_dvs: '.panel wraps DataViewState (empty path → dashed-in-solid)',
  empty_after_panel_header_only: '.panel header then EmptyState with little content chrome',
};

function listTsx(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => path.join(dir, name))
    .sort();
}

function rel(file) {
  return path.relative(root, file);
}

/** True only for the `panel` class token — not panel-header, cohorts-panel, etc. */
function hasPanelToken(className) {
  return className.split(/\s+/).filter(Boolean).includes('panel');
}

/**
 * Body of a matched open tag until its balanced close, capped for safety.
 * Avoids adjacent sibling panels bleeding MasterDetail into create/filter chrome.
 */
function extractBalancedBody(src, start, tag) {
  const openRe = new RegExp(`<${tag}\\b`, 'g');
  const closeRe = new RegExp(`</${tag}>`, 'g');
  let depth = 1;
  let i = start;
  const hardCap = Math.min(src.length, start + 12000);
  while (i < hardCap && depth > 0) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const openMatch = openRe.exec(src);
    const closeMatch = closeRe.exec(src);
    const openAt = openMatch && openMatch.index < hardCap ? openMatch.index : -1;
    const closeAt = closeMatch && closeMatch.index < hardCap ? closeMatch.index : -1;
    if (closeAt < 0) break;
    if (openAt >= 0 && openAt < closeAt) {
      depth += 1;
      i = openAt + openMatch[0].length;
      continue;
    }
    depth -= 1;
    i = closeAt + closeMatch[0].length;
    if (depth === 0) {
      return src.slice(start, closeAt);
    }
  }
  return src.slice(start, hardCap);
}

/** Find elements whose className includes the exact `panel` token. */
function findPanelWindows(src) {
  const windows = [];
  const re = /<(section|div|aside|li|article)\b([^>]*\bclassName=(["'])([^"']*)\3[^>]*)>/g;
  let match;
  while ((match = re.exec(src))) {
    const tag = match[1];
    const className = match[4];
    if (!hasPanelToken(className)) continue;
    const start = match.index + match[0].length;
    const body = extractBalancedBody(src, start, tag);
    windows.push({ tag, className, start, body, line: lineOf(src, match.index) });
  }
  return windows;
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

function hasMasterDetail(body) {
  return /MasterDetail(Layout|TableLayout|Pane|ListItem|SidePane|SelectableItem)\b/.test(body);
}

function emptyStateNearStart(body) {
  // EmptyState before another major bordered/layout primitive.
  const idx = body.search(/<EmptyState\b/);
  if (idx < 0) return false;
  const before = body.slice(0, idx);
  // Allow whitespace, skeleton, comments, fragments, and short wrappers.
  const stripped = before
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/<>|<\/>/g, '')
    .replace(/<div\b[^>]*>\s*<\/div>/g, '')
    .replace(/\{[^}]*\?\s*\([^)]*skeleton[^)]*\)[^}]*:\s*null\}/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Sole-ish: only trivial JSX / short conditionals before EmptyState.
  if (stripped.length === 0) return true;
  if (/^(?:\{[^}]{0,120}\}\s*)+$/.test(stripped) && !/MasterDetail|DataViewState|table|chart/i.test(stripped)) {
    return true;
  }
  // panel-header then EmptyState with no table/MD between
  if (
    /panel-header|section-title|cohorts-panel-head/.test(before) &&
    !/MasterDetail|DataViewState|<table\b|className=["'][^"']*table/.test(before)
  ) {
    // If lots of form fields before empty, not "sole"
    const fieldish = (before.match(/\b(field|Input|Label|panel-form|form-row)\b/g) || []).length;
    if (fieldish >= 3) return false;
    return true;
  }
  return false;
}

function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const smells = new Set();
  const hits = [];

  {
    const richRe = /className=(["'])([^"']*)\1/g;
    let richMatch;
    while ((richMatch = richRe.exec(src))) {
      const cn = richMatch[2];
      if (hasPanelToken(cn) && cn.split(/\s+/).includes('empty-state-rich')) {
        smells.add('panel_empty_state_rich');
        hits.push({
          smell: 'panel_empty_state_rich',
          line: lineOf(src, richMatch.index),
          note: 'panel+empty-state-rich',
        });
        break;
      }
    }
  }

  for (const win of findPanelWindows(src)) {
    if (hasMasterDetail(win.body)) {
      smells.add('panel_wraps_master_detail');
      hits.push({
        smell: 'panel_wraps_master_detail',
        line: win.line,
        note: `${win.tag}.${win.className.split(/\s+/).slice(0, 3).join('.')}`,
      });
    }
    if (emptyStateNearStart(win.body)) {
      smells.add('panel_wraps_empty_sole');
      hits.push({
        smell: 'panel_wraps_empty_sole',
        line: win.line,
        note: `${win.tag}.${win.className.split(/\s+/).slice(0, 3).join('.')}`,
      });
    }
    if (/<DataViewState\b/.test(win.body) && !hasMasterDetail(win.body)) {
      // DVS empty renders EmptyState (dashed) inside solid panel.
      smells.add('panel_wraps_dvs');
      hits.push({
        smell: 'panel_wraps_dvs',
        line: win.line,
        note: `${win.tag}.${win.className.split(/\s+/).slice(0, 3).join('.')}`,
      });
    }
    if (
      /panel-header|cohorts-panel-head/.test(win.body) &&
      /<EmptyState\b/.test(win.body) &&
      !hasMasterDetail(win.body) &&
      ((win.body.match(/\b(field|Input|Label|panel-form)\b/g) || []).length < 3)
    ) {
      smells.add('empty_after_panel_header_only');
      hits.push({
        smell: 'empty_after_panel_header_only',
        line: win.line,
        note: `${win.tag}.${win.className.split(/\s+/).slice(0, 3).join('.')}`,
      });
    }
  }

  return {
    file: rel(file),
    smells: [...smells].sort(),
    hits,
    counts: {
      panel: findPanelWindows(src).length,
      emptyState: (src.match(/<EmptyState\b/g) || []).length,
      dataViewState: (src.match(/<DataViewState\b/g) || []).length,
      masterDetail: (src.match(/MasterDetail(Layout|TableLayout|Pane|ListItem|SidePane|SelectableItem)\b/g) || [])
        .length,
    },
  };
}

function main() {
  const asJson = process.argv.includes('--json');
  const files = [
    ...listTsx(pagesDir),
    ...EXTRA_WRAPPERS.map((name) => path.join(componentsDir, name)).filter((f) => fs.existsSync(f)),
  ];

  const results = files.map(scanFile);
  const smelling = results.filter((r) => r.smells.length > 0);

  if (asJson) {
    console.log(JSON.stringify({ smellLegend: SMELL, results }, null, 2));
    return;
  }

  console.log('# panel nesting scan');
  console.log(`# root=${rel(root)} pages=${listTsx(pagesDir).length} wrappers=${EXTRA_WRAPPERS.length}`);
  console.log(`# smelling=${smelling.length} clean=${results.length - smelling.length}`);
  console.log('#');
  console.log(['file', 'smells', 'panel', 'EmptyState', 'DataViewState', 'MasterDetail', 'hit_lines'].join('\t'));

  for (const r of results) {
    const smellStr = r.smells.length ? r.smells.join(',') : '-';
    const hitLines = r.hits.map((h) => `${h.smell}@${h.line}`).join(';') || '-';
    console.log(
      [r.file, smellStr, r.counts.panel, r.counts.emptyState, r.counts.dataViewState, r.counts.masterDetail, hitLines].join(
        '\t',
      ),
    );
  }

  console.log('#');
  console.log('# smell legend:');
  for (const [k, v] of Object.entries(SMELL)) {
    console.log(`#   ${k}: ${v}`);
  }
}

main();
