---
title: Session replay
description: Record visits and watch them back. Plan requirements, the two scripts to install, privacy and sampling settings, where recordings are stored, and how to watch, share and find replays.
---

Session replay records what a visitor saw and did on your site (page changes, clicks, scrolling and mouse movement) so you can play the visit back like a video. Use it to see why people drop out of a funnel or to reproduce an error. Recording is off by default. You turn it on per website and decide what is masked.

## Before you start

- **Plan.** On Flareboard Cloud, session replay needs the Cloud or Business plan. The Free plan has no replays. Cloud includes 5,000 replays a month and Business 25,000. A replay is one recorded visit. Past the allowance, recording continues up to 120% of it, then new recordings stop until the next month. Self-hosted installs have no plan limits. See [Plans and limits](/docs/plans-limits).
- **The tracking script.** Install [`script.js`](/docs/install/script) first. The recorder reads the session and visit IDs the script creates, and it waits up to about a minute for them.
- **Storage (self-hosted).** Recordings need the `REPLAY_BUCKET` R2 binding on the ingest and API workers. See [Bindings](/docs/self-host/configuration#bindings).
- **A page you control.** The scripts go on the site you track, not in the Flareboard console.

## 1. Turn replay on

1. Open **Websites**, then the website's **Settings**.
2. In the **Session replay** card, switch on **Enable session replay**.
3. Click the card's save button.

On Flareboard Cloud, the Free plan answers `Session replay requires a paid plan.` and the switch does not stay on. Until replay is enabled, ingest accepts the recorder's requests and discards them.

## 2. Add the scripts

Open the website's **Settings**, find **Tracking code** and open the **Session replay setup** tab. Copy the snippet, or use this one with your own website ID:

```html
<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
<script defer src="https://cdn.jsdelivr.net/npm/rrweb@2/umd/rrweb.min.js"></script>
<script defer src="https://t.flareboard.dev/recorder.js" data-website-id="YOUR_WEBSITE_ID"></script>
```

- `script.js` collects pageviews and events.
- The rrweb file is the recording library. It must be the `umd` build, which defines `window.rrweb`. The `dist` build is an ES module and fails in a plain script tag.
- `recorder.js` needs the same `data-website-id` as `script.js`. A project key works in place of the website ID, see [Concepts](/docs/concepts#project-key).

Self-hosters replace `https://t.flareboard.dev` with their own ingest address. If your site sets a Content Security Policy, allow `https://cdn.jsdelivr.net` and your ingest address in `script-src`, and your ingest address in `connect-src`. See [Install the tracking script](/docs/install/script#content-security-policy).

The PostHog SDKs do not record sessions here. The console snippet for them sets `disable_session_recording: true`. Use `recorder.js` for replay.

## 3. Choose what is recorded

All options are in **Settings**, in the **Session replay** card. Changes usually reach visitors' browsers within a minute or two: saving clears the server's copy of the settings, and each browser keeps its own copy for up to about a minute.

### Sampling

| Setting | Default | What it does |
| --- | --- | --- |
| **Sample rate** | 100% | The share of visits recorded. The decision is made once per visit, so a visit is recorded whole or not at all. Lower it to save storage. |
| **Minimum visit duration** | **Record every visit** | Choose **At least 2 seconds**, **5**, **10** or **30 seconds**. Shorter visits send nothing, which saves storage on bounces. |
| **Capture console logs** | Off | Stores the level and message of `console` calls and uncaught errors. Messages are cut at 1,000 characters. Email addresses, card-like numbers, tokens, values after `password=` style labels and URL query strings are removed in the browser first. At most 300 per page. |
| **Capture network requests** | Off | Stores the method, URL without query string, status, duration and size of `fetch` and XHR calls. Long opaque path segments become `:redacted`. Headers and bodies are never read. At most 500 per page. |

### Privacy

| Setting | Default | What it does |
| --- | --- | --- |
| **Mask all input fields** | On | Every typed value is replaced by asterisks of the same length. With it off, password, hidden, payment and one-time-code fields, fields whose name, id or placeholder looks sensitive (for example `token`, `ssn`, `iban`, `card number`), and anything inside a mask selector stay masked. |
| **Mask all text on the page** | Off | Replaces every text node with asterisks. |
| **Mask selectors (CSS)** | Empty | Text and inputs inside matching elements are masked. One selector per line, or comma-separated. |
| **Block selectors (CSS)** | Empty | Matching elements are not recorded at all. Viewers see an empty box of the same size. |

Text shown on the page is recorded as it is unless you mask it, so check your pages for personal data before you turn replay on.

Some markup is always honored, with no setting needed:

| Where | Masked (text and inputs) | Blocked (not recorded) |
| --- | --- | --- |
| Your HTML | `data-fb-mask`, `.fb-mask`, `.ph-mask` | `data-fb-no-capture`, `.ph-no-capture`, `data-fb-block`, `.fb-block`, `.ph-block` |

```html
<div class="fb-mask">Jane Doe, jane@example.com</div>
<form data-fb-block>...</form>
```

Invalid selectors in the settings are ignored. The built-in ones always apply.

Click **Edit raw JSON** to change everything at once. The keys are `sampleRate` (0 to 1), `minDurationSeconds` (up to 60), `maskInputs`, `maskAllText`, `maskSelectors`, `blockSelectors`, `captureConsole` and `captureNetwork`. Click **Apply JSON**, then save the card.

### Consent and Do Not Track

- Nothing is recorded for a visitor who has opted out with `flareboard.optOut()`. An opt-out during a visit stops the recording and discards what was not yet sent. See [Track events](/docs/events).
- With **Honor Do Not Track and Global Privacy Control** on in the **Data collection** card, or `data-respect-dnt` on a script tag, browsers that send either signal are not recorded.

If you need consent before recording, add `recorder.js` and the rrweb script to the page only after the visitor agrees.

## Where recordings are stored

Recording data is sent to `/api/record` on the ingest address in chunks, every 5 seconds, every 200 events and when the page is hidden or closed. Each chunk is limited to 512 KB.

- The chunks are stored in an R2 bucket under `WEBSITE_ID/VISIT_ID/CHUNK_NUMBER`. The bucket is named `flareboard-replays` in the default setup.
- A small index row per chunk, and a summary per visit (duration, clicks, console and network counts), live in the website's data store. The replay list reads these summaries.

Bots are ignored. Console and network entries are kept only if you switched those options on, and the server drops every other field before storing a chunk.

### Retention

Recordings are deleted with the raw events they belong to, about once an hour, when they pass the website's retention period. Set it in **Settings** under **Data retention** with **Keep raw data for (days)**. Left empty, the plan maximum applies: 1 year on Free, 2 years on Cloud and 3 years on Business. Self-hosted installs keep recordings until you set a period. The R2 objects are deleted before their index rows. Deleting a website erases its recordings within 30 days. See [Privacy and data](/docs/privacy-data).

## Watch replays

Open **Session replays** in the website sidebar.

1. Pick a date range. The default is **Last 24 hours**.
2. Narrow the list with **Show** (**All replays**, **With issues**, **With errors**, **With logs**, **With AI calls**), **Sort** (**Newest first**, **Oldest first**, **Longest first**, **Shortest first**, **Most active**, **Most errors**), **Duration** and **Person (distinct ID)**. **More filters** adds **Visited URL contains...**, **Performed event (name)** and property filters such as country, device or browser.
3. Click a visit. Each row shows the entry page, duration, pages, clicks and an error count.

### The player

| Control | What it does |
| --- | --- |
| Play and pause | The button, a click on the page, or `Space`. |
| Scrubber | Click or drag to seek. Grey stretches are inactive periods. Dots are markers for errors, events and more. |
| **Playback speed** | 0.5x, 1x, 2x, 4x or 8x. |
| **Skip inactivity** | On by default. Playback jumps over idle stretches. |

Keyboard shortcuts, when you are not typing in a field:

| Key | Action |
| --- | --- |
| `Space` or `K` | Play or pause |
| Left and right arrows | Back or forward 5 seconds |
| `Shift` + left or right arrow | Previous or next marker |
| `<` and `>` | Slower or faster |
| `S` | Toggle skip inactivity |

Beside the video, the **Replay timeline** lists what happened, in step with playback. Filter it with **All**, **Console**, **Network**, **Events** and **Pages**. Click an entry to jump there. **Console** and **Network** stay empty unless you switched those captures on. Custom events, errors and logs from the same session also appear.

### Save, copy and share

- **Save** keeps a replay in the **Saved** list, which holds it after it leaves the date range of the list. Needs edit access.
- **Copy link** copies a console link to the replay at the current time. It only opens for people who can sign in to the website.
- **Share** creates a public link that plays this one replay without signing in. Choose when it expires (**Never**, **After 1 day**, **After 7 days** or **After 30 days**), click **Create and copy link**, and use **Start links at** to begin at the current time. Creating and revoking links needs edit access. The link looks like `https://flareboard.dev/shared/replay/TOKEN`. Click **Revoke** to stop it. Anyone with the link sees everything the recording holds, including console and network entries, so share carefully.

## Find the replay for an error

1. Open **Errors** and an error. Click **View session**.
2. On the session page, click **Watch replay**. It opens the session's latest recording.

You can also work the other way. In **Session replays**, choose **With errors** under **Show** to list visits that hit an error or logged a console error. The row shows an error badge, and the timeline marks the errors.

The **Watch replay** button is on every session page whose visit was recorded.

## Check that it works

1. Confirm **Enable session replay** is on and saved.
2. Open your site in a new tab, click around for a few seconds, then reload or close the page so the last chunk is sent.
3. Open **Session replays**. The visit appears with its entry page. Click it and press play.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| **Session replay is off for this site.** | Replay is not enabled. Click **Open settings** and switch it on. |
| **Session replay requires a paid plan.** | The Free plan. Upgrade to Cloud. |
| Nothing appears in the list | The scripts are missing, the visit was skipped by the sample rate or the minimum duration, or the visitor opted out or sent Do Not Track while the website honors it. Check the network tab for requests to `/api/record`. |
| `recorder.js` runs but records nothing | The rrweb script did not load, or it is the wrong build. Use the `umd/rrweb.min.js` URL above and allow its host in your Content Security Policy. |
| `No replay events found.` when you open a visit | The chunks are not in storage. On a self-hosted install, check that `REPLAY_BUCKET` is bound. |
| Console and network tabs are empty | Those captures are off. Switch them on in the **Session replay** card. |
| The replay looks blank in places | Blocked elements are shown as empty boxes. Check **Block selectors (CSS)** and the `data-fb-block` markers. |
| New visits stop appearing for the rest of the month | The monthly allowance and its 20% grace are used up. Recordings already under way finish, new ones resume next month. |

## Next steps

- Combine replay with [Error tracking](/docs/error-tracking) to see what led to a failure.
- See where visitors click across all visits with [Heatmaps](/docs/heatmaps).
