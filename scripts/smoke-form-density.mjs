#!/usr/bin/env node
/**
 * Create-form density smoke (Errors/Logs alert rules).
 * Usage: node scripts/smoke-form-density.mjs [base_url]
 * Requires local dashboard + API (default http://localhost:5173).
 *
 * Asserts shared CSS levers in global.css:
 *   .field gap (label→control), .panel-form row-gap, header→form,
 *   form→empty sibling margin (not only under .panel >).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT_DIR = join(process.cwd(), '.audit', 'smoke-form-density');
const USERNAME = process.env.SMOKE_USERNAME ?? 'admin';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'flareboard';

/** Minimum gaps in CSS px after the shared density levers. */
const MIN = {
  labelToControl: 10,
  headerToForm: 20,
  lastFieldToActions: 20,
  actionsToEmpty: 20,
  formRowGapPx: 20,
};

async function login(request) {
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: { username: USERNAME, password: PASSWORD },
  });
  if (!res.ok()) throw new Error(`Login failed HTTP ${res.status()}`);
}

async function firstWebsiteId(request) {
  const res = await request.get(`${BASE}/api/websites`);
  if (!res.ok()) throw new Error(`Websites failed HTTP ${res.status()}`);
  const sites = await res.json();
  if (!sites?.length) throw new Error('No websites in seed data');
  return sites[0].id;
}

async function openAlertsTab(page) {
  const tab = page.locator('button, [role="tab"]').filter({ hasText: /告警|Alert/i }).last();
  await tab.click();
  await page.waitForSelector('.panel-form .form-actions', { timeout: 15000 });
  await page.waitForSelector('.empty-state-block', { timeout: 15000 });
}

async function measure(page, scopeSelector) {
  return page.evaluate((scope) => {
    const root = scope ? document.querySelector(scope) : document;
    const form = root?.querySelector('.panel-form');
    if (!form) return { error: 'no .panel-form' };

    const header = form.previousElementSibling?.classList?.contains('panel-header')
      ? form.previousElementSibling
      : form.parentElement?.querySelector(':scope > .panel-header');
    const empty = form.nextElementSibling?.classList?.contains('empty-state-block')
      ? form.nextElementSibling
      : form.parentElement?.querySelector(':scope > .empty-state-block');
    const fields = [...form.querySelectorAll(':scope > .field')];
    const actions = form.querySelector(':scope > .form-actions');
    const label = fields[0]?.querySelector('label, [data-slot="label"], .field-label');
    const control = fields[0]?.querySelector('input, select, [data-slot="input"]');
    const lastField = fields.at(-1);
    const releaseField = fields.find((f) =>
      /版本|release|Version/i.test(f.querySelector('label')?.textContent ?? ''),
    );

    const gap = (a, b) => {
      if (!a || !b) return null;
      return Math.round((b.getBoundingClientRect().top - a.getBoundingClientRect().bottom) * 100) / 100;
    };

    const fr = form.getBoundingClientRect();
    const rr = releaseField?.getBoundingClientRect();
    const rowGap = getComputedStyle(form).rowGap;

    return {
      labelToControl: gap(label, control),
      fieldGap: fields[0] ? getComputedStyle(fields[0]).gap : null,
      headerToForm: gap(header, form),
      lastFieldToActions: gap(lastField, actions),
      actionsToEmpty: gap(actions, empty),
      formToEmpty: gap(form, empty),
      emptyMarginTop: empty ? getComputedStyle(empty).marginTop : null,
      formMarginTop: getComputedStyle(form).marginTop,
      formRowGap: rowGap,
      formRowGapPx: rowGap.endsWith('px') ? Number.parseFloat(rowGap) : null,
      releaseOverflow: rr ? Math.round((rr.right - fr.right) * 100) / 100 : null,
      gridCols: getComputedStyle(form).gridTemplateColumns,
    };
  }, scopeSelector);
}

function assertDensity(label, m) {
  const fails = [];
  if (m.error) fails.push(m.error);
  if (!(m.labelToControl >= MIN.labelToControl)) {
    fails.push(`labelToControl ${m.labelToControl} < ${MIN.labelToControl}`);
  }
  if (!(m.headerToForm >= MIN.headerToForm)) {
    fails.push(`headerToForm ${m.headerToForm} < ${MIN.headerToForm}`);
  }
  if (!(m.lastFieldToActions >= MIN.lastFieldToActions)) {
    fails.push(`lastFieldToActions ${m.lastFieldToActions} < ${MIN.lastFieldToActions}`);
  }
  if (!(m.actionsToEmpty >= MIN.actionsToEmpty)) {
    fails.push(`actionsToEmpty ${m.actionsToEmpty} < ${MIN.actionsToEmpty}`);
  }
  if (!(m.formRowGapPx >= MIN.formRowGapPx)) {
    fails.push(`formRowGapPx ${m.formRowGapPx} < ${MIN.formRowGapPx}`);
  }
  if (m.releaseOverflow != null && m.releaseOverflow > 1) {
    fails.push(`releaseOverflow ${m.releaseOverflow}`);
  }
  if (fails.length) {
    throw new Error(`${label}: ${fails.join('; ')}`);
  }
}

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await context.newPage();
const request = context.request;

await login(request);
const websiteId = await firstWebsiteId(request);

await page.goto(`${BASE}/websites/${websiteId}/errors`, { waitUntil: 'networkidle' });
await openAlertsTab(page);
const errors = await measure(page, '.page-errors-secondary');
await page.screenshot({ path: join(OUT_DIR, 'errors-alerts.png') });

await page.goto(`${BASE}/websites/${websiteId}/logs`, { waitUntil: 'networkidle' });
await openAlertsTab(page);
const logs = await measure(page, null);
await page.screenshot({ path: join(OUT_DIR, 'logs-alerts.png') });

const results = { min: MIN, errors, logs };
await writeFile(join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));

assertDensity('errors alerts', errors);
assertDensity('logs alerts', logs);

console.log(JSON.stringify(results, null, 2));
console.log('PASS form density (errors + logs alert rules)');
await browser.close();
