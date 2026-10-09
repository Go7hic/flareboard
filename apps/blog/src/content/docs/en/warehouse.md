---
title: Warehouse and revenue
description: Run read-only SQL over your events, bring in outside data from HTTP sources or Stripe, and read revenue, MRR and churn on the Revenue page.
---

The **Data warehouse** lets you query your Flareboard data with SQL, and add data from outside: JSON or CSV files from a URL, and your Stripe account. The **Revenue** page uses the same data to show revenue, subscriptions and MRR. You can also import old pageviews from a CSV export of another analytics tool.

## Before you start

- A website with data. See the [Quickstart](/docs/quickstart).
- On Flareboard Cloud, the warehouse needs the Cloud or Business plan. Without it the warehouse API answers `403` `Warehouse requires a paid plan.` Self-hosted installs have no plan limits. See [Plans and limits](/docs/plans-limits).
- Creating sources, saved queries and schedules needs edit access to the website.

## 1. Run SQL

Open the website, then **Data warehouse** (under **Data**). Tabs: **Query**, **Saved**, **History**, **Schedules** and **Sources**.

In **Query**, write SQL in **Warehouse SQL** and click **Run query**. The editor checks the query as you type (**Query checks**) and lists **Example queries** and the **Site tables**. Click **Export CSV** to download the result.

### Rules

- One read-only statement that starts with `SELECT` or `WITH`. No semicolons and no comments (`--` or `/* */`).
- It must contain `website_id = ?1`. `?1` is filled in with the website's ID for you. The query only ever sees this website's rows, and `website_id` must not be compared any other way.
- Words that write or change things are refused wherever they appear: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `REPLACE`, `TRUNCATE`, `ATTACH`, `DETACH`, `PRAGMA`, `VACUUM`, `REINDEX`.
- `UNION`, `INTERSECT` and `EXCEPT` are refused. Quoted identifiers, schema-qualified names and internal tables are refused.
- Only the tables listed below can be used. Joins and CTEs (`WITH`) over them are fine.

### Limits

| Limit | Value |
| --- | --- |
| Rows shown | Up to 1,000. A query without `LIMIT` returns 100 rows |
| Rows scanned per query | 100,000 |
| Run time | 10 seconds |
| CSV export | Up to 10,000 rows. When the cap cuts rows off, the console says so; add a filter or `LIMIT` to export the rest in parts |
| Query rate | 20 a minute per user and website |

### Tables

`created_at` columns are in milliseconds since the epoch. The **Site tables** list in the editor always shows the current columns.

| Table | What it holds |
| --- | --- |
| `website_event` | Pageviews, custom events, errors, logs, AI calls and more. Main columns: `event_id`, `session_id`, `visit_id`, `created_at`, `url_path`, `event_type`, `event_name`, `revenue`, `currency`. `event_type` is a number: 1 pageview, 2 custom event, 5 performance, 8 error, 9 log, 10 AI |
| `event_data` | One row per event property: `website_event_id`, `data_key`, `string_value`, `number_value`, `data_type` |
| `session` | Visitor sessions: `browser`, `os`, `device`, `country`, `region`, `city`, `language`, `created_at` |
| `survey_response` | Survey answers: `survey_id`, `session_id`, `answer`, `url_path`, `created_at` |
| `workflow_execution` | Workflow runs: `workflow_id`, `event_name`, `status`, `error`, `created_at` |
| `revenue` | One row per tracked revenue event: `event_name`, `currency`, `revenue`, `created_at` |
| `person` | Identified people: `distinct_id`, `properties_json`, `first_seen_at`, `last_seen_at` |
| `warehouse_import` | Rows from HTTP JSON and CSV sources (see below) |
| `stripe_customer`, `stripe_charge`, `stripe_refund`, `stripe_invoice`, `stripe_invoice_line`, `stripe_subscription` | Stripe data (see below) |

With per-website stores, a query sees at most the latest 50,000 rows of `survey_response` and `workflow_execution`.

### Examples

Top custom events:

```sql
SELECT event_name AS eventName, COUNT(*) AS events
FROM website_event
WHERE website_id = ?1 AND event_name IS NOT NULL
GROUP BY event_name
ORDER BY events DESC
LIMIT 20
```

Sessions by country:

```sql
SELECT COALESCE(country, 'unknown') AS country, COUNT(*) AS sessions
FROM session
WHERE website_id = ?1
GROUP BY COALESCE(country, 'unknown')
ORDER BY sessions DESC
LIMIT 20
```

Workflow failures:

```sql
SELECT event_name AS eventName, error, created_at AS createdAt
FROM workflow_execution
WHERE website_id = ?1 AND status = 'failed'
ORDER BY created_at DESC
LIMIT 50
```

Stripe revenue by month:

```sql
SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch') AS month, currency, SUM(amount_major) AS revenue, COUNT(*) AS charges
FROM stripe_charge
WHERE website_id = ?1 AND paid = 1 AND status = 'succeeded'
GROUP BY month, currency
ORDER BY month DESC
LIMIT 24
```

### Save, repeat and schedule

- **Save query**: stores the SQL with a **Query name** under **Saved** for everyone on the website. **Load** puts it back in the editor.
- **History**: recent runs of the website, with status, row count and error.
- **Schedules**: write the SQL in **Query**, then click **New schedule**, enter a **Name** and an **Interval (minutes)**. The schedule runs the SQL from the editor repeatedly. The schedule records the last status and row count and adds a **History** entry. It does not store or send the result. Due schedules run on the hourly cron, or when you click **Run due schedules**.

### From code

`POST /api/websites/WEBSITE_ID/warehouse/query` with `{"sql": "…"}` runs a query. It needs a personal API key with the **Write** scope. See [Run SQL](/docs/api#run-sql).

## 2. Add data sources

Open **Data warehouse**, then **Sources**, and click **New data source**. Choose a **Source type**. Each source shows its status (**Connected**, **Syncing** or **Failed**) and **Last sync**. Click **Sync now** to sync at once. It ignores `syncIntervalMinutes`, but waits a minute after the last sync, and says so if you click too soon. Enabled sources also sync on the hourly cron.

### HTTP JSON and HTTP CSV

Enter the **Configuration (JSON)**:

```json
{
  "url": "https://example.com/customers.json",
  "primaryKey": "id",
  "syncIntervalMinutes": 60
}
```

| Setting | Default | What it does |
| --- | --- | --- |
| `url` | none, required | A public `http` or `https` address. Flareboard fetches it with `GET`, without headers or redirects. It must not contain a username or password, and private, loopback and internal hosts are refused |
| `primaryKey` | `id` | The field that identifies a row. Rows without a value for it are skipped |
| `syncIntervalMinutes` | none | The hourly cron skips the source until this many minutes have passed since the last sync. **Sync now** is not affected. Values above 1,440 count as 1,440 |

An **HTTP JSON** source must return a JSON array of objects. An **HTTP CSV** source must return a CSV with a header row. A response can have up to 10,000 rows and be up to 5 MB, and the request times out after 15 seconds. Each sync upserts rows by primary key.

Rows land in `warehouse_import`. Read fields from `payload_json`:

```sql
SELECT primary_key, json_extract(payload_json, '$.plan') AS plan
FROM warehouse_import
WHERE website_id = ?1 AND data_source_id = 'YOUR_DATA_SOURCE_ID'
LIMIT 50
```

The schema panel in the query editor lists each source's imported fields under **Imported data**, with an example query.

### Stripe

The Stripe connector copies customers, subscriptions, invoices with their line items, charges and refunds into the `stripe_*` tables.

1. In Stripe, open **Developers**, then **API keys**, and create a restricted key with **Read** access to Customers, Charges, Refunds, Invoices, Subscriptions and Events.
2. In Flareboard, click **New data source**, choose **Stripe**, enter a name, paste the key into **Restricted API key** and create the source.

Only restricted keys (`rk_live_…` or `rk_test_…`) are accepted. A secret key (`sk_…`) is refused. The key is stored encrypted and never shown again: the console shows only a hint such as `rk_live_…4242`. When you delete the data source, Flareboard deletes the key and the imported Stripe data with it. The key is also erased when a deleted website's data is erased.

The first sync imports your Stripe history in batches (**Importing history…**) and continues on the hourly cron until it is complete. After that it applies Stripe's event feed, so refunds, cancellations and paid invoices arrive. Stripe keeps events for 30 days. If a sync falls further behind, the import starts over. Customers are linked to people by `distinct_id` in the customer's Stripe metadata, or by matching email, so you can join revenue to people.

**Replace key** swaps in a new key. Because it may belong to another Stripe account, this removes the data imported with the old key and syncs again from the start. The type of a Stripe source cannot be changed.

Useful columns: `amount_major` (in the currency's main unit, for example dollars) on `stripe_charge`, `stripe_refund` and `stripe_invoice_line`, and `mrr_major` on `stripe_invoice_line` and `stripe_subscription`.

## 3. Revenue and MRR

Open the website, then **Revenue** (under **Growth**). Revenue comes from two sources, shown together and never summed across currencies:

- **Tracked event**: purchases you track with an amount. In the browser, call `flareboard.revenue(49, 'USD', { name: 'checkout' })`. From a server, send `revenue` and `currency` in the event payload (both are needed). See [Track events](/docs/events) and [Send events from your server](/docs/install/server).
- **Stripe**: succeeded charges count as revenue and refunds subtract from it, once you have connected Stripe.

The page shows **Total**, **Transactions** and **Revenue by day** per currency, and **Revenue by event**. **Top paying sessions** lets you open a session to see the path to purchase.

**Subscriptions** shows MRR from Stripe subscription invoices (open or paid, without prorations), measured at the end of each month, with:

- **MRR**, **ARR**, **Active subscribers**, **Churn rate (last month)** and **ARPU**.
- **MRR movement**: **New**, **Expansion**, **Contraction** and **Churned**.

The range is widened to at least 12 months so the monthly figures are complete. Without Stripe data, the page says **No subscription data yet** and points you to **Data warehouse**, then **Sources**.

**Revenue attribution** credits each transaction to the first visit of the paying person (first touch), or to the purchase session when the person is unknown. Choose a dimension: UTM source, medium, campaign or referrer. A transaction with no known source shows as **Direct**.

**Export transactions** (up to 50,000 rows, newest first), **Export attribution** and **Export MRR** download CSV files. Exports need the Cloud or Business plan on Flareboard Cloud.

## 4. Import old pageviews from a CSV

If you used another tool before, import its pageview exports. Open the website's **Settings**, find **Data import**, choose a **Format**, then upload a file (**Upload CSV file**, up to 20 MB) or paste the CSV, and click **Import**.

| Format | Required columns |
| --- | --- |
| Google Analytics 4 CSV | `Date` and `Page path`. `Views` (or event count) repeats the row |
| Plausible CSV | `date` and `page`. `pageviews` or `visitors` repeats the row |
| Matomo CSV | A page URL column. `date` and `hits` are used when present |
| Flareboard CSV | `timestamp` and `url_path`. Optional `session_id` and `event_name` |

Each imported row becomes a pageview event (a custom event, when the Flareboard format has an `event_name`) with a new anonymous session. A row with a count creates that many pageviews. The result says how many rows were imported and skipped, with up to 50 error messages. Import needs the Cloud or Business plan on Flareboard Cloud, and edit access to the website.

## Check that it works

1. Open **Data warehouse** and run `SELECT COUNT(*) AS events FROM website_event WHERE website_id = ?1`. You get one row.
2. Add an HTTP JSON source that points to a small public JSON file and click **Sync now**. The status turns **Connected**, and `warehouse_import` has rows.
3. For Stripe, wait for the first sync to finish (the **Importing history…** label goes away). Then open **Revenue**. **Subscriptions** shows MRR.

## Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| `Warehouse queries must scope reads with website_id = ?1` | The query has no `website_id = ?1` | Add it to the `WHERE` clause |
| `Table not allowed in warehouse queries` | The query uses a table outside the list | Use only the tables above |
| `Query scanned … rows; maximum allowed is 100,000` | The query reads too much | Add filters, such as a time range on `created_at` |
| `Query exceeded 10000ms timeout` | The query is too slow | Narrow it down and add `LIMIT` |
| `Rate limit exceeded` | More than 20 queries a minute | Wait a minute |
| `Stripe needs a restricted API key (rk_live_… or rk_test_…) with read access` | You pasted a secret key, or a malformed one | Create a restricted key in Stripe |
| Source status **Failed** with `Expected JSON array response` | The URL does not return a JSON array | Return an array of objects, or use HTTP CSV |
| Source status **Failed** with `Import URL host is not allowed` | The URL points to a private or internal host | Use a public address |
| `Import exceeds 10000 rows` | The response has too many rows | Split it, or serve a smaller file |
