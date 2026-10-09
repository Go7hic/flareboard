---
title: Product analytics
description: Build trends, funnels, retention, journeys and stickiness in the Flareboard console, and group visitors with segments, cohorts, people and groups.
---

Product analytics answers questions about behavior: where people drop off, who comes back, what path they take. You build each analysis from the events your site sends, so install the script and [send a few events](/docs/events) first. For plain traffic numbers, see [Web analytics](/docs/web-analytics).

There are two places to work:

- **Insights** in the main sidebar is a builder. You pick a website, configure a trend, funnel, retention, lifecycle, stickiness, path or table analysis, and save it to reuse, share or put on a board.
- The website's **Behavior** and **Audience** pages (**Funnel**, **Journeys**, **Retention**, **Stickiness**, **People**, **Groups**, **Segments**, **Cohorts**) are ready-made reports with a smaller set of options.

## Before you start

- The tracking script is installed and your site sends the events you want to analyze. Funnels need custom events such as `signup` and `purchase`. Pageviews need no code.
- To identify people across visits, call `identify()`. See [Identify users](/docs/events#identify-users).
- Members with view-only access can read every report. Creating, editing and deleting insights, segments and cohorts needs edit access.

## Insights

Open **Insights** and choose a website in the header. The list on the left holds the website's saved insights. Click **New insight** to build one.

1. Enter a **Name** and, if you like, a **Description**.
2. Choose the **Type**: **Trend**, **Funnel**, **Retention**, **Lifecycle**, **Stickiness**, **Path** or **Table**.
3. Configure the query. The sections below list the options of each type.
4. Click **Run** under **Preview** to see the result. Insights use a period of 7, 30 or 90 days, which you choose with the buttons above the result.
5. Click **Save insight**. Fix any message under the editor first, for example **A funnel needs at least two steps.**

A saved insight can be opened again, edited, and deleted. The toolbar of a saved insight has **Share** (a read-only link, see below) and **Subscribe** (an email summary on a schedule, which needs the Cloud or Business plan on Flareboard Cloud). Without edit access, **Edit** is shown as **Explore** and you can change the query without saving it.

### Events, pageviews and filters

Most types start from an event picker with these choices:

| Choice | Meaning |
| --- | --- |
| **Custom event** | One of your custom events, or any custom event if you leave the name empty. |
| **Pageview** | A pageview. Narrow it with **Any URL**, **URL is**, **URL contains** or **URL matches regex**. |

Click **Where...** next to an event to add filters that apply to that event only. The **Filters** section applies to the whole insight. Filters combine with AND, and an insight can hold up to 10.

A filter acts on one of three kinds of property:

| Filter on | What it reads |
| --- | --- |
| **Event property** | A property you sent with `track()`. |
| **Person property** | A property you sent with `identify()`. |
| **Page & session** | Built-in values: **Page path**, **Hostname**, **Page title**, **Referrer domain**, the five UTM fields, **Event name**, **Tag**, **Browser**, **OS**, **Device**, **Screen**, **Country**, **Region**, **City** and **Language**. |

Operators: **is**, **is not**, **contains**, **does not contain**, **matches regex**, **does not match regex**, **is set**, **is not set**, **greater than**, **less than** and **between**. The numeric ones work on event and person properties only. **matches regex** supports a limited syntax: literals, `^` and `$`, `.`, `.*`, `.+`, character classes, `\d`, `\w`, `\s` and `|` between whole patterns (up to five).

### Trend

A trend charts how often something happens over time.

- **Series**: up to five. Each is labeled A to E. Click **Add series** for the next one.
- **Aggregation** (per series): **Total count**, **Unique users**, **Unique sessions**, or **Sum of property**, **Average of property**, **Minimum of property**, **Maximum of property**, **Median of property**. The last five need a **Numeric property**, which is a numeric property you send with the event.
- **Formula**: combine the series by letter, for example `A / B * 100`. It supports numbers, `+`, `-`, `*`, `/` and parentheses, and up to 200 characters. Leave it empty to chart the series themselves.
- **Interval**: **Hour**, **Day**, **Week** or **Month**.
- **Breakdown**: split by an **Event property**, a **Person property** or a **Page & session** value. The chart shows the 10 largest values and groups the rest as **Other**.
- **Compare with previous period**: also draws the previous period of the same length.

A saved trend can have alerts: open it and use the **Alerts** panel to be notified by email or webhook when a series crosses a threshold. Alerts are checked hourly.

Example: the share of visitors who sign up. Set series A to the **Pageview** with **URL is** `/pricing`, **Unique users**. Set series B to the custom event `signup`, **Unique users**. Enter the formula `B / A * 100`.

### Funnel

A funnel counts how many people complete a sequence of steps.

- **Steps**: at least 2 and at most 20. Each step is a custom event or a pageview, so you can start a funnel on a landing page. Add steps with **Add step**.
- **Conversion window**: how long people have to finish, from 1 minute to 90 days. The default is 14 days. Choose the number and the unit (**minutes**, **hours**, **days**, **weeks**).
- **Step order**: **In this order** (the default) or **In any order**.
- **Count**: **People** (the default) or **Sessions**.
- **Breakdown**: split the funnel by a property. People are attributed to the value they had at the first step.

The result shows how many entered, how many completed each step, the drop-off between steps, and the average and median time to convert. Click a step to list the people or sessions that **Converted** or **Dropped off** there.

The website's **Funnel** page is a quicker version of the same analysis:

1. Open **Funnel** in the website sidebar.
2. In **Steps**, click **Choose events...** and pick at least two events in the order people should do them. With no steps chosen, the page starts with `signup` then `purchase` if you send both, and otherwise your three busiest custom events.
3. Under **Options** choose **Count** (**Sessions** by default), **Step order** and **Conversion window**. The options run from **Within 1 hour(s)** to **Within 90 days**, which is the default.
4. Optionally add **Filters** or pick a segment.

The page reports **Overall conversion**, **Entered**, **Completed** and **Median time to convert**. Its steps are events only. To use pageviews as steps, build the funnel in **Insights**.

### Retention

Retention shows how many of the people who did something come back to do it again.

- **Cohort: people who did**: the starting event or pageview.
- **Came back to do**: the event that counts as returning. It defaults to the same as the start.
- **Period**: **Day**, **Week** or **Month**.
- **Periods**: how many to show, from 8 to 12.
- **Count**: **People** or **Sessions**.

Each row is a cohort of people who first did the start event in that period. Each column is the share that came back that many periods later.

The website's **Retention** page is a fixed version: weekly pageview retention per session. It shows **Users**, **Week 1 retention**, **Week 2 retention** and **Week 4 retention** above a **Cohorts** table that you can show as **Percentage** or **Count**. It needs pageviews across at least two weeks.

### Lifecycle

Lifecycle splits the people active in each interval into four groups.

| Group | Meaning |
| --- | --- |
| **New** | Seen for the first time in this interval. |
| **Returning** | Active now and in the previous interval. |
| **Resurrecting** | Active now, not in the previous interval, but seen before. |
| **Dormant** | Active in the previous interval but not now. Drawn as a negative count. |

Choose one **Event** (or pageview), the **Interval** and **Count** (**People** or **Sessions**). Lifecycle is only available in **Insights**.

### Stickiness

Stickiness shows how many days in the selected range people were active. Choose an **Event** (a custom event or a pageview; leave the custom event name empty to count any custom event) and **Count** (**People** or **Sessions**) in **Insights**.

The website's **Stickiness** page adds a summary: the number of people or sessions, **Avg active days**, **Active 2+ days**, and **Actor days**. A table lists how many were active for 1 day, 2 days and so on.

### Path

Path shows where visitors go next. In **Insights**, enter an optional **Path prefix** such as `/pricing` to start from that page. Leave it empty to see paths from every starting page.

The website's **Journeys** page draws the paths as columns:

1. Open **Journeys**.
2. Pick **Steps shown**, from 2 to 7. The default is 5.
3. Click a page in a column to follow the visitors who went there. Click **Clear selection** to start again.

Each column shows the pages visitors reached at that step and the **drop-off** from the previous step. The report reads the most recent 5,000 visits in the range, so for very busy sites, narrow the date range to look at a specific period.

### Table

Table ranks one dimension by count. Choose **Page**, **Event**, **Browser**, **Country** or **Channel**.

### Share and subscribe

- **Share** opens a dialog to create a read-only link for the insight. Choose when the link **Expires**, then click **Create link**. Viewers see the results only, never the saved query or its filters. Click **Revoke** to stop access.
- **Subscribe** emails a summary of the insight on a schedule. Choose a **Frequency** (**Daily** or **Weekly**), a day and time, and up to the allowed number of **Recipients**. On Flareboard Cloud this needs the Cloud or Business plan.

## Segments

A segment is a saved filter that you can apply to reports. Open **Segments** in the website sidebar.

1. Click **Create segment**.
2. Enter a **Name**, for example `US visitors on mobile`.
3. Under **Filter conditions** add one row per condition. Pick a field, an operator and a **Value**. Visitors match when every condition is true.
4. Optionally add **Event and person properties** filters.
5. Click **Save**.

Fields: **Page path** (the only one that can use **contains**; the rest use **equals**), **Referrer**, **Browser**, **OS**, **Device**, **Country**, **Region**, **City**, **Language**, **Event name**, **UTM source**, **UTM medium**, **UTM campaign**, **Hostname** and **Tag**. Click **Edit JSON directly** to edit the rules as JSON.

Once saved, pick the segment from the filter menu on **Overview**, **Compare** and the report pages. **Open in overview** on the **Segments** page jumps straight to a filtered overview. Each segment shows its matching visitors, visits, pageviews and bounce rate for the selected range.

## Cohorts

A cohort is a group of people defined by what they did. Open **Cohorts**.

1. Click **Create cohort**.
2. Enter a **Name**, for example `Signed up`.
3. Under **Conditions (all must match)**, pick **Event name**, **Page path** or **Any event** for the first condition. Choose **equals** or **contains** and a value. **Any event** needs at least one property filter instead of a value. Under the first condition you can add property filters to narrow it. Click **Add condition** to require more events or pages. Extra conditions are **Event name** or **Page path** only.
4. Set the **Activity window**. Only activity inside it counts toward membership. The default is the last 30 days.
5. Click **Save**.

A cohort page shows its **Members** and how many were active in the period. **Open in overview** applies the cohort as a filter on **Overview**.

## People

**People** lists the identified users and anonymous visitors seen in the date range. It shows the 100 most recently active. Search by name, email or ID to find anyone else, and filter with **Identified** or **Anonymous**.

Click a person to see their **Sessions**, **Visits**, **Pageviews** and **Events**, their **Properties**, recent sessions and recent activity. **Properties** are the traits sent with `identify()`. With edit access, click **Edit properties**, change the JSON object, and click **Save properties**.

Visitors stay anonymous until your code calls `identify()`. See [Identify users](/docs/events#identify-users). Only store properties you are happy to keep: ids and plan names, not passwords.

## Groups

**Groups** analyzes accounts, organizations or workspaces. Send group membership from your site:

```html
<script>
  flareboard.group('account', 'acme', { name: 'Acme', plan: 'team' })
</script>
```

Then open **Groups**, choose a **Group type** (for example `account`), and see each group's **People**, **Sessions**, **Pageviews**, **Events** and **Last seen**. Click a group for its **Group properties**, recent sessions and activity. More in [Groups](/docs/events#groups).

## Check that it works

- A funnel with no data usually means a step name does not match what your site sends. Pick names from the list in **Choose events...**, which shows the custom events your site has sent.
- The list is empty until the site has sent at least one custom event. See [Track events](/docs/events).
- Press **Run** after changing a query in **Insights**, and check for a message under the editor that blocks the preview.

## Next steps

- Watch the sessions behind a funnel drop-off with [Session replay](/docs/session-replay).
- Put insights on a board: [Boards and reports](/docs/boards-reports).
