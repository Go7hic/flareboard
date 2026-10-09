---
title: Plans and limits
description: What the Free, Cloud and Business plans include, the monthly allowances and grace, the usage emails, where to see your usage and how to upgrade or cancel. Self-hosted installs have no plan limits.
---

Flareboard Cloud has three plans: Free, Cloud and Business. Each has monthly allowances for the data you send and a longest period it keeps raw data. If you run your own copy of Flareboard, none of this applies. A self-hosted install has every feature and no plan limits.

## Plans at a glance

| | Free | Cloud | Business |
| --- | --- | --- | --- |
| Price | $0 | $19 a month | $99 a month |
| Websites | 1 | Not limited by plan | Not limited by plan |
| Events a month | 100,000 | 1,000,000 | 5,000,000 |
| Session replays a month | Not included | 5,000 | 25,000 |
| Log records and spans a month | 50,000 | 500,000 | 5,000,000 |
| Longest raw data retention | 365 days | 730 days | 1,095 days |
| Session replay | No | Yes | Yes |
| Heatmaps | No | Yes | Yes |
| Email reports | No | Yes | Yes |
| Teams | No | Yes | Yes |
| CSV export | No | Yes | Yes |
| Data warehouse (SQL) | No | Yes | Yes |
| Feature flags and experiments | No | Yes | Yes |
| Surveys | No | Yes | Yes |

Business has the same features as Cloud, with larger allowances and longer retention. Plans advertised without a website limit are still subject to reasonable fair-use limits, as described in the [Terms of Service](https://flareboard.dev/terms).

## What counts toward an allowance

Each allowance is counted per calendar month in UTC and resets on the first day of the next month.

| Allowance | What it counts |
| --- | --- |
| Events | Pageviews, custom events and autocaptured interactions that your websites send. |
| Session replays | Recorded visits. A visit counts once, when its recording starts. |
| Log records and spans | OpenTelemetry logs and traces sent to Flareboard. They are counted apart from events. |

The account that owns the website is charged. For a website in a team, that is the account that created it, and the team's members use the site under that account's plan. If that account is deleted, the website moves to another Owner or Manager of the team, one on a paid plan first. See [Teams and access](/docs/teams).

## Going over an allowance

How Flareboard behaves past an allowance depends on the plan:

- **Free.** Collection of that kind of data stops at the allowance until the month resets. Data sent after that is dropped, not stored.
- **Cloud and Business.** Collection continues past the allowance, up to 20% over it. Then it pauses until the next month. There is no extra charge for the extra usage.

That gives these ceilings:

| | Free | Cloud | Business |
| --- | --- | --- | --- |
| Events | 100,000 | 1,200,000 | 6,000,000 |
| Session replays | Not included | 6,000 | 30,000 |
| Log records and spans | 50,000 | 600,000 | 6,000,000 |

Each kind of data is counted and stopped on its own. Reaching the events ceiling does not stop replays or logs, and the other way round. Data collected before a pause stays available. The check uses a cache of about a minute, so collection can overshoot a ceiling by roughly a minute of traffic.

## Usage emails

Flareboard emails the account owner when a monthly allowance fills up. Each email is sent once per kind of data and month:

| When | What the email says |
| --- | --- |
| 80% of the allowance | You have used most of this month's allowance. |
| 100% of the allowance | The allowance is reached. On Cloud and Business, collection continues up to the ceiling. |
| The ceiling is reached | Collection of that kind of data has paused until the first day of next month. |

If usage jumps straight past a level, only the latest email is sent. On the Free plan the allowance and the ceiling are the same, so you get the 80% email and the pause email.

## See your usage

Open **Billing** in the console. **Usage this month** shows a meter for **Events**, **Session replays** and **Logs & spans**, with the date the allowances reset. Near an allowance the meter says how much is used. Past it, the meter tells you how far collection continues and when it stops. The **Current plan** card lists the features your plan includes and the longest raw data retention.

## Data retention

Raw events, session replays, logs and traces older than the retention period are deleted automatically, about once an hour. The longest period is set by the plan (365, 730 or 1,095 days). To keep data for less time, open **Websites**, then the website's **Settings**, find **Data retention** and enter the days in **Keep raw data for (days)**. Leave it empty to use the plan maximum. Logs and traces are kept for 30 days at most, whatever the plan. Aggregated statistics derived from raw events may be kept for the life of the website.

If an account moves to a plan with a shorter maximum, raw data older than that maximum is deleted.

## Upgrade

1. Open **Billing**.
2. Under **Upgrade**, click **Upgrade to Cloud** or **Upgrade to Business**.
3. From the Free plan, you go to Stripe Checkout to pay. Flareboard does not see your card details.
4. You return to **Billing** with "Subscription updated. Thanks!".

If you already have a paid plan and move to a higher one, the new plan applies right away and Stripe prorates the price difference on your next invoice.

## Cancel or change billing details

Click **Manage billing** on the **Billing** page to open Stripe's billing portal. The button appears once you have a billing account. Cancelling takes effect at the end of the current billing period. After that your account is on the Free plan, and features the Free plan does not include stop working. Your data is not deleted because of the downgrade, except raw data older than the Free plan's retention period. If a payment fails, Stripe retries it for a while: your plan stays, and **Billing** shows **Payment due** until you update your payment method in **Manage billing**. If the payment is not resolved, the subscription can be cancelled and the account moved to the Free plan. Fees are generally not refunded. The [Terms of Service](https://flareboard.dev/terms) have the details.

## Self-hosted installs

A self-hosted Flareboard has no plans, allowances or Billing page. Every feature is available. Raw events and replays are kept indefinitely unless you set **Keep raw data for (days)** on a website. Logs and traces are still kept for 30 days at most. Allowances and the usage emails exist only on Flareboard Cloud. See [Self-host Flareboard](/docs/self-host/deploy).

## Troubleshooting

- **Events stopped arriving.** Open **Billing** and check the **Events** meter. If collection has paused, it resumes on the first day of next month, or when you upgrade.
- **A feature is greyed out or the API answers "... requires a paid plan." (for example "Feature flags require a paid plan.").** It is not in your plan. Replays, heatmaps, email reports, teams, CSV export, SQL, feature flags, experiments and surveys need Cloud or Business. For a team website, the plan of the account that owns it decides: the account that created it, or the teammate it moved to when that account was deleted.
- **"Website limit reached".** The Free plan has one website. Delete one or upgrade.
