---
title: Boards, reports and alerts
description: Build boards from saved insights, share them with a link, email reports on a schedule, get alerts when a metric moves, and keep notes with notebooks and annotations.
---

This page covers the pieces you use to share what the data says: **Boards** (dashboards of saved insights and site stats), **Reports**, shared links, email reports, alerts on metrics, **Notebooks** and **Annotations**.

## Before you start

- A website with data. See the [Quickstart](/docs/quickstart).
- At least one saved insight if you want insight widgets on a board. Open **Insights**, click **New insight**, build it and click **Save insight**. See [Product analytics](/docs/product-analytics).
- Editing needs edit access to the website. With read-only access the controls are disabled.
- Email reports and email subscriptions need a paid plan (Cloud or Business) on Flareboard Cloud. Self-hosted installs have every feature, but email only works when your deployment has email sending set up. See [Plans and limits](/docs/plans-limits).

## 1. Boards

Open **Boards** in the main navigation. A board is a grid of widgets that you can open any time and share.

### Create a board

1. Click **New board**.
2. Pick a way to start:
   - **Start from a template**: choose a website and click **Use template**. Flareboard creates the template's insights on that website and lays them out on a new board right away. The templates are **Product analytics**, **Web analytics** and **Revenue**.
   - **Blank board**: enter a **Board name**, choose a **Board range**, add widgets, then click **Create board**.

### Widgets

Each widget is one of:

- **Site stats**: headline numbers and a trend for one website.
- **Insight**: a saved insight. Click **Add insight widget** and pick one.

Give a widget an optional **Label** and a **Width**: **Small**, **Medium**, **Large** or **Full width** (on a 12-column grid). On the board, drag the grip to reorder widgets, and drag the right edge or pick a size to resize them. Click **Edit board**, change the widgets and click **Save board** to change what a board holds.

### Date range and filters

A board has a range of **Last 24 hours**, **Last 7 days**, **Last 30 days** or **Last 90 days**. You can also add board filters with **Add board filter**. The range and the filters apply to every insight widget on the board. Site stats widgets use the range only.

Changes you make to the range or filters while viewing are an unsaved view that you can share through the page address. Click **Save as board default** to keep them, or **Reset** to go back to the saved ones.

### Share a board

Click **Share board**, choose **Expires** (**Never expires**, or in 7, 30 or 90 days) and click **Create link**. Anyone with the link can view the board read-only at `https://flareboard.dev/share/<slug>`, without signing in. Shared views show results only, never the saved query or its filters. Links are rate limited. Click **Revoke** next to a link to stop it working immediately. The **Copy view link** action in the **More actions** menu copies the address of your current view, including an unsaved range and filters. That address needs a sign-in, unlike a share link.

### Email a board on a schedule

Open **More actions**, then **Subscribe**. Enter **Recipients** (up to 10 addresses, separated by commas), choose **Frequency** (**Daily** or **Weekly**), the **Day** for weekly mails and the **Time**, then click **Subscribe**. Flareboard emails a summary of the board with key numbers and their change against the previous period. A board or insight can have up to 10 subscriptions. A board's schedule uses your browser's time zone by default. The subscription list shows the next send, the last send and a **Paused** state. This needs a paid plan (Cloud or Business).

You can also subscribe to one saved insight with **Subscribe** on the **Insights** page. Its schedule uses the website's time zone by default.

## 2. Reports

Open **Reports**. Choose a website, then open one of the report types: **Funnels**, **Retention**, **Journeys**, **Attribution**, **Breakdown**, **Web vitals**, **UTM campaigns**, **Revenue**, **Cohorts** or **Goals**. Click **Save report** to keep the report type with its settings (for example funnel steps, or an attribution model) under **Saved reports** for that website. Opening a saved report goes back to the report with the same settings.

## 3. Email reports for a website

For a regular digest of a whole website:

1. Open **Websites**, then the website's **Settings**.
2. Find **Email reports**, and turn on **Enable email reports**.
3. Choose a **Frequency** (**Daily**, **Weekly** or **Monthly**) and enter **Recipient email(s)**, separated by commas.
4. Save.

The email has pageviews, unique visitors, sessions and bounce rate, the top 10 pages, the top 5 referrers, and a comparison with the previous period. It goes out at 08:00 in the website's time zone: every day, on Mondays for weekly reports and on the 1st of the month for monthly ones. Flareboard skips a send when the period has no pageviews and no sessions. Email reports need a paid plan (Cloud or Business).

## 4. Alerts on a metric

An alert watches one line of a saved trend insight and sends an email or a webhook when it crosses a threshold.

1. Open **Insights** and select a saved trend insight.
2. In **Alerts**, click **New alert**.
3. Fill in:
   - **Name**.
   - **Series**: the line to watch (`A` to `E`, or `formula`).
   - **Check every**: **Hour**, **Day** or **Week**.
   - **Condition**: **Value is above**, **Value is below**, **Increases by more than (%)** or **Decreases by more than (%)**.
   - **Threshold** (or **Percent change**).
   - **Notify via**: **Email** with an address, or **Webhook** with a URL.
4. Click **Create alert**.

Flareboard compares the last complete interval, in the website's time zone, with your threshold. Alerts are checked once an hour, and each interval is checked and sent at most once. A percent change compares with the interval before it, and no alert is sent when that earlier interval was zero. **Snooze…** pauses an alert for a day or a week, and **History** lists past checks and whether a message was sent. A website can have 20 insight alerts.

A webhook alert is a `POST` with a JSON body:

```json
{
  "type": "insight_alert",
  "websiteId": "YOUR_WEBSITE_ID",
  "alertName": "Signups dropped",
  "insightName": "Weekly sign-ups",
  "condition": "decrease_above",
  "threshold": 20,
  "value": 41,
  "previousValue": 62,
  "series": "Sign-ups",
  "intervalStart": 1760000000000,
  "intervalEnd": 1760604799999,
  "insightUrl": "https://flareboard.dev/insights?insight=INSIGHT_ID"
}
```

Webhook URLs must be public `http` or `https` addresses. Private, loopback and internal hosts are refused, and redirects are not followed.

Other alerts live where their data is: [error alert rules](/docs/error-tracking) and [log alert rules](/docs/logs-traces#5-alert-on-log-volume).

## 5. Notebooks

Open **Notebooks** to write up findings. A notebook belongs to a website and holds up to 100 blocks:

- **Text**: Markdown with headings, bold, italic, lists and links.
- **Insight**: a live saved insight from the same website, with its own date range.
- **Session replay**: a link to a session by **Session ID**.

Click **New notebook**, enter a **Title**, use **Add text**, **Add insight** and **Add replay link**, and save. Everyone with access to the website can read it. Editing needs edit access.

## 6. Annotations

Annotations mark moments on the timeline so metric changes have context. Open the website, then **Annotations** (under **Growth**), and click **New annotation**. Enter a **Title** (up to 160 characters), an optional description (up to 1,000 characters), a **Category** (**Note**, **Release**, **Campaign**, **Incident** or **Experiment**) and **Happened at**, then click **Create annotation**. The page lists annotations by month. Click one to edit it.

## Check that it works

1. Create a board from a template and open it. Widgets fill with data for the board's range.
2. Click **Share board**, create a link, and open it in a private browser window. You see the board without signing in.
3. For an email report, save the settings and confirm the recipients. The next email goes out at 08:00 on the schedule above.

## Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| A widget says **This insight could not be calculated.** | The insight was deleted, or its query no longer runs | Edit the board and replace the widget |
| **Email subscriptions require a paid plan.** or **Email reports require a paid plan.** | You are on the Free plan on Flareboard Cloud | Change plan. See [Plans and limits](/docs/plans-limits) |
| **A website can have at most 20 insight alerts.** | The alert limit is reached | Delete an alert you no longer use |
| An alert never fires | The condition was not met in a complete interval, or a percent change had a previous value of zero | Check **History** for the last values |
| A shared link shows **This link may have expired.** | The link expired or was revoked | Create a new link |
