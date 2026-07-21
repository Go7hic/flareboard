#!/usr/bin/env node
/**
 * Rerunnable guard for apple-design polish on Flareboard dashboard chrome.
 * Exit 0 when shared CSS/primitives still encode A–D; exit 1 with misses.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const globalCss = readFileSync(join(root, 'apps/dashboard/src/styles/global.css'), 'utf8')
const tokens = readFileSync(join(root, 'apps/dashboard/src/styles/geist-tokens.css'), 'utf8')
const button = readFileSync(join(root, 'apps/dashboard/src/components/ui/button.tsx'), 'utf8')

const checks = [
  {
    id: 'A.press-scale-btn',
    ok: /\.btn:active\s*\{[^}]*scale\(0\.97\)/s.test(globalCss),
  },
  {
    id: 'A.press-shell-link',
    ok: /\.shell-link:active\s*\{[^}]*scale\(0\.97\)/s.test(globalCss),
  },
  {
    id: 'A.press-theme-toggle',
    ok: /\.theme-toggle:active\s*\{[^}]*scale\(0\.97\)/s.test(globalCss),
  },
  {
    id: 'A.press-locale',
    ok: /\.locale-selector-trigger:active\s*\{[^}]*scale\(0\.97\)/s.test(globalCss),
  },
  {
    id: 'A.shadcn-button-scale',
    ok: /active:not-aria-\[haspopup\]:scale-\[0\.97\]/.test(button),
  },
  {
    id: 'A.motion-reduce-button',
    ok: /motion-reduce:active:scale-100/.test(button),
  },
  {
    id: 'B.page-title-tracking',
    ok: /\.page-title\s*\{[^}]*letter-spacing:\s*-0\.02em/s.test(globalCss),
  },
  {
    id: 'B.page-subtitle-leading',
    ok: /\.page-subtitle\s*\{[^}]*line-height:\s*1\.45/s.test(globalCss),
  },
  {
    id: 'B.nowrap-lead',
    ok: /\.page-header-copy \.page-subtitle\s*\{[^}]*white-space:\s*nowrap/s.test(globalCss),
  },
  {
    id: 'C.shell-blur',
    ok: /\.shell-nav\s*\{[^}]*backdrop-filter:\s*blur\(20px\)\s+saturate\(180%\)/s.test(globalCss),
  },
  {
    id: 'C.shell-edge',
    ok: /--shell-edge-highlight:/.test(tokens) && /box-shadow:\s*inset 0 1px 0 var\(--shell-edge-highlight\)/.test(globalCss),
  },
  {
    id: 'C.shell-bg-weight',
    ok: /--shell-bg: color-mix\(in srgb, var\(--geist-background-100\) 92%, transparent\)/.test(tokens),
  },
  {
    id: 'D.reduced-motion-press',
    ok: /prefers-reduced-motion:\s*reduce[\s\S]*?\.theme-toggle:active[\s\S]*?transform:\s*none/.test(globalCss),
  },
  {
    id: 'D.reduced-transparency',
    ok: /prefers-reduced-transparency:\s*reduce[\s\S]*?backdrop-filter:\s*none/.test(globalCss),
  },
]

const failed = checks.filter((c) => !c.ok)
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.id}`)
}
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`)
  process.exit(1)
}
console.log(`\n${checks.length} checks passed`)
