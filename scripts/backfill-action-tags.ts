#!/usr/bin/env tsx
/**
 * Backfill action tags on historical events for a website and date range.
 *
 * Usage:
 *   pnpm backfill:action-tags -- --website=<uuid> --start=2026-01-01 --end=2026-01-31
 *   pnpm backfill:action-tags -- --website=<uuid> --start=2026-01-01 --end=2026-01-31 --dry-run
 *   API_URL=https://api.example.com APP_SECRET=... pnpm backfill:action-tags -- --website=<uuid> --start=... --end=...
 */
function parseDateArg(value: string | undefined, label: string): number {
  if (!value) throw new Error(`Missing --${label}`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid --${label}: ${value}`);
  return parsed;
}

function parseArgs() {
  const websiteId = process.argv.find((arg) => arg.startsWith('--website='))?.split('=')[1]?.trim();
  const startAt = parseDateArg(
    process.argv.find((arg) => arg.startsWith('--start='))?.split('=')[1],
    'start',
  );
  const endAt = parseDateArg(
    process.argv.find((arg) => arg.startsWith('--end='))?.split('=')[1],
    'end',
  );
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? Number(limitArg) : undefined;
  return { websiteId, startAt, endAt, dryRun, limit };
}

async function main() {
  const { websiteId, startAt, endAt, dryRun, limit } = parseArgs();
  if (!websiteId) throw new Error('Missing --website=<uuid>');

  const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:8788').replace(/\/$/, '');
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error('APP_SECRET is required');

  const response = await fetch(`${apiUrl}/api/internal/backfill-action-tags`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ websiteId, startAt, endAt, limit, dryRun }),
  });

  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Backfill failed (${response.status}): ${JSON.stringify(body)}`);
  }

  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
