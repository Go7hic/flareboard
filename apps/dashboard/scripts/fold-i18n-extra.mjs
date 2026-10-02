/**
 * Folds the console v2 string modules (src/lib/i18n-extra/<area>.ts) back into the regular
 * i18n pipeline, then empties them:
 *   - en-US / zh-CN → the `enUS` / `zhCN` objects in src/lib/i18n.ts (existing keys are replaced
 *     in place, new keys appended before the closing brace);
 *   - ja-JP / de-DE / fr-FR → scripts/i18n-locale-data.json, then run build-i18n-locales.mjs.
 * Uses the TypeScript compiler to read the modules and locate properties, so multi-line
 * entries and quoted keys are handled.
 *
 * Run: node apps/dashboard/scripts/fold-i18n-extra.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '..', 'src');
const extraDir = path.join(src, 'lib', 'i18n-extra');
const i18nPath = path.join(src, 'lib', 'i18n.ts');
const dataPath = path.join(__dirname, 'i18n-locale-data.json');
const LOCALES = ['en-US', 'zh-CN', 'ja-JP', 'de-DE', 'fr-FR'];
const SKIP = new Set(['index.ts', 'types.ts']);

function propName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  throw new Error(`Unsupported property name: ${node.getText()}`);
}

function stringValue(node, file) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  throw new Error(`${file}: only string literals are supported, got ${node.getText()}`);
}

/** Reads `export const xMessages: ExtraMessages = { 'en-US': {…}, … }` from one module. */
function readExtra(file) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out = Object.fromEntries(LOCALES.map((l) => [l, {}]));
  sf.forEachChild((stmt) => {
    if (!ts.isVariableStatement(stmt)) return;
    for (const decl of stmt.declarationList.declarations) {
      if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) continue;
      for (const localeProp of decl.initializer.properties) {
        if (!ts.isPropertyAssignment(localeProp)) continue;
        const locale = propName(localeProp.name);
        if (!out[locale]) throw new Error(`${file}: unknown locale ${locale}`);
        if (!ts.isObjectLiteralExpression(localeProp.initializer)) continue;
        for (const entry of localeProp.initializer.properties) {
          if (!ts.isPropertyAssignment(entry)) continue;
          out[locale][propName(entry.name)] = stringValue(entry.initializer, file);
        }
      }
    }
  });
  return out;
}

function tsString(value) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function tsKey(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : tsString(key);
}

/** Applies `entries` to the object literal assigned to `const <name>` in i18n.ts. */
function foldIntoObject(text, varName, entries) {
  const sf = ts.createSourceFile(i18nPath, text, ts.ScriptTarget.Latest, true);
  let literal = null;
  sf.forEachChild((stmt) => {
    if (!ts.isVariableStatement(stmt)) return;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === varName && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
        literal = decl.initializer;
      }
    }
  });
  if (!literal) throw new Error(`i18n.ts: object ${varName} not found`);
  const existing = new Map();
  for (const prop of literal.properties) {
    if (ts.isPropertyAssignment(prop)) existing.set(propName(prop.name), prop);
  }
  const edits = [];
  const appended = [];
  const replacedKeys = [];
  for (const [key, value] of Object.entries(entries)) {
    const prop = existing.get(key);
    if (prop) {
      replacedKeys.push(key);
      edits.push({ start: prop.initializer.getStart(sf), end: prop.initializer.getEnd(), text: tsString(value) });
    } else {
      appended.push(`  ${tsKey(key)}: ${tsString(value)},`);
    }
  }
  if (appended.length) {
    const closing = literal.getEnd() - 1; // the `}`
    const lastProp = literal.properties[literal.properties.length - 1];
    const needsComma = lastProp && !text.slice(lastProp.getEnd(), closing).includes(',');
    edits.push({ start: closing, end: closing, text: `${needsComma ? ',' : ''}\n${appended.join('\n')}\n` });
  }
  edits.sort((a, b) => b.start - a.start);
  let next = text;
  for (const edit of edits) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  if (replacedKeys.length) console.warn(`${varName}: replaced existing keys (check they mean the same everywhere): ${replacedKeys.join(', ')}`);
  return { text: next, replaced: replacedKeys.length, added: appended.length };
}

const files = fs.readdirSync(extraDir).filter((f) => f.endsWith('.ts') && !SKIP.has(f)).sort();
const merged = Object.fromEntries(LOCALES.map((l) => [l, {}]));
for (const file of files) {
  const extra = readExtra(path.join(extraDir, file));
  for (const locale of LOCALES) Object.assign(merged[locale], extra[locale]);
}

let i18nText = fs.readFileSync(i18nPath, 'utf8');
const en = foldIntoObject(i18nText, 'enUS', merged['en-US']);
i18nText = en.text;
const zh = foldIntoObject(i18nText, 'zhCN', merged['zh-CN']);
i18nText = zh.text;
fs.writeFileSync(i18nPath, i18nText);

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
for (const locale of ['ja-JP', 'de-DE', 'fr-FR']) Object.assign(data[locale], merged[locale]);
fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);

for (const file of files) {
  const name = path.basename(file, '.ts');
  const body = fs.readFileSync(path.join(extraDir, file), 'utf8');
  const exportName = /export const (\w+)/.exec(body)?.[1] ?? `${name}Messages`;
  fs.writeFileSync(
    path.join(extraDir, file),
    `import type { ExtraMessages } from './types';\n\n/** Folded into i18n.ts and the locale data by scripts/fold-i18n-extra.mjs. */\nexport const ${exportName}: ExtraMessages = {\n  'en-US': {},\n  'zh-CN': {},\n  'ja-JP': {},\n  'de-DE': {},\n  'fr-FR': {},\n};\n`,
  );
}

console.log(
  `en-US: ${en.added} added, ${en.replaced} replaced · zh-CN: ${zh.added} added, ${zh.replaced} replaced · ` +
    LOCALES.slice(2).map((l) => `${l}: ${Object.keys(merged[l]).length}`).join(', '),
);
console.log('Now run: node apps/dashboard/scripts/build-i18n-locales.mjs');
