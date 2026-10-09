---
title: Web analytics
description: Read your traffic in the Flareboard console. Overview, Realtime, Performance, UTM traffic, Goals and Compare, plus date ranges, segment filters, read-only share links and CSV export.
---

Web analytics answers the basic questions about a website: how many people visited, which pages they saw, where they came from and how fast the pages loaded. Everything on this page works as soon as the [tracking script](/docs/install/script) is installed. No extra setup is needed.

## Before you start

- The tracking script is installed on your site and the website receives pageviews. See the [Quickstart](/docs/quickstart).
- **Web Vitals** on the **Performance** page need the same script. Nothing else to install.
- CSV export needs the Cloud or Business plan on Flareboard Cloud. Self-hosted installs have every feature.

Open a website from **Websites**. The website sidebar groups its pages. This page covers **Overview**, **Realtime**, **Performance**, **Compare**, **Goals** and **UTM traffic**.

## Overview

**Overview** is the first page of a website. It opens on **Last 24 hours**.

### Headline numbers

The strip at the top shows five numbers for the selected range, each with its change against the previous period of the same length.

| Number | What it counts |
| --- | --- |
| **Visitors** | Distinct visitors. Visitors are counted without cookies, see [Concepts](/docs/concepts#visitors). |
| **Visits** | Distinct visits. A visit is one stay by a visitor, see [Concepts](/docs/concepts#visits-and-sessions). |
| **Pageviews** | Pageviews recorded by the script. |
| **Bounce rate** | Visits with exactly one pageview, divided by all visits. |
| **Avg. duration** | The summed length of all visits, divided by the number of visits. |

How the last two are computed:

- A visit that has a single pageview is a bounce. A visit with two or more pageviews is not.
- The length of a visit is the time between its first and its last recorded event. A visit with one event lasts 0 seconds, so many single-page visits pull the average down.
- Both numbers are derived from counts, not stored as percentages. Bounce rate is bounces divided by visits. Average duration is total visit time divided by visits.

The **N online** badge next to the controls shows how many visitors were active in the last 5 minutes. Click it to open **Realtime**.

### Traffic over time

The **Traffic over time** chart plots **Visitors** and **Pageviews**. Ranges of 48 hours or less are drawn per hour. Longer ranges are drawn per day.

### Breakdown cards

Four cards rank the top 8 values of a dimension. Each card has tabs. Click **More** at the bottom of a card to open the **Metrics explorer**, which lists every dimension in one place with a search box and an **Export CSV** button.

| Card | Tabs |
| --- | --- |
| **Pages** | **Page path**, **Entry URL**, **Exit URL** |
| **Sources** | **Referrer**, **Channel** |
| **Environment** | **Browser**, **OS**, **Device** |
| **Location** | **Country**, **Region**, **City** |

In the **Metrics explorer**, **Page path** can also be sorted by **Views**, **Visitors** and **Avg time**, and **Language** is available too.

Below the cards:

- **Visitors by country** is a map.
- **Custom events** lists your most frequent custom events. See [Track events](/docs/events).
- **Traffic** shows pageviews by day of week and hour. Hours are in UTC.

### Channels

The **Channel** tab groups every pageview into one channel. The first rule that matches wins.

| Channel | Rule |
| --- | --- |
| **Paid** | The URL has a `gclid` or `msclkid` parameter, or `utm_medium` is `cpc`, `ppc`, `paid`, `paidsearch`, `cpm`, `display` or `banner`. |
| **Email** | `utm_medium` is `email`, `e-mail` or `newsletter`. |
| **Social** | The URL has an `fbclid`, `ttclid` or `twclid` parameter, or `utm_medium` is `social`. |
| **Organic search** | `utm_medium` is `organic` or `seo`. |
| **Direct** | There is no referrer. |
| **Organic search** | The referrer is Google, Bing, Yahoo, DuckDuckGo, Baidu, Yandex or Ecosia. |
| **Social** | The referrer is Facebook, Instagram, Twitter or x.com, LinkedIn, Reddit, YouTube, TikTok or Pinterest. |
| **Referral** | Any other referrer. |

## Date ranges, comparison and time zone

Use the date picker in the page header.

- Presets: **Last 24 hours**, **Last 7 days**, **Last 30 days**, **Last 90 days**. **Last 24 hours** is a rolling window. The others are calendar days in the website's time zone.
- **Custom**: enter a **Start** and an **End**, then click **Apply**. **End must be after start.**
- The choice is remembered per website for as long as the browser tab is open. Until you pick one, **Overview**, **Performance**, **Compare**, **Session replays** and **Heatmaps** show **Last 24 hours**. **Goals**, **UTM traffic**, **Funnel**, **Journeys**, **Retention** and **Stickiness** show **Last 30 days**.

The website's time zone is set in **Settings** with **Site timezone**. Calendar presets, chart labels and email digests use it for every team member.

### Compare with another period

On **Overview**, open the filter menu (it shows **All visitors**) and tick **Compare period**. A **VS** menu appears next to the date picker.

| Option | The comparison period |
| --- | --- |
| **Previous period** | The same length, ending where the selected range starts. |
| **Same period last year** | The selected range shifted back 365 days. |

Each headline number then shows the comparison value under it. Click **Open full compare report** for the **Compare** page.

## Filter by segment or cohort

The filter menu on **Overview** also lists your saved segments. Pick one to restrict every number on the page to the visitors who match it. A banner reads **Segment filter: NAME** with a **Clear segment filter** button.

A cohort filter works the same way. Open a cohort from **Cohorts** with **Open in overview** and the banner reads **Cohort filter: NAME** with **Clear cohort filter**.

Report pages (**Goals**, **UTM traffic**, **Compare** and the product reports) have a segment menu as well. To create segments and cohorts, see [Segments](/docs/product-analytics#segments) and [Cohorts](/docs/product-analytics#cohorts).

## Realtime

**Realtime** shows what is happening on the site now. A **Live** badge means the page receives updates every second. **Reconnecting...** means it has fallen back to polling.

- **Online now**: visitors active in the last 5 minutes.
- **Pageviews** and **Visitors** for the last 30 minutes, with the number of visits.
- **Top page** and how many of the online visitors are on it.
- A globe with the locations of online visitors.
- **Live sessions**: one row per online visitor. Click a row to open that session.
- **Active pages**, **Referrers** and **Countries** for the visitors online.

When nobody is on the site, the page says **Nobody here right now** and shows the last 30 minutes instead.

## Performance

**Performance** reports Core Web Vitals measured in your visitors' browsers by the tracking script. Each page load sends one set of measurements, when the page is hidden or after 10 seconds, whichever comes first.

Values are shown at the **p75**: 75% of page loads were at or below the number. A page is rated **Good** when at least 75% of its loads were good, **Poor** when more than 25% were poor, and **Needs improvement** otherwise.

| Metric | Good up to | Poor from |
| --- | --- | --- |
| **LCP** Largest Contentful Paint | 2.5 s | 4 s |
| **INP** Interaction to Next Paint | 200 ms | 500 ms |
| **CLS** Cumulative Layout Shift | 0.1 | 0.25 |
| **FCP** First Contentful Paint | 1.8 s | 3 s |
| **TTFB** Time to First Byte | 800 ms | 1.8 s |

Click a metric in the strip to chart it. The chart shows the p75 per hour or per day with a line at the Good threshold. Below it, the **Breakdown** table splits **LCP**, **INP** and **CLS** by **Page**, **Browser** or **Country**, with the number of **Samples**.

If the page says **No Web Vitals in this period**, widen the date range. Measurements appear once visitors open pages with the script installed.

## UTM traffic

**UTM traffic** shows which campaigns bring visitors. It reads the standard tags on the landing URL:

```text
https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=spring_sale
```

The page shows **Tagged pageviews** and the **Top source**, **Top medium** and **Top campaign**. Cards list every value of `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` and `utm_term` by pageviews. Pageviews without a tag are grouped as **Untagged**. With no tagged traffic the page shows **No UTM-tagged traffic in this period**.

You can also filter by campaign: create a [segment](/docs/product-analytics#segments) with the conditions **UTM source**, **UTM medium** or **UTM campaign**.

## Goals

A goal counts one custom event against a target that resets every day, week or month. It needs an event that your site already sends, see [Track events](/docs/events).

1. Open **Goals** and click **New goal**.
2. Pick the **Event name**.
3. Enter the **Target count**, for example `100`.
4. Choose when it **Resets**: **Daily**, **Weekly** or **Monthly**. Daily goals count from midnight UTC. Weekly goals count from Monday at midnight UTC. Monthly goals count from the 1st, in UTC.
5. Click **Create goal**.

Saving a goal for an event that already has one replaces it.

Each goal shows its **Progress**, a **Status** and **Completions** and **Conversion rate** for the selected date range. The status is **Reached**, **On track** or **Behind**, based on how many completions you would expect by now at an even pace. The conversion rate is the share of visitors who completed the goal. It is available for up to 10 goals. **Events without a goal** lists other custom events, so you can turn one into a goal.

Members with view-only access see goals but cannot create, edit or delete them.

## Compare

**Compare** puts two periods side by side. It uses the same date range as **Overview**. Its **VS** menu chooses **Previous period** or **Same period last year**, and **Open full compare report** on **Overview** carries your choice over.

- The five headline numbers show the current value, the change, and the **Previous** value.
- A line chart overlays **Current** and the comparison period, for **Visitors** or **Pageviews**.
- **By dimension** ranks one dimension (such as **Page path**, **Channel** or **Country**) in both periods, with the change for each row. **New** marks values that did not appear before.

## Share a read-only link

A share link shows a website's overview to people without an account.

1. Open the website's **Share links** page.
2. Click **Create share link**.
3. Copy the link, which looks like `https://flareboard.dev/share/LONG_RANDOM_ID`.

Anyone with the link sees the five headline numbers, a pageviews chart and the four breakdown cards, read-only and without signing in. Viewers can switch between **24 hours**, **7 days**, **30 days** and **90 days**. Links created here do not expire. Click **Revoke** next to a link to stop access at once. Public share links are limited to 60 requests per minute per IP address.

Share links show aggregate statistics only. Do not create one if the numbers must stay private.

## Export to CSV

The **Export** menu on **Overview** downloads a CSV of the selected range. It applies the segment or cohort filter you have active.

| Option | Contents | File name |
| --- | --- | --- |
| **Browsing** | Pageviews only | `WEBSITE_ID-pageviews.csv` |
| **Events** | Every event, including custom events | `WEBSITE_ID-events.csv` |

Columns: `createdAt`, `sessionId`, `visitId`, `urlPath`, `eventName`, `referrer`, `country`. The file holds the newest 10,000 rows of the range. When older rows were left out, the page says so; narrow the date range to export the rest.

On Flareboard Cloud, export needs the Cloud or Business plan. On the Free plan the **Export** button is disabled, and the API answers `403` with `CSV export requires a paid plan.`

To export from a script, call the same endpoint the console uses, with a personal API key (see [REST API](/docs/api)):

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID/export?type=pageviews&startAt=1760000000000&endAt=1762592000000" \
  -o pageviews.csv
```

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `type` | `pageviews` or `events` | `events` | Which rows to export. |
| `startAt`, `endAt` | Unix time in milliseconds | Last 30 days | The range. |
| `segmentId` | ID | None | Restrict to a saved segment. |
| `cohort` | ID | None | Restrict to a cohort. |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| **Export** is greyed out | The Free plan on Flareboard Cloud. Upgrade to Cloud. |
| Bounce rate looks high | Single-page visits count as bounces. Sites where people read one page and leave have a high rate by design. |
| **Performance** is empty | No page load has reported yet, or the range is too narrow. See above. |
| Share link says it may have expired | The link was revoked or the website was deleted. Create a new link. |
| No data at all | See [Troubleshooting](/docs/troubleshooting). |

## Next steps

- Build funnels, retention and breakdowns in [Product analytics](/docs/product-analytics).
- Watch real visits with [Session replay](/docs/session-replay) and see clicks with [Heatmaps](/docs/heatmaps).
