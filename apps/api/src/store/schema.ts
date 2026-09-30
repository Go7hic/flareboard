/**
 * Schema of a website's analytics store (one SQLite Durable Object per website).
 *
 * Table and column names match the old shared D1 tables so existing SQL keeps working, with two
 * changes that cut storage by several times:
 * - event properties live in `website_event.properties` (JSON object) instead of one
 *   `event_data` row per property. `event_data` is a view over that JSON, and INSTEAD OF
 *   triggers keep INSERT/DELETE on it working for older write paths and tests;
 * - indexes that only made sense in a multi-tenant table (single `website_id`, bare
 *   `created_at`) are gone.
 *
 * Migrations are append-only: never edit a released step, add a new one. Each store records every
 * version it applied (`_store_meta` key `migration:<n>`), so versions may be merged out of order:
 * a lower number added after a higher one still runs. Keep steps independent of each other's order.
 */
export const STORE_MIGRATIONS: ReadonlyArray<{ version: number; statements: string[] }> = [
  {
    version: 1,
    statements: [
      `CREATE TABLE website_event (
        event_id TEXT PRIMARY KEY NOT NULL,
        website_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        visit_id TEXT NOT NULL,
        created_at INTEGER,
        url_path TEXT NOT NULL,
        url_query TEXT,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        utm_content TEXT,
        utm_term TEXT,
        referrer_path TEXT,
        referrer_query TEXT,
        referrer_domain TEXT,
        page_title TEXT,
        gclid TEXT,
        fbclid TEXT,
        msclkid TEXT,
        ttclid TEXT,
        li_fat_id TEXT,
        twclid TEXT,
        event_type INTEGER NOT NULL DEFAULT 1,
        event_name TEXT,
        tag TEXT,
        hostname TEXT,
        lcp REAL,
        inp REAL,
        cls REAL,
        fcp REAL,
        ttfb REAL,
        properties TEXT
      )`,
      `CREATE INDEX website_event_website_created_idx ON website_event (website_id, created_at)`,
      `CREATE INDEX website_event_website_path_idx ON website_event (website_id, created_at, url_path)`,
      `CREATE INDEX website_event_website_event_name_idx ON website_event (website_id, created_at, event_name)`,
      `CREATE INDEX website_event_website_type_created_idx ON website_event (website_id, event_type, created_at)`,
      `CREATE INDEX website_event_session_idx ON website_event (session_id)`,
      `CREATE INDEX website_event_visit_idx ON website_event (visit_id)`,

      // Read-compatible replacement for the old one-row-per-property table. Only strings,
      // numbers and booleans are ever stored (flattenEventData), so the mapping is lossless.
      `CREATE VIEW event_data AS
        SELECT e.event_id || ':' || j.key AS event_data_id,
               e.website_id AS website_id,
               e.event_id AS website_event_id,
               j.key AS data_key,
               CASE WHEN j.type = 'text' THEN j.value
                    WHEN j.type = 'true' THEN 'true'
                    WHEN j.type = 'false' THEN 'false'
                    ELSE NULL END AS string_value,
               CASE WHEN j.type IN ('integer', 'real') THEN j.value ELSE NULL END AS number_value,
               NULL AS date_value,
               CASE WHEN j.type IN ('integer', 'real') THEN 2
                    WHEN j.type IN ('true', 'false') THEN 3
                    ELSE 1 END AS data_type,
               e.created_at AS created_at
        FROM website_event e, json_each(e.properties) j
        WHERE e.properties IS NOT NULL`,
      `CREATE TRIGGER event_data_insert INSTEAD OF INSERT ON event_data
        BEGIN
          UPDATE website_event
          SET properties = json_patch(
            COALESCE(properties, '{}'),
            json_object(
              NEW.data_key,
              CASE NEW.data_type
                WHEN 2 THEN NEW.number_value
                WHEN 3 THEN json(CASE WHEN NEW.string_value = 'true' THEN 'true' ELSE 'false' END)
                ELSE NEW.string_value
              END
            )
          )
          WHERE event_id = NEW.website_event_id;
        END`,
      `CREATE TRIGGER event_data_delete INSTEAD OF DELETE ON event_data
        BEGIN
          UPDATE website_event
          SET properties = json_patch(properties, json_object(OLD.data_key, NULL))
          WHERE event_id = OLD.website_event_id;
        END`,

      `CREATE TABLE session (
        session_id TEXT PRIMARY KEY NOT NULL,
        website_id TEXT NOT NULL,
        browser TEXT,
        os TEXT,
        device TEXT,
        screen TEXT,
        language TEXT,
        country TEXT,
        region TEXT,
        city TEXT,
        distinct_id TEXT,
        created_at INTEGER
      )`,
      `CREATE INDEX session_website_created_idx ON session (website_id, created_at)`,
      `CREATE INDEX session_distinct_idx ON session (distinct_id)`,

      `CREATE TABLE session_data (
        session_data_id TEXT PRIMARY KEY NOT NULL,
        website_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        data_key TEXT NOT NULL,
        string_value TEXT,
        number_value REAL,
        date_value INTEGER,
        data_type INTEGER NOT NULL,
        distinct_id TEXT,
        created_at INTEGER
      )`,
      `CREATE INDEX session_data_session_created_idx ON session_data (session_id, created_at)`,
      `CREATE INDEX session_data_website_key_created_idx ON session_data (website_id, data_key, created_at)`,

      `CREATE TABLE revenue (
        revenue_id TEXT PRIMARY KEY NOT NULL,
        website_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event_name TEXT NOT NULL,
        currency TEXT NOT NULL,
        revenue REAL,
        created_at INTEGER
      )`,
      `CREATE INDEX revenue_website_created_idx ON revenue (website_id, created_at)`,
      `CREATE INDEX revenue_session_idx ON revenue (session_id)`,

      `CREATE TABLE session_replay (
        replay_id TEXT PRIMARY KEY NOT NULL,
        website_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        visit_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        events BLOB NOT NULL,
        event_count INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        created_at INTEGER
      )`,
      `CREATE INDEX session_replay_website_created_idx ON session_replay (website_id, created_at)`,
      `CREATE INDEX session_replay_website_visit_chunk_idx ON session_replay (website_id, visit_id, chunk_index)`,
      `CREATE INDEX session_replay_session_idx ON session_replay (session_id)`,

      `CREATE TABLE session_replay_summary (
        website_id TEXT NOT NULL,
        visit_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        event_count INTEGER NOT NULL DEFAULT 0,
        chunks INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (website_id, visit_id)
      )`,
      `CREATE INDEX session_replay_summary_website_started_idx ON session_replay_summary (website_id, started_at DESC)`,

      `CREATE TABLE heatmap_cell (
        website_id TEXT NOT NULL,
        url_path TEXT NOT NULL,
        day TEXT NOT NULL,
        kind TEXT NOT NULL,
        norm_x INTEGER NOT NULL,
        norm_y INTEGER NOT NULL,
        device_class TEXT NOT NULL DEFAULT '',
        viewport_w INTEGER NOT NULL DEFAULT 0,
        viewport_h INTEGER NOT NULL DEFAULT 0,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (website_id, url_path, day, kind, norm_x, norm_y, device_class)
      )`,
      `CREATE TABLE heatmap_ingest_dedup (
        id TEXT PRIMARY KEY NOT NULL,
        website_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX heatmap_ingest_dedup_created_idx ON heatmap_ingest_dedup (created_at)`,

      `CREATE TABLE rollup_stats_daily (
        website_id TEXT NOT NULL,
        day TEXT NOT NULL,
        pageviews INTEGER NOT NULL DEFAULT 0,
        visitors INTEGER NOT NULL DEFAULT 0,
        visits INTEGER NOT NULL DEFAULT 0,
        bounces INTEGER NOT NULL DEFAULT 0,
        totaltime_sec INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (website_id, day)
      )`,
      `CREATE TABLE rollup_pageview_series (
        website_id TEXT NOT NULL,
        unit TEXT NOT NULL,
        bucket TEXT NOT NULL,
        pageviews INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (website_id, unit, bucket)
      )`,
      `CREATE TABLE rollup_series_bucket (
        website_id TEXT NOT NULL,
        unit TEXT NOT NULL,
        bucket TEXT NOT NULL,
        session_id TEXT NOT NULL,
        visit_id TEXT NOT NULL,
        PRIMARY KEY (website_id, unit, bucket, session_id, visit_id)
      )`,
      `CREATE TABLE rollup_dimension_daily (
        website_id TEXT NOT NULL,
        day TEXT NOT NULL,
        dimension TEXT NOT NULL,
        value TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (website_id, day, dimension, value)
      )`,
      `CREATE TABLE rollup_event_daily (
        website_id TEXT NOT NULL,
        day TEXT NOT NULL,
        event_name TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (website_id, day, event_name)
      )`,
      `CREATE TABLE rollup_session_day (
        website_id TEXT NOT NULL,
        day TEXT NOT NULL,
        session_id TEXT NOT NULL,
        visit_id TEXT NOT NULL,
        pageviews INTEGER NOT NULL DEFAULT 0,
        first_at INTEGER NOT NULL,
        last_at INTEGER NOT NULL,
        PRIMARY KEY (website_id, day, session_id, visit_id)
      )`,

      `CREATE TABLE person (
        person_id TEXT PRIMARY KEY NOT NULL,
        website_id TEXT NOT NULL,
        distinct_id TEXT NOT NULL,
        properties_json TEXT NOT NULL DEFAULT '{}',
        first_seen_at INTEGER,
        last_seen_at INTEGER,
        created_at INTEGER,
        updated_at INTEGER
      )`,
      `CREATE UNIQUE INDEX person_website_distinct_idx ON person (website_id, distinct_id)`,
      `CREATE TABLE person_group_membership (
        membership_id TEXT PRIMARY KEY NOT NULL,
        website_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        group_type TEXT NOT NULL,
        group_key TEXT NOT NULL,
        created_at INTEGER
      )`,
      `CREATE UNIQUE INDEX person_group_membership_unique_idx ON person_group_membership (website_id, person_id, group_type, group_key)`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE warehouse_import (
        import_row_id TEXT PRIMARY KEY NOT NULL,
        website_id TEXT NOT NULL,
        data_source_id TEXT NOT NULL,
        primary_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        imported_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX warehouse_import_source_key_idx ON warehouse_import (website_id, data_source_id, primary_key)`,
      `CREATE INDEX warehouse_import_website_idx ON warehouse_import (website_id, imported_at)`,
    ],
  },
  {
    // Stripe connector (lib/stripe-connector.ts). Mirrors D1 migration 0053 for the legacy mode.
    version: 3,
    statements: [
      `CREATE TABLE stripe_customer (
        website_id text NOT NULL,
        data_source_id text NOT NULL,
        customer_id text NOT NULL,
        email text,
        name text,
        distinct_id text,
        deleted integer NOT NULL DEFAULT 0,
        metadata_json text,
        payload_json text NOT NULL,
        created_at integer,
        synced_at integer NOT NULL,
        PRIMARY KEY (data_source_id, customer_id)
      )`,
      `CREATE INDEX stripe_customer_website_idx ON stripe_customer (website_id, created_at)`,
      `CREATE INDEX stripe_customer_distinct_idx ON stripe_customer (website_id, distinct_id)`,
      `CREATE TABLE stripe_charge (
        website_id text NOT NULL,
        data_source_id text NOT NULL,
        charge_id text NOT NULL,
        customer_id text,
        invoice_id text,
        status text,
        paid integer NOT NULL DEFAULT 0,
        amount integer NOT NULL DEFAULT 0,
        amount_refunded integer NOT NULL DEFAULT 0,
        currency text NOT NULL,
        amount_major real NOT NULL DEFAULT 0,
        payload_json text NOT NULL,
        created_at integer NOT NULL,
        synced_at integer NOT NULL,
        PRIMARY KEY (data_source_id, charge_id)
      )`,
      `CREATE INDEX stripe_charge_website_created_idx ON stripe_charge (website_id, created_at)`,
      `CREATE INDEX stripe_charge_customer_idx ON stripe_charge (website_id, customer_id)`,
      `CREATE TABLE stripe_refund (
        website_id text NOT NULL,
        data_source_id text NOT NULL,
        refund_id text NOT NULL,
        charge_id text,
        status text,
        amount integer NOT NULL DEFAULT 0,
        currency text NOT NULL,
        amount_major real NOT NULL DEFAULT 0,
        payload_json text NOT NULL,
        created_at integer NOT NULL,
        synced_at integer NOT NULL,
        PRIMARY KEY (data_source_id, refund_id)
      )`,
      `CREATE INDEX stripe_refund_website_created_idx ON stripe_refund (website_id, created_at)`,
      `CREATE TABLE stripe_invoice (
        website_id text NOT NULL,
        data_source_id text NOT NULL,
        invoice_id text NOT NULL,
        customer_id text,
        subscription_id text,
        status text,
        currency text NOT NULL,
        total integer NOT NULL DEFAULT 0,
        amount_paid integer NOT NULL DEFAULT 0,
        amount_paid_major real NOT NULL DEFAULT 0,
        period_start integer,
        period_end integer,
        paid_at integer,
        payload_json text NOT NULL,
        created_at integer NOT NULL,
        synced_at integer NOT NULL,
        PRIMARY KEY (data_source_id, invoice_id)
      )`,
      `CREATE INDEX stripe_invoice_website_created_idx ON stripe_invoice (website_id, created_at)`,
      `CREATE TABLE stripe_invoice_line (
        website_id text NOT NULL,
        data_source_id text NOT NULL,
        invoice_id text NOT NULL,
        line_id text NOT NULL,
        customer_id text,
        subscription_id text,
        price_id text,
        interval text,
        interval_count integer,
        quantity integer,
        proration integer NOT NULL DEFAULT 0,
        amount integer NOT NULL DEFAULT 0,
        currency text NOT NULL,
        amount_major real NOT NULL DEFAULT 0,
        mrr_major real NOT NULL DEFAULT 0,
        period_start integer,
        period_end integer,
        synced_at integer NOT NULL,
        PRIMARY KEY (data_source_id, invoice_id, line_id)
      )`,
      `CREATE INDEX stripe_invoice_line_period_idx ON stripe_invoice_line (website_id, period_end)`,
      `CREATE TABLE stripe_subscription (
        website_id text NOT NULL,
        data_source_id text NOT NULL,
        subscription_id text NOT NULL,
        customer_id text,
        status text,
        currency text,
        mrr_major real NOT NULL DEFAULT 0,
        start_date integer,
        canceled_at integer,
        ended_at integer,
        cancel_at_period_end integer NOT NULL DEFAULT 0,
        current_period_start integer,
        current_period_end integer,
        trial_end integer,
        payload_json text NOT NULL,
        created_at integer NOT NULL,
        synced_at integer NOT NULL,
        PRIMARY KEY (data_source_id, subscription_id)
      )`,
      `CREATE INDEX stripe_subscription_website_idx ON stripe_subscription (website_id, created_at)`,
    ],
  },
  {
    // Replay activity counters (D1 migration 0051), per chunk and summed per visit. Version 6 was
    // allocated to the replay stream (4 = logs-otlp, 5 = llm-observability).
    version: 6,
    statements: [
      `ALTER TABLE session_replay ADD COLUMN click_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE session_replay ADD COLUMN input_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE session_replay ADD COLUMN console_log_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE session_replay ADD COLUMN console_warn_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE session_replay ADD COLUMN console_error_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE session_replay ADD COLUMN network_error_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE session_replay_summary ADD COLUMN click_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE session_replay_summary ADD COLUMN input_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE session_replay_summary ADD COLUMN console_log_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE session_replay_summary ADD COLUMN console_warn_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE session_replay_summary ADD COLUMN console_error_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE session_replay_summary ADD COLUMN network_error_count INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    // OpenTelemetry logs and spans received on ingest's /v1/logs and /v1/traces (docs/logs-otlp.md).
    // These tables exist only in the website store, in every EVENT_STORE mode: they have no D1
    // history to migrate. `created_at` is the record's own time in ms (retention and time
    // filters), `*_us` keep microseconds for ordering and span waterfalls. `attributes` and
    // `resource` are JSON objects, capped by ingest.
    version: 4,
    statements: [
      `CREATE TABLE log_record (
        log_id TEXT PRIMARY KEY NOT NULL,
        website_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        time_us INTEGER NOT NULL,
        severity TEXT NOT NULL,
        severity_number INTEGER NOT NULL DEFAULT 0,
        severity_text TEXT,
        body TEXT,
        service TEXT,
        service_version TEXT,
        environment TEXT,
        scope TEXT,
        trace_id TEXT,
        span_id TEXT,
        session_id TEXT,
        attributes TEXT,
        resource TEXT
      )`,
      `CREATE INDEX log_record_created_idx ON log_record (created_at)`,
      `CREATE INDEX log_record_severity_created_idx ON log_record (severity, created_at)`,
      `CREATE INDEX log_record_service_created_idx ON log_record (service, created_at)`,
      `CREATE INDEX log_record_trace_idx ON log_record (trace_id) WHERE trace_id IS NOT NULL`,
      `CREATE INDEX log_record_session_idx ON log_record (session_id) WHERE session_id IS NOT NULL`,

      `CREATE TABLE trace_span (
        trace_id TEXT NOT NULL,
        span_id TEXT NOT NULL,
        website_id TEXT NOT NULL,
        parent_span_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'unspecified',
        service TEXT,
        service_version TEXT,
        environment TEXT,
        scope TEXT,
        created_at INTEGER NOT NULL,
        start_us INTEGER NOT NULL,
        end_us INTEGER NOT NULL,
        duration_us INTEGER NOT NULL,
        status_code TEXT NOT NULL DEFAULT 'unset',
        status_message TEXT,
        session_id TEXT,
        attributes TEXT,
        resource TEXT,
        events TEXT,
        links TEXT,
        PRIMARY KEY (trace_id, span_id)
      )`,
      `CREATE INDEX trace_span_created_idx ON trace_span (created_at)`,
      `CREATE INDEX trace_span_service_created_idx ON trace_span (service, created_at)`,
      `CREATE INDEX trace_span_session_idx ON trace_span (session_id) WHERE session_id IS NOT NULL`,
    ],
  },
  {
    version: 7,
    // Storage bills every index entry as a written row. (website_id, created_at) is a prefix of the
    // path and event-name indexes, which serve the same range scans, so it only cost a row per event.
    statements: [`DROP INDEX IF EXISTS website_event_website_created_idx`],
  },
];

/** OpenTelemetry logs and spans are kept at most this long (the store alarm purges older rows). */
export const OTEL_RETENTION_DAYS = 30;

export const STORE_SCHEMA_VERSION = Math.max(...STORE_MIGRATIONS.map((migration) => migration.version));

/**
 * Versions that existed before per-version tracking. A store that only has `schema_version` = N
 * applied exactly these versions up to N (versions added later are tracked individually).
 */
export const LEGACY_STORE_VERSIONS: ReadonlyArray<number> = [1, 2, 3, 6];

/**
 * Migrations a store still needs, in version order, given its `_store_meta` rows: the versions it
 * recorded individually plus, for stores migrated before that, the legacy versions up to its
 * `schema_version`.
 */
export function pendingStoreMigrations<M extends { version: number }>(
  meta: ReadonlyMap<string, string>,
  migrations: ReadonlyArray<M> = STORE_MIGRATIONS as unknown as ReadonlyArray<M>,
  legacyVersions: ReadonlyArray<number> = LEGACY_STORE_VERSIONS,
): M[] {
  const applied = new Set<number>();
  for (const key of meta.keys()) if (key.startsWith('migration:')) applied.add(Number(key.slice('migration:'.length)));
  const legacyVersion = Number(meta.get('schema_version') ?? 0);
  for (const version of legacyVersions) if (version <= legacyVersion) applied.add(version);
  return [...migrations].filter((migration) => !applied.has(migration.version)).sort((a, b) => a.version - b.version);
}
