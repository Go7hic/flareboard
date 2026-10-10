---
title: Surveys
description: Ask visitors short, multi-question surveys on your site or on a hosted page, and read NPS, CSAT and text answers next to the sessions they came from.
---

A survey shows one question at a time in a small widget on your site, or on a hosted page you share by link. Answers are stored with the page, session and visitor they came from, so you can jump from a response to the session.

## Before you start

- **Plan:** surveys need the Cloud or Business plan. On the Free plan the API answers `403` with "Surveys require a paid plan." Self-hosted installs have every feature without plan limits.
- **Role:** you need an account that can edit the website. View-only accounts can read results.
- **Tracking script:** to show the widget on your site, install the [tracking script](/docs/install/script) or the [npm package](/docs/install/npm). The hosted page works without it.
- **PostHog SDKs:** surveys created in Flareboard are not served through PostHog SDKs. Flareboard's config for `posthog-js` turns surveys off, so set `disable_surveys: true` there. Use the Flareboard tracker or the hosted page.

## 1. Create a survey

1. Open your website, then **Surveys** in the sidebar.
2. Click **Create survey**.
3. Pick a template: **Blank survey**, **Net promoter score**, **Customer satisfaction** or **Open feedback**. You can change every question afterwards.
4. Fill in the **Name** and the settings below, then click **Create survey**.

The dialog has a live **Preview**. Branching works in the preview and nothing is sent.

### Questions

A survey has up to 10 questions, shown one at a time. Each question has a type.

| Type | What the visitor sees | Notes |
| --- | --- | --- |
| **Open text** | A text box | Optional **Placeholder**. Answers are cut at 2,000 characters. |
| **Rating** | A row of buttons | **Scale** of 1 to 5, 1 to 10 or NPS (0 to 10), with optional **Low end label** and **High end label**. |
| **Single choice** | Radio buttons | Two to 20 options, one per line. Unique, ignoring case. |
| **Multiple choice** | Checkboxes | Same options rules. |
| **Link / call to action** | A button that opens a link | Needs a full `http(s)` **Link URL** and optional **Button text**. Always skippable. |

For the two choice types, tick **Add an "Other" option with free text** to add a free-text answer (up to 500 characters). Each question can also have a **Description (optional)** and an **Optional (respondents can skip)** switch.

### Branching

Under **Branching**, click **Add rule** to decide what comes next. A rule reads "If **Any answer** / **Score between** / **Answer is**, **Go to** a later question or **End survey**." Rules are checked in order, and when none matches the visitor sees the next question. A rule can only jump forward.

The **Net promoter score** template asks the 0 to 10 question and then "What is the main reason for your score?". The **Customer satisfaction** template asks a 1 to 5 question and ends the survey when the rating is 4 or 5.

### Where and when it shows

These settings are under **Targeting and limits** and apply to the widget on your site.

| Setting | What it does |
| --- | --- |
| **Trigger path** | Show only on this path and below it. `/pricing` matches `/pricing`, `/pricing?x=1` and `/pricing/team`. Empty means any page. |
| **Trigger event** | Show only right after your code tracks this event with `flareboard.track()`. Empty means the survey appears on page load. |
| **Display delay (seconds)** | Wait 0 to 60 seconds before showing. |
| **Display rules** | Extra conditions, one per line. See [Display rules](#display-rules). |
| **Show to % of people** | The share of visitors who can see the survey. The same visitor always gets the same answer. Default 100. |
| **Frequency** | **Once per person**, or **Repeat after an interval** with **Repeat every (days)** from 1 to 365. |
| **Stop after responses** | Stop showing the survey after this many completed responses. |
| **Starts**, **Ends** | A schedule. The survey is hidden before the start and after the end. |

Only one survey is on screen at a time. The tracker takes the first matching survey that the visitor is eligible for, oldest first, and only the 10 oldest active surveys of a website are sent to the page. Visitors who opted out with `flareboard.optOut()` never see a survey.

#### Display rules

Type one rule per line as `field operator value`. The form accepts these fields: `path`, `event`, `property`, `language`, `country`, `device` (write `property.KEY` for a property). It accepts these operators: `equals`, `contains`, `starts_with`, `ends_with`, `not_equals`, `not_contains`, `exists`, `not_exists`.

Every rule must match. Each field is compared with:

| Field | Value |
| --- | --- |
| `path` | The current page path. |
| `language` | The browser language, such as `en-US`. |
| `device` | `mobile`, `tablet` or `desktop`, the same labels as the **Device** breakdown. |
| `country` | The visitor's country as a two-letter code, such as `US` or `DE`. Flareboard resolves it on the server; country rules never reach the browser. |
| `event` | The name of the event that triggered the check. On page load there is no event. |
| `property.KEY` | That property of the `flareboard.track()` call that triggered the check. |

Comparisons ignore case. A value that is not known (no event on page load, a property the call did not send) matches only `not_exists`, `not_equals` and `not_contains`. Surveys with `event` or `property` rules are checked again after each `flareboard.track()` call.

```text
path contains /checkout
device equals mobile
country equals US
event equals checkout_started
property.plan equals pro
```

### When the widget appears

The tracker checks for a survey once, shortly after the page loads, and again after every event you track with `flareboard.track()`. With a **Trigger event**, the survey can only appear after that event. In a single-page app the check does not repeat on its own after a route change. Call `window.flareboard.showSurvey()` after the route changes to check again.

Visitors close the widget with the **×** button or the Escape key. If they already answered a question, the partial answers are saved as a partial response. When a visitor finishes, the tracker sends a `survey_response` event with the property `surveyId`, which you can use in funnels and cohorts.

### Appearance

Under **Appearance** choose the widget **Position** (**Bottom right**, **Bottom left**, **Top right**, **Top left** or **Center**), the **Color scheme** (**Light**, **Dark** or **Match visitor's system**), the **Button color**, the **Submit button text**, and whether to **Show a thank-you message** and its text. The same settings apply to the hosted page.

### Hosted link

Under **Hosted link**, tick **Enable the hosted survey page**. Anyone with the link can answer, even if your site does not run the tracking script. The link is `https://flareboard.dev/s/SURVEY_ID`, or `https://flareboard.dev/s/YOUR_SLUG` if you set a **Custom link (optional)** of 3 to 64 lowercase letters, digits and dashes. Add `?distinct_id=USER_ID` to attribute the response to a known user. Self-hosters use their own dashboard address.

## 2. Read the results

Open the survey and use its three tabs.

- **Results** shows the headline numbers: **Responses**, **Completion rate**, and a score from the first rating question (**NPS**, **CSAT** as the share of 4 and 5 ratings, or **Average rating**). Below that, each question has its own breakdown: the score distribution with promoters (9-10), passives (7-8) and detractors (0-6), choice counts, link clicks, and for text answers a **Sentiment** split (**Positive**, **Negative**, **Neutral**). **Page feedback** lists the pages that produced responses. **Responses per day** charts the trend once there are two days of data, and each question shows how many people left after it.
- **Responses** lists the latest 100 responses in the current filter, each with a link to its session. Answers carry the page and session they came from.
- **Setup** repeats the survey's targeting in one place.

Narrow the results with the date range, a status of **Complete** or **Partial**, a text search and a page filter. Click **Export CSV** for the responses in the filter (up to 50,000, oldest first), one column per question. Per-question results use the latest 20,000 responses. Totals and the trend count everything.

A response is **Complete** only when the visitor reaches the end of the survey through its branching. Closing the widget early leaves a **Partial** response. A response limit counts completed responses only.

Free-text answers are stored as typed. Tell visitors not to enter passwords, payment details or other personal data, and keep such questions out of your survey.

Use **Disable** to stop showing a survey without deleting it, and **Edit** to change it. **Delete** removes the survey and all of its responses.

## Use the API

The console uses these endpoints on `https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID`. Send `Authorization: Bearer YOUR_API_KEY`. Reads need the **Read** scope and writes need **Write**.

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/surveys` | List surveys. |
| `POST` | `/surveys` | Create one. |
| `PATCH` | `/surveys/SURVEY_ID` | Update it, for example `{"enabled":false}`. |
| `DELETE` | `/surveys/SURVEY_ID` | Delete it and its responses. |
| `GET` | `/surveys/SURVEY_ID/responses` | Per-question results and the latest 100 responses. Filters `startAt`, `endAt` (ms), `status` (`complete` or `partial`), `q`, `path`. |
| `GET` | `/surveys/SURVEY_ID/export` | CSV with the same filters. |
| `GET` | `/surveys/feedback` | A feedback inbox across surveys. Filters `sentiment` (`positive`, `negative`, `neutral`), `theme` (`price`, `bug`, `confusion`, `feature_request`, `support`, `performance`, `other`) and `q`. |

Create an NPS survey on the pricing page:

```bash
curl -X POST https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID/surveys \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"template":"nps","triggerPath":"/pricing","sampleRate":50}'
```

The answer is `201` with the survey, including its `id` and `questions`. `template` is `nps` or `csat`. Through the API both create only the rating question, without the follow-up question the console templates add. Without a template, send `name` and `questions` (up to 10) instead.

### Build your own survey UI

You can render surveys yourself, for example in a mobile app. Both calls go to your ingest address.

```bash
curl "https://t.flareboard.dev/api/surveys?website=YOUR_WEBSITE_ID"
```

The answer is `{"surveys":[...]}`: the active surveys in the shape the tracker uses, with `questions`, `appearance`, `sampleRate` and `repeatIntervalDays`. Schedules and response limits are already applied. It is cached for 60 seconds and lists at most 10 surveys. Send each response to:

```bash
curl -X POST https://t.flareboard.dev/api/surveys/response \
  -H "Content-Type: application/json" \
  -d '{"website":"YOUR_WEBSITE_ID","surveyId":"SURVEY_ID","answers":{"QUESTION_ID":9},"source":"api"}'
```

`answers` maps a question id to a value: text for open text and single choice, a whole number for a rating, an array for multiple choice, and `"clicked"` for a link. The answer is `{"ok":true,"responseId":"...","completed":true}`. Send `"completed": false` with your own `responseId` (a UUID) to save a partial response, then post again with the same `responseId` to finish it. Bodies over 32 KB are refused with `413`, and a survey that is closed answers `409`. The full field list is in the [ingest reference](/docs/reference/ingest-api).

## Check that it works

1. Create a survey from the **Open feedback** template with no trigger path, and leave **Show to % of people** at 100.
2. Open your site in a private window. After about a second the widget appears at the position you chose.
3. Answer it. Reload the survey in the console: **Responses** shows 1 and the **Responses** tab lists your answer with a link to your session.

If the widget does not show again when you test twice, that is expected: with **Once per person** the survey is remembered in the browser. Use a private window or clear the key `flareboard.survey:SURVEY_ID` from local and session storage.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| The widget never appears | The survey is **Disabled**, outside its schedule, past its response limit, or the visitor already saw it. Also check **Trigger path**, **Trigger event**, **Show to % of people**, and that the tracking script runs on the page. |
| It never appears with a display rule | The tracker only understands `path` and `language` rules. Replace others with **Trigger path** or **Trigger event**. |
| It does not appear after a route change in a single-page app | The tracker checks on load and after tracked events. Call `window.flareboard.showSurvey()` after the route change. |
| A survey you created recently is missing | Only the 10 oldest active surveys are sent to the page. Disable surveys you no longer need. |
| A change in the console does not show on the site | The tracker config is cached for about a minute. |
| Responses are refused with `429` | Responses are limited to 30 requests per minute per IP, and 5 per hour per IP for each survey. Offices behind one IP can reach this. |
| The API returns `403` "Surveys require a paid plan." | The website's owner is on the Free plan. See [Plans and limits](/docs/plans-limits). |

## Next steps

- Show a survey to people who got a variant with a [feature flag](/docs/feature-flags) and an [experiment](/docs/experiments).
- Watch what a respondent did in [Session replay](/docs/session-replay).
- Track the events that trigger surveys in [Track events](/docs/events).
