# Writing the Flareboard docs

The docs at `flareboard.dev/docs` live in `src/content/docs/<lang>/<slug>.md` (`en`, `zh`). The sidebar order is `src/docs/nav.ts`. Every page is published three ways: HTML, plain Markdown at the same URL plus `.md`, and inside `/docs/llms-full.txt`. People read them, and so do AI agents that set Flareboard up for their users. Write for both.

## Page shape

```markdown
---
title: Install the tracking script        # sentence case, says what the page does
sidebarTitle: Tracking script             # optional, when the title is long
description: One or two plain sentences. Shown under the title, as the meta description and in llms.txt.
---

One short paragraph: what this is and when to use it. No heading above it.

## Before you start          (only when there are real prerequisites: plan, role, an installed script)

## Steps or sections         (numbered "## 1. Do the thing" headings for procedures)

## Check that it works       (for anything the reader sets up: what they should see, where)

## Troubleshooting          (optional: symptom, cause, fix)
```

## Rules

- **Only facts the code supports.** Read the source before writing: tracker `apps/ingest/src/tracker/script.ts`, SDK `packages/sdk-js`, ingest routes `apps/ingest/src/routes`, API `apps/api/src/routes` + `apps/api/src/index.ts`, console pages `apps/dashboard/src/pages`, English UI labels `apps/dashboard/src/lib/i18n.ts`, plans `packages/shared/src/billing.ts`, the Privacy Policy `apps/dashboard/src/pages/legal/privacy.en.tsx`. When something is unclear, leave it out rather than guess.
- **UI labels in bold, exactly as the English console shows them** (`**Add website**`, `**Test tracking**`). Name the path to a screen: "open **Websites**, then the website's **Settings**".
- **Code is copyable and complete.** Language on every fence (`html`, `ts`, `bash`, `json`). Placeholders in capitals: `YOUR_WEBSITE_ID`, `YOUR_PROJECT_KEY`, `YOUR_API_KEY`. Cloud addresses: dashboard `https://flareboard.dev`, API `https://api.flareboard.dev`, ingest `https://t.flareboard.dev`. Self-hosters replace them with their own; say so once where it matters.
- **Agents act on what you write.** Give the exact endpoint, method, header and body, the expected response, and how to verify. Prefer a table for options and parameters (name, type, default, what it does).
- **Plans and limits:** say when a feature needs the Cloud or Business plan, or a role (team owner, admin). Self-hosted installs have every feature without plan limits.
- **Privacy:** never suggest sending field values, passwords or other personal data. Session replay masks inputs by default. Visitors are counted with a monthly-salted hash of IP and user agent; IPs are not stored.
- **Frontmatter:** no colons inside `title`, `sidebarTitle` or `description` values (YAML would fail); rephrase instead.
- **Links:** absolute paths to other docs pages (`/docs/events`, `/docs/events#identify-users`). Anchors are the heading text lowercased with spaces as hyphens.
- **Style:** plain words, short sentences, active voice, second person ("you"). Sentence case headings. No em dashes, no emojis, no marketing adjectives ("seamless", "powerful", "blazing"). Colons only before a list or an example.
- **Chinese pages** (`zh/`) have the same slugs, headings in the same order and the same code. Translate meaning, not word by word. UI labels are the ones the Chinese console shows, in bold (**添加网站**), taken from `apps/dashboard/src/lib/locales/zh-CN.ts`. Code, placeholders and anchors-as-links stay as in English; link to the Chinese page (`/docs/zh/events`), whose anchors come from the Chinese headings. Put a space between Chinese and Latin text or numbers ("跑在 Cloudflare 上", "约 12 KB").
