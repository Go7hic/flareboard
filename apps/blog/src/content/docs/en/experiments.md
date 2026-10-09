---
title: Experiments
description: Test whether a change improves a metric. Split visitors with a feature flag, pick a primary metric, read lift and the chance to beat control, then ship the winner.
---

An experiment compares the variants of a [feature flag](/docs/feature-flags) on a metric you choose, such as sign-ups or revenue per user. Flareboard counts who saw which variant, measures what each group did afterwards, and tells you when a variant is clearly better or when to keep waiting.

## Before you start

- **Plan:** experiments need the Cloud or Business plan, like feature flags. On the Free plan the API answers `403` with "Experiments require a paid plan." Self-hosted installs have every feature without plan limits.
- **Role:** you need an account that can edit the website. View-only accounts can read results.
- **A flag that splits visitors.** Create it first and make sure it serves `control` to part of them (see [Set up the flag](#set-up-the-flag)).
- **Exposures.** Your code must read the flag with `getFeatureFlag`, `isFeatureEnabled` or `useFeatureFlag` on the page where the change appears. See [Read a flag in the browser](/docs/feature-flags#2-read-a-flag-in-the-browser).
- **A goal event.** The metric needs an event that you track, for example `signup_completed`. See [Track events](/docs/events).

## Set up the flag

The experiment compares every variant the flag serves against `control`.

- The flag must serve `control`: add a variant named `control`, or keep the variant weights under 100 so the rest goes to `control`. If the flag serves no `control` at all, results show **Fix setup** with the warning **Missing control variant**.
- A flag without variants works too: visitors inside the rollout see `test` and everyone else sees `control`. Both groups record exposures because every read of the flag is recorded.
- If you read flags on a server with a PostHog SDK, give the flag explicit variants, including one named `control`. Exposures whose response is `false` or empty are not counted as a group, so the plain on and off values of a boolean flag do not give you a control group.
- Identify your users with [identify()](/docs/events#identify-users). Flareboard counts a user by their distinct id, and falls back to the session id for anonymous visitors, so an anonymous visitor may be counted again on a later visit.

## 1. Create the experiment

1. Open your website, then **Experiments** in the sidebar.
2. Click **Create experiment**.
3. Fill in the form and click **Create experiment**. New experiments start as drafts.

| Field | What it does |
| --- | --- |
| **Name** | Required, up to 120 characters. |
| **Feature flag** | The flag that splits users into variants. Under the field you see its variants and weights. |
| **Hypothesis** | What change you are testing. Optional, up to 500 characters. |
| **Primary metric** | The metric that decides the experiment. |
| **Secondary metrics** | Up to five guardrails and side effects to watch. Click **Add secondary metric**. |
| **Minimum detectable effect (%)** | The smallest relative lift worth detecting, from 0.1 to 100. Default 10. It sets the planned sample size. |

Each metric has a **Measure**, an **Event** and sometimes a **Numeric property**.

| **Measure** | What each user contributes |
| --- | --- |
| **Conversion (did the event)** | 1 if the user fired the event after being exposed, otherwise 0. Results show a rate. |
| **Count per user** | How many times the user fired the event. Results show the mean. |
| **Sum of a property per user** | The sum of a numeric event property over the user's events, 0 if there are none. |
| **Average of a property** | The mean of a numeric event property over the user's events. Only users with at least one event count. |

The event name can be up to 80 characters. The property must be a numeric property of that event.

## 2. Start it

Open the experiment and click **Start**. The experiment is **Running** and the analysis window opens at that moment. Starting an experiment does not change the flag. The flag must be enabled and serving.

| Status | Meaning |
| --- | --- |
| **Draft** | Not started. Results preview exposures since the experiment was created. |
| **Running** | The window started the first time you clicked **Start** and runs until now. |
| **Paused** | Click **Pause** to mark it. The window still runs to now, and the flag keeps serving. |
| **Completed** | Click **Complete** to close the window. Results then cover the fixed window. Clicking **Start** again reopens it and the window runs to now again. |

## 3. How exposure and metrics are counted

- **Unit:** the user's distinct id when the session has one, otherwise the session id.
- **Exposure:** a unit is exposed at its first `$feature_flag_called` event for the experiment's flag inside the window. It belongs to the variant of that first exposure.
- **Metric events:** an event counts when the same unit fires it at or after its first exposure and before the end of the window.
- **Excluded users:** a unit that was exposed to more than one variant is left out of every metric. The page tells you how many.
- **Groups:** every distinct flag response counts as a group, except an empty response and `false`. `control` is the baseline.

## 4. Read the results

Open the experiment. Results are computed from your events each time you open the page.

The callout at the top gives the decision:

| Decision | When |
| --- | --- |
| **No data yet** | No exposures in the window. |
| **Fix setup** | There is no control group, or the traffic split does not match the flag (**Traffic split does not match the flag**, a sample ratio mismatch). Fix this before you trust any number. |
| **Keep collecting** | Not enough data yet for a call. |
| **Ship variant** | Every group has at least 30 users (for a conversion metric, also at least 10 conversions in total) and one variant beats control with statistical significance. |
| **Keep control** | The minimum sample is reached and either the planned sample is reached without a winner, or every variant is significantly worse than control. |

Below it:

- **Users** is the number of analyzed users, with the share per variant.
- **Lift** is the relative change of the leading variant against control.
- **Chance to beat control** is the highest probability, among the variants, of being better than control. Values above 99.9% show as ">99.9%".
- **Planned sample** shows how close you are to the number of users per variant needed to detect your minimum detectable effect, and about how many days are left at the current traffic. The estimate uses 95% confidence and 80% power.
- **Daily results** charts the primary metric, or the new users, per day (UTC). It appears once there are at least two days of data.

Each metric has a table with one row per variant. Switch between two methods with **Frequentist** and **Bayesian**.

| Column | What it shows |
| --- | --- |
| **Variant** | The variant key. `control` is the baseline. |
| **Users** | Users in the group. For an average of a property, **Users with a value**. |
| **Conversion rate** | The metric value. The label is **Mean per user** for a count, **Per user** for a sum and **Average** for an average. Conversions also show converted over total users. |
| **Lift vs control** | The relative change against control. |
| **95% interval** | The interval of the lift. With **Bayesian** the column is **95% credible interval**. |
| **Significance** | **Significant** or **Not significant**, with the p-value. With **Bayesian** the column is **Chance to beat control**. |

The frequentist method uses two-sided tests at 95% confidence: a z-test for conversions and Welch's t-test for means. The Bayesian method gives the posterior chance that each variant beats control, with 95% credible intervals.

**Recent samples** lists the latest exposed users with their variant, page and whether they converted, with a link to each session.

## 5. Ship the winner

When the decision is **Ship variant**, click **Apply winning variant**. Flareboard then:

- sets the winning variant to 100% and every other variant to 0%;
- sets every condition group's rollout to 100% and clears variant overrides;
- enables the flag;
- marks the experiment **Completed**.

The change appears in the flag's **History** as **Experiment winner shipped**. If the flag had no variants, it gets one variant for the winner at 100%. The API refuses with `400` and "Experiment does not have a significant winning variant." when there is no clear winner.

You can also finish an experiment by hand: edit the flag yourself, then click **Complete**. A flag that an experiment uses cannot be deleted until the experiment is deleted.

## Use the API

All endpoints are under `https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID`. Self-hosters use their own API address. Send `Authorization: Bearer YOUR_API_KEY`. Reads need a key with the **Read** scope, and writes need **Write**.

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/experiments` | List experiments. |
| `POST` | `/experiments` | Create one. |
| `GET` | `/experiments/EXPERIMENT_ID` | Get one. |
| `PATCH` | `/experiments/EXPERIMENT_ID` | Update fields or set `status` to `draft`, `running`, `paused` or `completed`. |
| `DELETE` | `/experiments/EXPERIMENT_ID` | Delete it. |
| `GET` | `/experiments/EXPERIMENT_ID/results` | Results with variants, metrics, guidance and the decision. |
| `POST` | `/experiments/EXPERIMENT_ID/apply` | Ship the winning variant. |

Create and start an experiment in one request:

```bash
curl -X POST https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID/experiments \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Checkout redesign",
    "featureFlagId": "YOUR_FLAG_ID",
    "primaryMetric": { "type": "conversion", "event": "purchase_completed" },
    "secondaryMetrics": [{ "type": "property_sum", "event": "purchase_completed", "property": "amount" }],
    "minimumDetectableEffect": 10,
    "status": "running"
  }'
```

Metric `type` is `conversion`, `count`, `property_sum` or `property_mean`. `property` is required for the last two. The answer is `201` with the experiment. The AI tools of the [MCP server](/docs/mcp) can list experiments with their results through `list_experiments`.

## Check that it works

1. Start the experiment.
2. Open your site so that the page reads the flag, then do the action that fires the goal event.
3. Wait a minute and reload the experiment page. **Users** is above 0 and **Recent samples** lists your visit, with **Converted** set to **Yes** if you fired the goal event afterwards.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| **No data yet** | No `$feature_flag_called` event arrived inside the window. Read the flag with `getFeatureFlag` or `isFeatureEnabled`, not only `getFeatureFlagPayload`. Check the flag's **Overview** tab for exposures. |
| **Missing control variant** | The flag serves no `control`. Add a variant named `control`, or lower the variant weights so the rest goes to `control`. |
| **Traffic split does not match the flag** | Users are not split as configured. Check targeting rules, caching, redirects, or flag changes made during the test. |
| Some users are excluded | They were exposed to more than one variant, for example after a change to the flag during the test. Avoid changing the flag while the experiment runs. |
| The numbers changed after you edited the flag | Results are recomputed from the exposures recorded so far each time you open the page. The traffic split check compares against the split the flag had when you clicked **Start**. |
| **Apply winning variant** is missing | The decision is not **Ship variant**, the experiment is already completed, or your account is view-only. |

## Next steps

- Create and manage the flag in [Feature flags](/docs/feature-flags).
- Ask users why with a [survey](/docs/surveys).
- Name your goal events well in [Track events](/docs/events).
