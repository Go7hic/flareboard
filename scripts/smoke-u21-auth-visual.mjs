#!/usr/bin/env node
/**
 * U21 authenticated core-path light/dark smoke.
 * Usage: node scripts/smoke-u21-auth-visual.mjs [base_url]
 * Requires local dashboard + API (default http://localhost:5173).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT_DIR = join(process.cwd(), '.audit', 'smoke-u21');
const USERNAME = process.env.SMOKE_USERNAME ?? 'admin';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'flareboard';

const PATH_CHECKS = [
  {
    id: 'overview',
    label: 'Overview KPI → chart → dimensions',
    path: (id) => `/websites/${id}`,
    selectors: ['.page-stats-kpis', '.page-stats-chart', '.overview-dimensions'],
  },
  {
    id: 'realtime',
    label: 'Realtime empty/live + session drill',
    path: (id) => `/websites/${id}/realtime`,
    selectors: ['.realtime-widget', '.realtime-empty-panel, .realtime-activity-link, .realtime-breakdown'],
  },
  {
    id: 'sessions',
    label: 'Sessions filter row visible when empty',
    path: (id) => `/websites/${id}/sessions`,
    selectors: ['.page-sessions', '.sessions-filter-row'],
  },
  {
    id: 'compare',
    label: 'Compare shared period model',
    path: (id) => `/websites/${id}/compare`,
    selectors: ['.page-compare', '.compare-panel'],
  },
  {
    id: 'errors',
    label: 'Errors Issues primary (U18)',
    path: (id) => `/websites/${id}/errors`,
    selectors: ['.page-errors-hero', '.page-errors-secondary'],
  },
  {
    id: 'logs',
    label: 'Logs Events primary (U19)',
    path: (id) => `/websites/${id}/logs`,
    selectors: ['.page-logs-hero', '.logs-secondary'],
  },
  {
    id: 'insights',
    label: 'Insights role copy + cross-links (U20)',
    path: () => '/insights',
    selectors: ['.page-insights', '.product-line-cross-links'],
  },
  {
    id: 'boards',
    label: 'Boards role copy + cross-links (U20)',
    path: () => '/boards',
    selectors: ['.page-boards', '.product-line-cross-links'],
  },
  {
    id: 'reports',
    label: 'Reports role copy + cross-links (U20)',
    path: () => '/reports',
    selectors: ['.page-reports', '.product-line-cross-links'],
  },
];

function shellChromeOk(theme) {
  return theme === 'light' || theme === 'dark';
}

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

async function checkPath(page, check, websiteId, theme) {
  const url = `${BASE}${check.path(websiteId)}`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(800);

  const themeOnPage = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'),
  );
  const missing = [];
  for (const selector of check.selectors) {
    try {
      await page.locator(selector).first().waitFor({ state: 'attached', timeout: 30000 });
    } catch {
      missing.push(selector);
    }
  }
  if (check.anyOf?.length && missing.length === 0) {
    let matchedOptional = false;
    for (const selector of check.anyOf) {
      if ((await page.locator(selector).count()) > 0) {
        matchedOptional = true;
        break;
      }
    }
    if (!matchedOptional) missing.push(`anyOf(${check.anyOf.join(', ')})`);
  }

  const shot = join(OUT_DIR, `${check.id}-${theme}.png`);
  await page.screenshot({ path: shot, fullPage: false });

  return {
    id: check.id,
    theme,
    url,
    themeOnPage,
    shellChromeOk: shellChromeOk(themeOnPage),
    missingSelectors: missing,
    pass: missing.length === 0 && shellChromeOk(themeOnPage),
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const bootstrap = await browser.newContext();
  await login(bootstrap.request);
  const websiteId = await firstWebsiteId(bootstrap.request);
  await bootstrap.close();

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
          theme,
          pass: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await themedContext.close();
  }

  await browser.close();

  const loginLight = await (async () => {
    const b = await chromium.launch({ headless: true });
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      localStorage.setItem('flareboard-theme', 'light');
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await p.goto(`${BASE}/login`, { waitUntil: 'load' });
    const hasToggle = (await p.locator('.theme-toggle').count()) > 0;
    const hasCta = (await p.locator('button[type="submit"], .btn-primary, [data-slot="button"]').count()) > 0;
    await p.screenshot({ path: join(OUT_DIR, 'login-light.png') });
    await p.addInitScript(() => {
      localStorage.setItem('flareboard-theme', 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await p.reload({ waitUntil: 'load' });
    const darkTheme = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await p.screenshot({ path: join(OUT_DIR, 'login-dark.png') });
    await b.close();
    return { hasToggle, hasCta, darkTheme, pass: hasToggle && hasCta && darkTheme === 'dark' };
  })();

  const summary = {
    base: BASE,
    websiteId,
    loginLightDark: loginLight,
    pathResults: results,
    passCount: results.filter((r) => r.pass).length,
    totalChecks: results.length,
    allPass: loginLight.pass && results.every((r) => r.pass),
  };

  await writeFile(join(OUT_DIR, 'results.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
