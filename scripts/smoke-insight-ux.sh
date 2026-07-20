#!/usr/bin/env bash
# Manual smoke checklist for dashboard insight UX (re-runnable gate).
# Usage: ./scripts/smoke-insight-ux.sh [base_url]
# Exit 0 always; prints checklist. Authenticated routes need a session cookie.
set -euo pipefail
BASE="${1:-http://localhost:5173}"

echo "Insight UX smoke against $BASE"
echo "1. GET /login (light) — primary CTA filled, inputs radius-sm"
curl -fsS -o /dev/null -w "   /login HTTP %{http_code}\n" "$BASE/login"
echo "2. Toggle dark on /login — primary CTA inverts, borders visible"
echo "3. After login, check:"
echo "   /dashboard — StatCard KPIs + AnalyticsChart"
echo "   /websites/:id — hero KPIs → chart → dimensions"
echo "   /websites/:id/sessions — load more + DataViewState error path"
echo "   /websites/:id/funnel — EventCatalogPicker multi"
echo "   /reports — hub cards link to website routes (no inline charts)"
echo "4. Locale switch (zh-CN) — numbers use getLocale formatters"
echo "DONE checklist printed (authenticated steps are manual)"
