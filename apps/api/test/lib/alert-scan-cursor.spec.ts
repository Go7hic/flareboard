import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { runScheduledAlertChecks } from '../../src/lib/scheduled-jobs';
import { applyTestMigrations, seedTestWebsite } from '../helpers/migrations';

const SITES = ['alert-cursor-a', 'alert-cursor-b', 'alert-cursor-c'];
const NOW = Date.UTC(2026, 3, 1, 12);

describe('scheduled alert scan', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    // Only these sites have rules in this isolated storage.
    await env.DB.prepare('DELETE FROM error_alert_rule').run();
    await env.DB.prepare('DELETE FROM log_alert_rule').run();
    await env.CACHE.delete('cron:alert-scan-cursor');
    for (const siteId of SITES) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO website (website_id, name, domain, created_at, updated_at)
         VALUES (?1, ?1, 'alerts.example', ?2, ?2)`,
      )
        .bind(siteId, NOW)
        .run();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO error_alert_rule
           (alert_rule_id, website_id, name, enabled, threshold, window_minutes, channel, created_at, updated_at)
         VALUES (?1, ?2, 'Spike', 1, 1000, 10, 'record', ?3, ?3)`,
      )
        .bind(`rule-${siteId}`, siteId, NOW)
        .run();
    }
  });

  it('reaches every site across ticks instead of re-reading the first page', async () => {
    const first = await runScheduledAlertChecks(env, NOW, 2);
    const second = await runScheduledAlertChecks(env, NOW, 2);
    const third = await runScheduledAlertChecks(env, NOW, 2);
    expect([first.websites, second.websites, third.websites]).toEqual([2, 1, 2]);
  });
});
