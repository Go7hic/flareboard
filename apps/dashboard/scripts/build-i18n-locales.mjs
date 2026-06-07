/**
 * Builds full ja-JP / de-DE / fr-FR locale maps from en-US keys.
 * Run: node apps/dashboard/scripts/build-i18n-locales.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nPath = path.join(__dirname, '../src/lib/i18n.ts');
const src = fs.readFileSync(i18nPath, 'utf8');
const enMatch = src.match(/const enUS: Record<string, string> = \{([\s\S]*?)\};/);
if (!enMatch) throw new Error('enUS block not found');
const enKeys = [...enMatch[1].matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);

/** @type {Record<string, Record<string, string>>} */
const locales = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'i18n-locale-data.json'), 'utf8'),
);

for (const [locale, map] of Object.entries(locales)) {
  const missing = enKeys.filter((k) => !(k in map));
  if (missing.length) {
    console.error(`${locale} missing ${missing.length} keys:`, missing.slice(0, 10).join(', '));
    process.exit(1);
  }
  const extra = Object.keys(map).filter((k) => !enKeys.includes(k));
  if (extra.length) {
    console.warn(`${locale} extra keys:`, extra.join(', '));
  }
  const varName = locale.replace('-', '').replace('JP', 'JP').replace('DE', 'DE').replace('FR', 'FR');
  const exportName =
    locale === 'ja-JP' ? 'jaJPLocale' : locale === 'de-DE' ? 'deDELocale' : 'frFRLocale';
  const lines = enKeys.map((k) => `  ${k}: ${JSON.stringify(map[k])},`);
  const out = `/** Auto-generated — do not edit by hand. Run build-i18n-locales.mjs */\nexport const ${exportName}: Record<string, string> = {\n${lines.join('\n')}\n};\n`;
  const outFile = path.join(__dirname, `../src/lib/locales/${locale}.ts`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);
  console.log(`Wrote ${outFile} (${enKeys.length} keys)`);
}
