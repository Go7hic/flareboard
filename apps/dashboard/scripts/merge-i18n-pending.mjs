/**
 * Merges work-stream translations from scripts/i18n-pending/<stream>.json
 * ({ "ja-JP": {…}, "de-DE": {…}, "fr-FR": {…} }) into i18n-locale-data.json, deletes the merged
 * files, then run build-i18n-locales.mjs to regenerate src/lib/locales/*.ts.
 * Run: node apps/dashboard/scripts/merge-i18n-pending.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, 'i18n-locale-data.json');
const pendingDir = path.join(__dirname, 'i18n-pending');

/** @type {Record<string, Record<string, string>>} */
const locales = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const files = fs.existsSync(pendingDir) ? fs.readdirSync(pendingDir).filter((f) => f.endsWith('.json')).sort() : [];

for (const file of files) {
  /** @type {Record<string, Record<string, string>>} */
  const pending = JSON.parse(fs.readFileSync(path.join(pendingDir, file), 'utf8'));
  for (const [locale, entries] of Object.entries(pending)) {
    if (!locales[locale]) throw new Error(`${file}: unknown locale ${locale}`);
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value !== 'string') throw new Error(`${file}: ${locale}.${key} is not a string`);
      locales[locale][key] = value;
    }
  }
  const counts = Object.entries(pending).map(([locale, entries]) => `${locale} ${Object.keys(entries).length}`);
  console.log(`${file}: ${counts.join(', ')}`);
}

fs.writeFileSync(dataPath, `${JSON.stringify(locales, null, 2)}\n`);
for (const file of files) fs.unlinkSync(path.join(pendingDir, file));
console.log(`Merged ${files.length} file(s) into ${path.basename(dataPath)}`);
