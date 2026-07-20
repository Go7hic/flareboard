#!/usr/bin/env bash
# Lists dashboard pages that still use raw `.page` wrappers without Page/PageHeader.
# Exit 0 always; prints leftover paths for migration tracking.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
pages="$root/apps/dashboard/src/pages"
echo "pages using className=\"page\" without importing Page or PageHeader:"
while IFS= read -r -d '' f; do
  if ! rg -q "from ['\"].*/(Page|PageHeader)['\"]" "$f"; then
    if rg -q 'className="page' "$f"; then
      echo "  ${f#$root/}"
    fi
  fi
done < <(find "$pages" -name '*.tsx' -print0 | sort -z)
