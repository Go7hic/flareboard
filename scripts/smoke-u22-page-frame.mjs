#!/usr/bin/env node
/**
 * U22 Page / PageHeader / PageBody chrome light/dark smoke.
 * Usage: node scripts/smoke-u22-page-frame.mjs [base_url]
 * Requires local dashboard + API (default http://localhost:5173).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT_DIR = join(process.cwd(), '.audit', 'smoke-u22');
const USERNAME = process.env.SMOKE_USERNAME ?? 'admin';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'flareboard';

/** Shared frame selectors every migrated app route must expose. */
const FRAME_SELECTORS = ['.page', '.page-header', '.page-header-row', '.page-title', '.page-body'];

const PATH_CHECKS = [
  {
    id: 'overview',
    label: 'Overview Page+Header+Body',
    path: (id) => `/websites/${id}`,
    pageClass: '.page-stats',
    expectLead: true,
  },
  {
    id: 'realtime',
    label: 'Realtime bleed frame',
    path: (id) => `/websites/${id}/realtime`,
    pageClass: '.page-realtime.page-bleed',
    expectLead: true,
    /** page-bleed compact: header margin 1rem, not default 1.5rem */
    expectHeaderMargin: '16px',
  },
  {
    id: 'sessions',
    label: 'Sessions title+lead+body',
    path: (id) => `/websites/${id}/sessions`,
    pageClass: '.page-sessions',
    expectLead: true,
  },
  {
    id: 'errors',
    label: 'Errors Page+Header+Body',
    path: (id) => `/websites/${id}/errors`,
    pageClass: '.page-errors',
    expectLead: true,
  },
  {
    id: 'logs',
    label: 'Logs Page+Header+Body',
    path: (id) => `/websites/${id}/logs`,
    pageClass: '.page-logs',
    expectLead: true,
  },
  {
    id: 'insights',
    label: 'Insights Page+Header+Body',
    path: () => '/insights',
    pageClass: '.page-insights',
    expectLead: true,
  },
  {
    id: 'funnel',
    label: 'Funnel leftover-migrated frame',
    path: (id) => `/websites/${id}/funnel`,
    pageClass: '.page-funnel',
    expectLead: false,
    expectActions: true,
  },
  {
    id: 'settings',
    label: 'Settings Page+Header+Body',
    path: (id) => `/websites/${id}/settings`,
    pageClass: '.page-settings',
    expectLead: true,
  },
];

async function login(request) {
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: { username: USERNAME, password: PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`Login failed HTTP ${res.status()}`);
  }
}

async function firstWebsiteId(request) {
  const res = await request.get(`${BASE}/api/websites`);
  if (!res.ok()) throw new Error(`Websites failed HTTP ${res.status()}`);
  const sites = await res.json();
  if (!sites?.length) throw new Error('No websites in seed data');
  return sites[0].id;
}

async function measureRhythm(page) {
  return page.evaluate(() => {
    const header = document.querySelector('.page-header');
    const title = document.querySelector('.page-title');
    const lead = document.querySelector('.page-subtitle');
    const row = document.querySelector('.page-header-row');
    const actions = document.querySelector('.page-header-actions');
    if (!header || !title || !row) return null;

    const headerStyle = getComputedStyle(header);
    const titleStyle = getComputedStyle(title);
    const leadStyle = lead ? getComputedStyle(lead) : null;
    const rowStyle = getComputedStyle(row);

    return {
      headerMarginBottom: headerStyle.marginBottom,
      titleFontWeight: titleStyle.fontWeight,
      titleLetterSpacing: titleStyle.letterSpacing,
      leadColor: leadStyle?.color ?? null,
      leadMarginTop: leadStyle?.marginTop ?? null,
      rowDisplay: rowStyle.display,
      rowJustify: rowStyle.justifyContent,
      hasActions: Boolean(actions),
      hasLead: Boolean(lead),
    };
  });
}

async function checkPath(page, check, websiteId, theme) {
  const url = `${BASE}${check.path(websiteId)}`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const themeOnPage = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'),
  );

  const selectors = [
    ...FRAME_SELECTORS,
    check.pageClass,
    ...(check.expectLead ? ['.page-subtitle'] : []),
    ...(check.expectActions ? ['.page-header-actions'] : []),
  ];

  const missing = [];
  for (const selector of selectors) {
    try {
      await page.locator(selector).first().waitFor({ state: 'attached', timeout: 30000 });
    } catch {
      missing.push(selector);
    }
  }

  const expectedMargin = check.expectHeaderMargin ?? '24px';
  const rhythm = await measureRhythm(page);
  const rhythmOk =
    rhythm &&
    rhythm.rowDisplay === 'flex' &&
    rhythm.rowJustify === 'space-between' &&
    rhythm.headerMarginBottom === expectedMargin &&
    (!check.expectLead || rhythm.hasLead) &&
    (!check.expectActions || rhythm.hasActions);

  if (!rhythmOk) missing.push('header-rhythm');

  const shot = join(OUT_DIR, `${check.id}-${theme}.png`);
  await page.screenshot({ path: shot, fullPage: false });

  return {
    id: check.id,
    label: check.label,
    theme,
    url,
    themeOnPage,
    themeOk: themeOnPage === theme,
    missingSelectors: missing,
    rhythm,
    screenshot: shot,
    pass: missing.length === 0 && themeOnPage === theme,
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    const inventory = {
      base: BASE,
      blocked: true,
      error: err instanceof Error ? err.message : String(err),
      note: 'Playwright launch failed; fall back to check-page-frame + code inventory',
    };
    await writeFile(join(OUT_DIR, 'results.json'), `${JSON.stringify(inventory, null, 2)}\n`);
    console.log(JSON.stringify(inventory, null, 2));
    process.exit(2);
  }

  let websiteId;
  try {
    const bootstrap = await browser.newContext();
    await login(bootstrap.request);
    websiteId = await firstWebsiteId(bootstrap.request);
    await bootstrap.close();
  } catch (err) {
    await browser.close();
    const inventory = {
      base: BASE,
      blocked: true,
      error: err instanceof Error ? err.message : String(err),
      note: 'Auth/API blocked; run .audit/check-page-frame.sh for static proof',
    };
    await writeFile(join(OUT_DIR, 'results.json'), `${JSON.stringify(inventory, null, 2)}\n`);
    console.log(JSON.stringify(inventory, null, 2));
    process.exit(2);
  }

  const results = [];
  for (const theme of ['light', 'dark']) {
    const themedContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await themedContext.addInitScript((t) => {
      localStorage.setItem('flareboard-theme', t);
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    await login(themedContext.request);
    const themedPage = await themedContext.newPage();

    for (const check of PATH_CHECKS) {
      try {
        results.push(await checkPath(themedPage, check, websiteId, theme));
      } catch (err) {
        results.push({
          id: check.id,
          label: check.label,
          theme,
          pass: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await themedContext.close();
  }

  await browser.close();

  const rhythms = results.filter((r) => r.rhythm).map((r) => r.rhythm);
  // Title weight + flex title/actions row shared; bleed may tighten header margin.
  const sharedRhythm =
    rhythms.length > 0 &&
    rhythms.every(
      (r) =>
        r.rowDisplay === rhythms[0].rowDisplay &&
        r.rowJustify === rhythms[0].rowJustify &&
        r.titleFontWeight === rhythms[0].titleFontWeight,
    );

  const summary = {
    base: BASE,
    websiteId,
    pathResults: results,
    passCount: results.filter((r) => r.pass).length,
    totalChecks: results.length,
    sharedRhythm,
    allPass: results.every((r) => r.pass) && sharedRhythm,
  };

  await writeFile(join(OUT_DIR, 'results.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
