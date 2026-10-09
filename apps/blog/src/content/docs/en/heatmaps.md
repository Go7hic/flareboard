---
title: Heatmaps
description: See where visitors click and how far they scroll on each page. Plan requirement, how clicks and scrolls are sampled, how to read the click and scroll views, and what to do when the page preview is blocked.
---

A heatmap adds up where visitors click and how far they scroll on one page. Use it to see which buttons get attention and where people stop reading. Heatmaps are built from a sample of clicks and scrolls, and they are not linked to any visitor.

## Before you start

- **Plan.** On Flareboard Cloud, heatmaps need the Cloud or Business plan. On the Free plan the **Heatmaps** page shows `Heatmaps are available on the Cloud plan.` and the API answers `403`. Self-hosted installs have no plan limits.
- **The tracking script.** Heatmap data comes from [`script.js`](/docs/install/script). No extra script is needed, unlike [Session replay](/docs/session-replay).
- Collection is on by default. You only change settings to lower or switch off sampling, or to set a preview page.

## How data is collected

The tracking script listens for two things on every page:

- **Clicks.** Each click is a candidate. The script sends where the pointer was inside the visible window, together with the window size.
- **Scrolls.** About 0.4 seconds after the visitor stops scrolling, the script works out how far down the page they have seen, as a percentage. It sends a scroll only when that is deeper than any depth already seen on that page in the browser tab.

Not every click or scroll is sent. Each one is sampled on its own, with a probability called the sample rate. The default is `0.1`, so about one click in ten and one scroll in ten is kept. On a busy page that is plenty.

Positions are stored as a coordinate on a 1000 by 1000 grid, plus the device class (desktop, mobile or tablet, taken from the user agent) and the page path including any `#` route. Counts are added up per day. Nothing identifies the visitor.

Because a click is recorded relative to the visible window and not to the whole page, scrolling before a click is not accounted for. Treat the click view as "where on screen people click", most reliable for headers, hero sections and the area above the fold.

## Set the sample rate

You can set the rate in two places.

1. **In the console.** Open **Websites**, then the website's **Settings**, and find the **Heatmap sampling** card. The **Config (JSON)** box holds:

   ```json
   {"sampleRate":0.1,"enabled":true}
   ```

   `sampleRate` is a number from 0 to 1. `enabled` set to `false` stops the script from sending heatmap data. Click the card's save button.

2. **On the script tag.** `data-heatmap-sample-rate` takes a number from 0 to 1:

   ```html
   <script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID" data-heatmap-sample-rate="0.5"></script>
   ```

The attribute is used until the website's settings load. The website's setting then takes over, and the browser keeps it for about a minute. Set the rate in the console unless you need a different value on one page. Self-hosters replace `https://t.flareboard.dev` with their own ingest address.

A higher rate fills the map faster on low-traffic pages. It also sends more requests from your visitors' browsers.

## Read a heatmap

Open **Heatmaps** in the website sidebar.

1. Choose a date range. The default is **Last 24 hours**.
2. Under **Page**, pick a page. The list shows the pages that have data in the range, busiest first, each with its number of samples. The 100 busiest pages are listed. If the range has no data yet, a **Page path** field lets you type a path such as `/pricing`.
3. Choose the **Type**: **Clicks** or **Scroll depth**.
4. Choose a **Device**: **All devices**, **Desktop**, **Mobile** or **Tablet**. Layouts differ by device, so compare them one at a time.

### Clicks

Each recorded spot is a translucent dot. Dots overlap and build up where clicks cluster, so denser areas look stronger. The legend runs from **Low** to **High**. The summary line shows the click count, the device and the window size the clicks were recorded at, in the form "N clicks · All devices · recorded at 1280×800". The dots are scaled to that size and drawn over a preview of the page.

### Scroll depth

A table lists each depth reached, from the top of the page down, with the number of **Scroll events** and each row's **Share** of all scroll events. A long tail of low numbers near the bottom means few people read that far.

If a page has no data you see `No heatmap data for this page and period.` Try another page, device or a wider date range.

## The page preview

For the click view, the console tries to show your live page behind the dots. Use the **Page preview** switch to turn it off. The choice is remembered in your browser.

The preview address is, in order:

1. The **Preview URL (optional)** in the **Heatmap sampling** card of **Settings**. When it is set, the preview always shows this address, whichever page you pick.
2. Otherwise your website's **Domain** plus the page path, over `https`.

The preview is a framed copy of your page, drawn at the window size of the recorded clicks. The frame is sandboxed and does not run your scripts, so pages that build their content with JavaScript can look empty or half drawn.

### When the preview is unavailable

The console shows the dots on a plain background and a note instead of the page when:

| Note | Cause |
| --- | --- |
| **No page preview: add the website domain in settings** | The website has no domain and no **Preview URL**. |
| **Page preview unavailable, showing the overlay only** | The address did not answer, or the page did not load in the frame within 8 seconds. |

Browsers refuse to show a page in a frame when the site sends an `X-Frame-Options` header or a Content Security Policy `frame-ancestors` rule that does not allow the console. Many sites send one of these by default. Staging hosts that are offline, a mistyped domain, and pages that need a login also fail.

The click positions in the overlay stay accurate, so the heatmap is still useful. To get a preview, do one of these:

1. Set **Preview URL (optional)** to a test page on your own domain that allows framing. The hint next to the field asks for a same-origin test page, a simple page with the same layout as the real one.
2. Or change the page's `X-Frame-Options` or `frame-ancestors` setting to allow `https://flareboard.dev` (or your own console address if you self-host) to frame it.
3. Or leave the preview off and read the clicks against a screenshot you keep.

Because the optional **Preview URL** is used for every page, it suits a single important page best. For other pages, rely on the overlay.

## Check that it works

1. Open a page of your site and click around. Scroll to the bottom.
2. With the default `0.1` rate most of your test clicks are not kept. For a quick test, set `sampleRate` to `1` in **Heatmap sampling**, save, wait about two minutes for the setting to reach the script, and reload your page before clicking.
3. Open **Heatmaps** for the website, pick the page and **Clicks**. Your clicks appear. Switch to **Scroll depth** to see the depth you reached.
4. Set the rate back to a lower value after the test.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Heatmaps are available on the Cloud plan.` | The Free plan on Flareboard Cloud. Upgrade to Cloud. |
| `Heatmaps require a paid plan.` from the API | A request set `"enabled": true` in the heatmap settings on the Free plan. The **Heatmap sampling** card is locked on that plan. |
| No pages in the list | No clicks or scrolls were sampled in the range. Widen the date range or raise `sampleRate`. |
| The list does not show a page you expect | The path differs. Pages are matched by the exact path and any `#` route, so `/pricing` and `/pricing/` are different pages. |
| Clicks are shifted from the buttons in the preview | The preview is a different layout than the one visitors saw, for example a different device width. Pick the matching **Device**. |
| No data after setting `"enabled": false` | The script no longer sends heatmap data. Set `"enabled": true` again. |

## Next steps

- Watch individual visits with [Session replay](/docs/session-replay).
- Read [Install the tracking script](/docs/install/script) for the other attributes of the script tag.
