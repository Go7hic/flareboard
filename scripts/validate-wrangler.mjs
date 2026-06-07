#!/usr/bin/env node
/**
 * Fail deploy if production wrangler configs still contain REPLACE_WITH_* placeholders.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const WRANGLER_FILES = [
  'apps/api/wrangler.jsonc',
  'apps/ingest/wrangler.jsonc',
  'workers/aggregator/wrangler.jsonc',
  'apps/dashboard/wrangler.jsonc',
];

function stripJsoncComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      out += ch;
      i += 1;
      while (i < text.length) {
        const c = text[i];
        out += c;
        i += 1;
        if (c === '\\' && i < text.length) {
          out += text[i];
          i += 1;
          continue;
        }
        if (c === '"') break;
      }
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function findPlaceholders(filePath) {
  const raw = readFileSync(join(root, filePath), 'utf8');
  const json = JSON.parse(stripJsoncComments(raw));
  const production = json.env?.production;
  if (!production) return [];

  const hits = [];
  const walk = (obj, path = '') => {
    if (typeof obj === 'string' && obj.includes('REPLACE_WITH_')) {
      hits.push(`${path}: ${obj}`);
    } else if (Array.isArray(obj)) {
      obj.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(production);
  return hits;
}

let failed = false;

for (const file of WRANGLER_FILES) {
  const hits = findPlaceholders(file);
  if (hits.length) {
    failed = true;
    console.error(`\n${file}: production env contains unresolved placeholders:`);
    for (const hit of hits) {
      console.error(`  - ${hit}`);
    }
  }
}

if (failed) {
  console.error('\nResolve REPLACE_WITH_* values before deploying to production.');
  process.exit(1);
}

console.log('Wrangler production configs validated (no REPLACE_WITH_* placeholders).');
