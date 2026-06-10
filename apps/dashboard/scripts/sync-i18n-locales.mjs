/**
 * Sync ja-JP / de-DE / fr-FR in i18n-locale-data.json from en-US + locale patches.
 * Patches override existing values; missing keys fall back to en-US.
 * Run: node apps/dashboard/scripts/sync-i18n-locales.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nPath = path.join(__dirname, '../src/lib/i18n.ts');
const dataPath = path.join(__dirname, 'i18n-locale-data.json');
const patchesPath = path.join(__dirname, 'i18n-locale-patches.json');

const src = fs.readFileSync(i18nPath, 'utf8');
const start = src.indexOf('const enUS: Record<string, string> = {');
const end = src.indexOf('\n};', start) + 2;
const enUS = Function(
  'return ' + src.slice(start, end).replace('const enUS: Record<string, string> = ', ''),
)();

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const patches = JSON.parse(fs.readFileSync(patchesPath, 'utf8'));

for (const locale of ['ja-JP', 'de-DE', 'fr-FR']) {
  const localePatches = patches[locale] ?? {};
  const prev = data[locale] ?? {};
  const next = {};

  for (const key of Object.keys(enUS)) {
    if (key in localePatches) next[key] = localePatches[key];
    else if (key in prev) next[key] = prev[key];
    else next[key] = enUS[key];
  }

  data[locale] = next;
  console.log(`${locale}: ${Object.keys(next).length} keys synced`);
}

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
console.log('Updated', dataPath);
