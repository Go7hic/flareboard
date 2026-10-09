---
title: Quickstart
description: Create a Flareboard Cloud account, add your website, install the tracking script and confirm the first pageview arrives.
---

This guide takes you from no account to live data in about five minutes. It uses Flareboard Cloud. If you run your own copy, follow [Self-host Flareboard](/docs/self-host/deploy) first, then continue from step 2 with your own dashboard and ingest addresses.

## Before you start

- A website you can edit: you need to add one line to its HTML.
- An email address, or a GitHub account.

## 1. Create an account

1. Open [flareboard.dev/register](https://flareboard.dev/register).
2. Either click **Continue with GitHub**, or enter an email address and a password (at least 8 characters) and click **Create account**.
3. If you used email, open the verification email and click the link. You are signed in to the console.

## 2. Add your website

1. In the console, open **Websites** and click **Add website**.
2. Enter a **Name** (for example `My site`) and the **Domain** the site runs on (for example `example.com`).
3. Click **Create**.

Flareboard creates the website and opens its settings with the install snippet. Each website has a **website ID** (a UUID) that the snippet uses to send data to the right place.

## 3. Install the tracking script

Copy the snippet from the website settings and paste it into the `<head>` of every page. It looks like this, with your own website ID:

```html
<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
```

That is all a basic install needs. The script:

- records a pageview on load and on every client-side route change, so single-page apps work without extra code;
- sets no cookies and stores no IP addresses;
- is about 12 KB gzipped and loads with `defer`, so it does not block rendering.

Using React, Next.js, Vue or another framework? See [Frameworks](/docs/install/frameworks) for where the tag goes, or use the [npm package](/docs/install/npm).

## 4. Check that it works

1. Open your website in a browser and click around a few pages.
2. In the console, open your website's settings and click **Test tracking** next to the snippet.
   - **Connected**, with **Last event at** and a time, means you are done.
   - **Waiting for data** with "Script endpoint is reachable. Visit your site to send the first pageview." means the script is reachable but nothing has arrived in the last 15 minutes. Reload your site and test again.
3. Open **Realtime** for the website. Your visit appears within a few seconds.

Nothing arriving? See [Troubleshooting](/docs/troubleshooting). The usual causes are an ad blocker in your own browser, a Content Security Policy that blocks `t.flareboard.dev`, or a wrong website ID.

## Next steps

- [Track events](/docs/events) such as sign-ups and purchases with `flareboard.track()`.
- [Identify users](/docs/events#identify-users) after they sign in, so their sessions connect.
- Turn on [Session replay](/docs/session-replay) to watch visits (Cloud or Business plan on Flareboard Cloud).
- Invite your team: [Teams and access](/docs/teams).
