import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';
import { invalidateDailyRollups } from './rollups';

export type ImportFormat = 'flareboard' | 'ga4' | 'plausible' | 'matomo';

type ImportRow = {
  sessionId: string;
  visitId: string;
  createdAt: number;
  urlPath: string;
  eventName: string | null;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    if ((ch === '\t' || ch === ';') && !inQuotes && line.includes('\t')) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(csv: string) {
  const delimiter = csv.includes('\t') && !csv.includes(',') ? '\t' : ',';
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [] as string[], rows: [] as string[][] };
  const headers = parseCsvLine(lines[0]!)
    .map((h) => h.toLowerCase().replace(/^\ufeff/, '').trim());
  const rows = lines.slice(1).map((line) => {
    if (delimiter === '\t') return line.split('\t').map((c) => c.trim());
    return parseCsvLine(line);
  });
  return { headers, rows };
}

function colIndex(headers: string[], names: string[]) {
  for (const name of names) {
    const idx = headers.findIndex((h) => h === name || h.includes(name));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseDate(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d{8}$/.test(trimmed)) {
    const y = trimmed.slice(0, 4);
    const m = trimmed.slice(4, 6);
    const d = trimmed.slice(6, 8);
    return new Date(`${y}-${m}-${d}T12:00:00Z`).getTime();
  }
  const ts = Date.parse(trimmed);
  return Number.isNaN(ts) ? null : ts;
}

function normalizePath(path: string): string {
  if (!path || path === '(not set)') return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function buildBatch(
  format: ImportFormat,
  headers: string[],
  rows: string[][],
  errors: string[],
): { batch: ImportRow[]; skipped: number } {
  const batch: ImportRow[] = [];
  let skipped = 0;

  if (format === 'ga4') {
    const dateIdx = colIndex(headers, ['date']);
    const pathIdx = colIndex(headers, ['page path', 'pagepath', 'landing page', 'page path + query string']);
    const viewsIdx = colIndex(headers, ['views', 'screen page views', 'event count']);
    if (dateIdx < 0 || pathIdx < 0) {
      errors.push('GA4 CSV must include Date and Page path columns');
      return { batch, skipped };
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const createdAt = parseDate(row[dateIdx] ?? '');
      const urlPath = normalizePath(row[pathIdx] ?? '/');
      if (!createdAt) {
        errors.push(`Row ${i + 2}: invalid date`);
        skipped++;
        continue;
      }
      const views = viewsIdx >= 0 ? Math.max(1, parseInt(row[viewsIdx] ?? '1', 10) || 1) : 1;
      for (let v = 0; v < views; v++) {
        batch.push({
          sessionId: crypto.randomUUID(),
          visitId: crypto.randomUUID(),
          createdAt: createdAt + v,
          urlPath,
          eventName: null,
        });
      }
    }
    return { batch, skipped };
  }

  if (format === 'plausible') {
    const dateIdx = colIndex(headers, ['date', 'day']);
    const pathIdx = colIndex(headers, ['page', 'path', 'url', 'page_path']);
    const visitorsIdx = colIndex(headers, ['visitors', 'unique visitors', 'unique_visitors']);
    const viewsIdx = colIndex(headers, ['pageviews', 'views', 'pageviews']);
    if (dateIdx < 0 || pathIdx < 0) {
      errors.push('Plausible CSV must include date and page columns');
      return { batch, skipped };
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const createdAt = parseDate(row[dateIdx] ?? '');
      const urlPath = normalizePath(row[pathIdx] ?? '/');
      if (!createdAt) {
        errors.push(`Row ${i + 2}: invalid date`);
        skipped++;
        continue;
      }
      const count = Math.max(
        1,
        parseInt(row[viewsIdx] ?? row[visitorsIdx] ?? '1', 10) || 1,
      );
      for (let v = 0; v < count; v++) {
        batch.push({
          sessionId: crypto.randomUUID(),
          visitId: crypto.randomUUID(),
          createdAt: createdAt + v,
          urlPath,
          eventName: null,
        });
      }
    }
    return { batch, skipped };
  }

  if (format === 'matomo') {
    const dateIdx = colIndex(headers, ['date', 'label']);
    const pathIdx = colIndex(headers, ['page url', 'pageurl', 'url', 'page title and url']);
    const viewsIdx = colIndex(headers, ['pageviews', 'nb_hits', 'hits', 'views']);
    if (pathIdx < 0) {
      errors.push('Matomo CSV must include page URL column');
      return { batch, skipped };
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rawPath = row[pathIdx] ?? '/';
      let urlPath = '/';
      try {
        urlPath = normalizePath(new URL(rawPath).pathname);
      } catch {
        urlPath = normalizePath(rawPath);
      }
      const createdAt = dateIdx >= 0 ? parseDate(row[dateIdx] ?? '') : Date.now();
      if (!createdAt) {
        errors.push(`Row ${i + 2}: invalid date`);
        skipped++;
        continue;
      }
      const views = viewsIdx >= 0 ? Math.max(1, parseInt(row[viewsIdx] ?? '1', 10) || 1) : 1;
      for (let v = 0; v < views; v++) {
        batch.push({
          sessionId: crypto.randomUUID(),
          visitId: crypto.randomUUID(),
          createdAt: createdAt + v,
          urlPath,
          eventName: null,
        });
      }
    }
    return { batch, skipped };
  }

  const tsIdx = colIndex(headers, ['timestamp', 'created_at', 'date']);
  const pathIdx = colIndex(headers, ['url_path', 'path', 'page']);
  const sessionIdx = colIndex(headers, ['session_id', 'session']);
  const eventIdx = colIndex(headers, ['event_name', 'event']);
  if (tsIdx < 0 || pathIdx < 0) {
    errors.push('Flareboard CSV must include timestamp and url_path columns');
    return { batch, skipped };
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const createdAt = parseDate(row[tsIdx] ?? '');
    const urlPath = normalizePath(row[pathIdx] ?? '/');
    if (!createdAt) {
      errors.push(`Row ${i + 2}: invalid timestamp`);
      skipped++;
      continue;
    }
    batch.push({
      sessionId: row[sessionIdx] ?? crypto.randomUUID(),
      visitId: crypto.randomUUID(),
      createdAt,
      urlPath,
      eventName: eventIdx >= 0 ? row[eventIdx] || null : null,
    });
  }
  return { batch, skipped };
}

const BATCH_ROW_SIZE = 500;

async function flushBatch(env: Env, websiteId: string, batch: ImportRow[]) {
  let imported = 0;
  let batches = 0;

  for (let offset = 0; offset < batch.length; offset += BATCH_ROW_SIZE) {
    const chunk = batch.slice(offset, offset + BATCH_ROW_SIZE);
    const stmts: D1PreparedStatement[] = [];
    const sessionSeen = new Set<string>();

    for (const row of chunk) {
      if (!sessionSeen.has(row.sessionId)) {
        sessionSeen.add(row.sessionId);
        stmts.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES (?1, ?2, ?3)`,
          ).bind(row.sessionId, websiteId, row.createdAt),
        );
      }
      const eventType = row.eventName ? EVENT_TYPE.customEvent : EVENT_TYPE.pageView;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        ).bind(
          crypto.randomUUID(),
          websiteId,
          row.sessionId,
          row.visitId,
          row.createdAt,
          row.urlPath,
          eventType,
          row.eventName,
        ),
      );
      imported++;
    }

    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }
    batches++;
  }

  return { imported, batches };
}

function importDayKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export async function importCsv(
  env: Env,
  websiteId: string,
  format: ImportFormat,
  csv: string,
) {
  const { headers, rows } = parseCsv(csv);
  if (!headers.length) return { imported: 0, skipped: 0, errors: ['Empty CSV'], batches: 0 };

  const errors: string[] = [];
  const { batch, skipped } = buildBatch(format, headers, rows, errors);
  if (!batch.length && errors.length) {
    return { imported: 0, skipped, errors, batches: 0 };
  }

  const { imported, batches } = await flushBatch(env, websiteId, batch);
  const affectedDays = [...new Set(batch.map((row) => importDayKey(row.createdAt)))];
  await invalidateDailyRollups(env, websiteId, affectedDays);
  return { imported, skipped, errors: errors.slice(0, 50), batches };
}
