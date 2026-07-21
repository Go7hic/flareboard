# Apple-design → Flareboard mapping (2026-07-21)

Source: Emil Kowalski `apple-design` skill (WWDC fluid interfaces + materials + typography + 8 foundations), applied under AGENTS.md Geist constraints.

## Applied

| Rule | Where | Notes |
|------|--------|--------|
| §1 Response (press on pointer-down) | `.btn:active`, shadcn `Button`, `.shell-link`, `.theme-toggle`, `.locale-selector-trigger`, `.shell-menu-toggle` | `scale(0.97)` + `100ms ease-out` |
| §15 Typography (optical tracking/leading) | `.page-title`, `.page-subtitle` | Title `-0.02em` / `lh 1.1`; subtitle `0` tracking / `lh 1.45`; kept desktop `nowrap` from `ba956e0` |
| §12 Materials (floating chrome only) | `.shell-nav`, `.shell-topbar`, `.landing-nav` | blur 20 / saturate 180; `--shell-bg` 92%; `--shell-edge-highlight` hairline |
| §14 Reduced motion | shared `@media (prefers-reduced-motion: reduce)` | Drop press scale; shorten chrome transitions (theme thumb included) |
| §14 Reduced transparency | `@media (prefers-reduced-transparency: reduce)` | Solid `--bg`, no blur/edge on floating chrome |
| §16 Simplicity / Craft | intentional non-touch | Form density already healthy after `657307a`; no page reopen |

## Intentionally skipped

| Rule | Reason |
|------|--------|
| §2–§10 Springs / gesture sheets / rubber-band / velocity handoff | No Vaul/sheet rewrite this wave; AGENTS.md restraint, flat solids |
| §11 Motion blur / stretch | Not needed for press-scale chrome |
| §12 Stacked translucent panels / scroll-edge gradient masks | Forbidden by “no gradients”; would fight Geist flat base |
| §13 Sound / haptics | Explicit skip; web product, no Vibration API budget |
| §15 Replace Geist with SF Pro | Keep Geist stack; tracking rules only |
| Bounce springs on menus | Explicit skip; locale menu stays instant open |
| Full iOS glass redesign | Hard constraint: materials only where chrome already floats |

## Lever

Re-run: `node .audit/check-apple-design.mjs`
