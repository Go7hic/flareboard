#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, ROLES, uuid } from '@flareboard/shared';

const LOCAL_DEFAULT_PASSWORD = 'flareboard';
const LOCAL_DEFAULT_USERNAME = 'admin';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerBin = join(root, 'node_modules/.bin/wrangler');
const wrangler = existsSync(wranglerBin) ? wranglerBin : 'wrangler';

function printUsage(): void {
  console.log(`Seed an admin user into Flareboard D1.

Usage:
  pnpm seed [--] [options]
  pnpm seed:remote -- --username <name> --password <pass>

Options:
  --remote              Target production D1 (requires explicit password)
  --username <name>     Admin username (default: admin, or SEED_USERNAME)
  --password <pass>     Admin password (or SEED_PASSWORD)
  --help, -h            Show this help

Environment:
  SEED_USERNAME         Overrides default username
  SEED_PASSWORD         Password (required for remote if not passed via --password)

Local dev defaults when password is omitted:
  username: admin
  password: flareboard

Remote seed never uses a default password. Pass --password or set SEED_PASSWORD.
Remote seed refuses the dev default "flareboard" and exits non-zero.

Examples:
  pnpm seed
  pnpm seed -- --username myadmin --password 'local-secret'
  SEED_USERNAME=ops SEED_PASSWORD='s3cret' pnpm seed:remote
  pnpm seed:remote -- --username myadmin --password 'prod-secret'
`);
}

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function parseArgs(argv: string[]): { remote: boolean; username: string; password: string } {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const remote = argv.includes('--remote');
  let username = process.env.SEED_USERNAME ?? LOCAL_DEFAULT_USERNAME;
  let password = process.env.SEED_PASSWORD;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--username') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        console.error('Missing value for --username');
        process.exit(1);
      }
      username = argv[++i];
    } else if (arg === '--password') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        console.error('Missing value for --password');
        process.exit(1);
      }
      password = argv[++i];
    }
  }

  if (!username.trim()) {
    console.error('Username cannot be empty.');
    process.exit(1);
  }

  if (password === undefined) {
    if (remote) {
      console.error(
        'Remote seed requires an explicit password. Use --password <pass> or set SEED_PASSWORD.',
      );
      printUsage();
      process.exit(1);
    }
    password = LOCAL_DEFAULT_PASSWORD;
  }

  if (!password) {
    console.error('Password cannot be empty.');
    process.exit(1);
  }

  if (remote && password === LOCAL_DEFAULT_PASSWORD) {
    console.error(
      'Refusing to seed remote production with the dev default password "flareboard". Pass a real --password or set SEED_PASSWORD.',
    );
    process.exit(1);
  }

  return { remote, username: username.trim(), password };
}

const { remote, username, password } = parseArgs(process.argv.slice(2));

const ADMIN_ID = uuid();
const NOW = Date.now();
const passwordHash = hashPassword(password);

const sql = `INSERT INTO user (user_id, username, password, role, created_at, updated_at) VALUES ('${ADMIN_ID}', '${sqlEscape(username)}', '${sqlEscape(passwordHash)}', '${ROLES.admin}', ${NOW}, ${NOW}) ON CONFLICT(username) DO UPDATE SET password = excluded.password, role = excluded.role, updated_at = excluded.updated_at;`;

const target = remote ? 'remote production D1' : 'local D1';
console.log(`Seeding admin user on ${target} (username: ${username})...`);

const wranglerArgs = [
  'd1',
  'execute',
  'flareboard-db',
  ...(remote ? ['--remote', '--env', 'production'] : ['--local']),
  '--config',
  'apps/api/wrangler.jsonc',
  '--command',
  sql,
];

try {
  // execFileSync avoids shell expansion of bcrypt `$` in the hash.
  execFileSync(wrangler, wranglerArgs, { stdio: 'inherit', cwd: root });
  console.log('Done.');
} catch (err) {
  const hint = remote
    ? 'Run `pnpm db:migrate:remote` first and ensure you are logged in (`pnpm exec wrangler login`).'
    : 'Run `pnpm db:migrate` first.';
  console.error(`Seed failed. ${hint}`);
  if (err instanceof Error && 'stderr' in err && err.stderr) {
    console.error(String(err.stderr));
  }
  process.exit(1);
}
