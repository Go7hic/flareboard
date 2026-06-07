/**
 * Merges missing en-US keys into i18n-locale-data.json using locale patches.
 * Run: node apps/dashboard/scripts/fill-missing-i18n.mjs
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
const enUS = Function('return ' + src.slice(start, end).replace('const enUS: Record<string, string> = ', ''))();

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const patches = JSON.parse(fs.readFileSync(patchesPath, 'utf8'));

for (const locale of ['ja-JP', 'de-DE', 'fr-FR']) {
  const map = data[locale];
  const localePatches = patches[locale] ?? {};
  let added = 0;
  for (const key of Object.keys(enUS)) {
    if (key in map) continue;
    if (key in localePatches) {
      map[key] = localePatches[key];
    } else {
      map[key] = enUS[key];
      console.warn(`${locale}: no patch for ${key}, using en-US`);
    }
    added++;
  }
  console.log(`${locale}: added ${added} keys`);
}

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
console.log('Updated', dataPath);
