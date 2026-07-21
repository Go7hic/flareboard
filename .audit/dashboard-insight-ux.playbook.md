# Dashboard insight UX — figure-it-out playbook (course-corrected)

Original goal: product design + interaction + data display for the whole dashboard as an insight tool. Shared format/StatCard/chart levers (U0–U13) are foundation only.

## Predicate (falsifiable)

An operator can, without hunting chrome:

1. Scan overview (KPI → chart → dimensions → drill) in light and dark.
2. Debug live traffic: Realtime shows explicit empty/live state and drills to a session.
3. Investigate sessions with filters (not only load-more).
4. Compare periods with one mental model (Overview toggle vs `/compare` agree).
5. Triage errors/logs with a readable IA (primary issue list first; secondary tabs quieter).
6. Know where custom analytics live: Insights build → Boards save/share → Reports hub links out.
7. Every user-visible count/time in app chrome uses `lib/format.ts` via `getLocale()` (landing marketing optional).
8. Critical app routes share one outer page frame (`Page` + `PageHeader` title/lead/actions + content gutter).

Evidence in `.audit/dashboard-insight-ux.tsv`. Verdict VERIFIED only with real artifact checks, not typecheck alone for interaction units.

## Units remaining

| Unit | Focus | Verify |
|------|-------|--------|
| U14 | Component-layer format cleanup | no `toLocaleString` under `src/components` except via format.ts |
| U15 | Realtime empty + session drill | empty copy + link to `/sessions/:id` |
| U16 | Compare model unification | Overview compare + `/compare` share labels/controls semantics | VERIFIED |
| U17 | Sessions filters | path/referrer or segment filter + clear empty |
| U18 | Errors IA | Issues tab primary; secondary tabs demoted |
| U19 | Logs IA | Events primary; traces/filters/alerts secondary |
| U20 | Insights/Boards/Reports line | cross-links + role copy on each surface | VERIFIED |
| U21 | Auth visual smoke | checklist on core paths light/dark |
| U22 | Unified page frame | `Page` + `PageHeader` + `PageBody` on critical routes; leftover list via `.audit/check-page-frame.sh` |
| U22.1 | Leftover page frames | All app leftovers on Page frame; SharePublic allowlisted; WebsitePageShell deleted |

## U22 page frame (layout chrome)

**Problem.** Insight UX improved IA inside pages, but outer chrome still drifted: global routes used `PageHeader`, website routes often used actions-only `WebsitePageShell` (or a no-op), and a few invented manual `h2.page-title` rows.

**Lever.** `Page` / `PageHeader` / `PageBody` in `apps/dashboard/src/components/`. Title + muted lead + actions on one row; optional `toolbar` / `meta`.

**Variants.** `default` | `narrow` | `bleed` (Realtime: tighter header gap only, not full-bleed media). No `PageTabs` yet; secondary tabs stay in-page (Errors/Logs IA wins).

**Status.** App leftovers migrated in U22.1. `.audit/check-page-frame.sh` exits 0 when clean; `SharePublic` remains allowlisted (public share surface, own brand chrome).

## Out of scope

New metrics backends, warehouse SQL redesign, marketing landing rewrite, accent rails.

