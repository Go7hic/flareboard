# Geist + shadcn Base UI redesign playbook

Auditable workflow for the full Flareboard visual redesign (figure-it-out).

## Definition of done

Every dashboard route and blog page in light and dark:

1. Colors from Geist tokens (`geist-tokens.css`).
2. Typography Geist Sans / Geist Mono.
3. Interactive primitives from **shadcn/ui Base UI** (`components.json` style `base-nova`), not hand-rolled Radix wrappers.
4. Layout rhythm 4px scale; content max ~1200px; radii 6 / 12 / 16.
5. Focus rings match Geist two-layer blue ring.

## Locked product choices

| Choice | Decision |
|--------|----------|
| Primary CTA | Geist `gray-1000` (near-black / near-white) |
| Links / focus | Geist blue |
| Primitives | shadcn/ui **Base UI** (`base-nova`) |
| Blog | In scope (tokens + layout; Astro stays CSS-first) |
| Delivery | Land token + primitives first, then page families |

## Units

| ID | Work | Verify |
|----|------|--------|
| U0 | Geist tokens + fonts (dashboard + blog) | Theme toggle shows Geist palette |
| U1 | Replace `components/ui/*` via shadcn Base UI; compat for existing Button variants | `pnpm --filter @flareboard/dashboard typecheck` |
| U2 | AppShell + DashboardHome | Visual smoke |
| U3 | Marketing + auth | Landing / Pricing / Login |
| U4 | Website analytics family | Stats / Sessions / charts shell |
| U5 | Remaining app pages | Route inventory zero |
| U6 | Blog layouts/header/footer/article | Blog light/dark |
| U7 | AGENTS.md + DESIGN-NOTE + decision trail | Docs match system |

## Audit trail

`.audit/geist-redesign.tsv` (local; commit when PR opens).
