const migrationModules = import.meta.glob('../../../../packages/db/migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

let applied = false;

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_WEBSITE_ID = '00000000-0000-0000-0000-000000000099';

async function execMigration(db: D1Database, sql: string) {
  const statements = sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

/** Apply bundled D1 migrations once per test run (Miniflare starts with an empty DB). */
export async function applyTestMigrations(db: D1Database): Promise<void> {
  if (applied) return;

  const migrations = Object.entries(migrationModules)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, sql]) => sql);

  for (const sql of migrations) {
    await execMigration(db, sql);
  }

  applied = true;
}

export async function seedTestWebsite(db: D1Database): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
    )
    .bind(TEST_USER_ID, 'test-user', 'hash', 'admin', now)
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
    )
    .bind(TEST_WEBSITE_ID, 'Test Site', 'example.com', TEST_USER_ID, now)
    .run();
}
