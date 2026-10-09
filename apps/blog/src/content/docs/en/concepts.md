---
title: Concepts
description: How Flareboard thinks about websites, project keys, visitors, visits, events, people and retention, and how Cloud and self-hosted installs differ.
---

This page explains the words the console and the docs use. Read it once and the rest of the docs get easier to follow. Each section is short and says where to find the thing in the console.

## Websites and the website ID

A **website** is the unit everything belongs to: its events, visitors, people, feature flags, session replays, errors, logs and settings. You create one under **Websites** with **Add website**, by giving it a **Name** and a **Domain**. The Free plan includes one website.

Every website has a **website ID**, a UUID. The tracking script and the HTTP API use it to decide where data goes. You can copy it from the install snippet in the website's **Settings**:

```html
<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
```

The website ID is not a secret. It is visible in your page source. Anyone who has it can send events to your website, so treat the data as open to that, and use the [project key](#project-key) if you want to be able to cut off a sender.

## Project key

The **project key** is a public key for one website. It looks like `fb_pk_` followed by 24 letters and digits. Use it wherever a website ID is accepted, and as the API key for PostHog SDKs:

- as `data-website-id` in the tracking script;
- as `website` in server-side calls to the [ingest API](/docs/reference/ingest-api);
- as the API key of [PostHog SDKs](/docs/install/posthog);
- as the bearer token or `x-flareboard-key` header when sending OpenTelemetry logs and traces.

It is safe to put in a web page, in the same way the website ID is. Requests that use the key are rate limited per key instead of per visitor IP, which is what you want for servers that send from a few addresses (see [Send events from your server](/docs/install/server)).

To find it, open **Websites**, then the website's **Settings**. The **Project API key** card shows the key with a copy button.

To replace it, click **Rotate key** in the same card and confirm. Flareboard issues a new key and the old one stops working within a minute. Anything still sending with the old key (snippets, PostHog SDKs, servers) is no longer recorded until you update it. Only people who can edit the website see the button.

## Teams

A **team** is a group of people who share websites. Open **Teams** to create one, or to join one with an access code. A website created with **Add team website** belongs to the team: access comes from team membership, not from the person who created it.

Team members have a role: **Owner**, **Manager**, **Member** or **Read-only**. Read-only members can read data but not change it, and people who join with an access code start as read-only. On Flareboard Cloud, teams need the Cloud or Business plan. See [Teams and access](/docs/teams).

## Visitors

A visitor is counted without cookies and without storing the IP address. For each request, Flareboard computes a one-way hash of the visitor's IP address, user agent, the website, a salt and a server secret. The salt changes at the start of each calendar month (UTC). So:

- the same browser on the same network is one visitor for the whole month;
- the same person cannot be linked from one month to the next;
- the IP address is discarded once the request is handled.

### Remember visitors across sessions

If you need to recognize returning browsers across networks and months, turn on **Remember visitors across sessions** in the website's **Settings**, in the **Data collection** card. This is off by default.

With it on, the tracking script creates a random ID, keeps it in the browser's `localStorage` and sends it with each event. Flareboard counts the visitor by that ID instead of the hash. The ID is random, so it is not derived from the IP address or the device. It lasts until the visitor clears the site's data.

Because this stores an identifier on the visitor's device, you may need the visitor's consent first, depending on where your visitors are. Turning the setting off returns to cookieless counting: Flareboard ignores any anonymous ID that still arrives from a browser. A page can also opt out on its own with `data-persistence="false"` on the script tag.

## Visits and sessions

Two words describe time in the data, and they are easy to mix up:

- A **session** identifies one visitor on one website. It is the ID that unique-visitor counts are based on. For an anonymous visitor it comes from the hash above. For an identified user, or when you remember visitors, it comes from the website and the user's distinct ID instead.
- A **visit** is one stay by that visitor.

How a visit is bounded depends on how the data arrives:

| Source | A visit is |
| --- | --- |
| Tracking script | One per browser tab. It lasts up to 30 minutes from its first event. The first event after that opens a new visit. |
| Server events without a visit token | One per clock hour (UTC) for each visitor. |
| PostHog SDKs | One PostHog `$session_id`. Events without one (server SDKs) fall into the hourly visit. |

## Pageviews and events

A **pageview** is an event with no name. The tracking script sends one when a page loads and on every client-side route change.

A **custom event** has a name, such as `signup` or `subscription_renewed`, and optional properties. Names are up to 50 characters, and one event can carry up to 100 properties. Send them with `flareboard.track()` in the browser or with the [server API](/docs/install/server). See [Track events](/docs/events).

Other kinds of data use the same pipeline: errors, logs, AI generations, Core Web Vitals, heatmap clicks, and the `$autocapture` and `$pageleave` events the script adds for you.

## Identified users and people

Visitors are anonymous until your code says who they are. Calling `flareboard.identify('user_123', { plan: 'pro' })` after sign-in attaches a **distinct ID** to the visitor and creates or updates a profile under **People**. The properties you pass are stored on the profile. Only send what you are happy to store: ids and plan names, not passwords or other sensitive data.

Things to know:

- The distinct ID can be up to 128 characters.
- An identified user gets the same session ID on every device, so their activity lines up.
- `flareboard.alias()` links an earlier anonymous ID to a user ID. When visitors are remembered, the script does this for you at `identify()`.
- `flareboard.group()` attaches the user to a group such as a company or account.
- Anonymous visitors do not get a profile. Profiles come from identify calls.

PostHog SDKs follow the same model through `$identify`, `$set`, `$create_alias` and `$groupidentify`. See [Use PostHog SDKs](/docs/install/posthog).

## Release and environment

Errors, logs and AI events can carry a `release` and an `environment` label, for example `2.4.1` and `production`. Add `data-release` and `data-environment` to the script tag, or pass them in the call. They let you filter errors and logs by deploy, and feature flags can use them in targeting rules. They are plain labels: Flareboard does not keep separate data sets per environment. To keep production and staging apart, create two websites.

## Data retention

Flareboard deletes raw events and session replays older than a website's retention period, about once an hour. Each plan sets the maximum:

| Plan | Longest retention |
| --- | --- |
| Free | 1 year |
| Cloud | 2 years |
| Business | 3 years |

Set a shorter period in the website's **Settings**, in the **Data retention** card, with **Keep raw data for (days)**. Left empty, the plan maximum applies. Logs and traces sent over OpenTelemetry are kept for 30 days at most, whatever the plan. If an account moves to a plan with a shorter maximum, older raw data is deleted.

Deleting a website removes it from your account at once, and all its data is erased within 30 days. More in [Privacy and data](/docs/privacy-data) and [Plans and limits](/docs/plans-limits).

## Cloud and self-hosted

Both run the same code.

| | Flareboard Cloud | Self-hosted |
| --- | --- | --- |
| Where | Our Cloudflare account | Your Cloudflare account |
| Addresses | Dashboard `https://flareboard.dev`, API `https://api.flareboard.dev`, ingest `https://t.flareboard.dev` | Your own dashboard, API and ingest addresses |
| Plans | Free, Cloud and Business, with monthly allowances and retention limits | Every feature, no plan limits |
| Retention | Capped by plan | Raw data kept indefinitely unless you set a period |

Examples in these docs use the Cloud addresses. If you self-host, replace them with yours. See [Self-host Flareboard](/docs/self-host/deploy).
