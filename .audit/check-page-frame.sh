#!/usr/bin/env bash
# Lists dashboard pages that still use raw `.page` wrappers without Page/PageHeader.
# Exit 1 when leftovers remain (so CI / reviewers get a hard gate).
# Intentional non-app frames can be listed in ALLOW_RAW_PAGE.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
pages="$root/apps/dashboard/src/pages"

# Public / marketing surfaces that are not the authenticated app chrome.
ALLOW_RAW_PAGE=(
  apps/dashboard/src/pages/SharePublic.tsx
)

is_allowed() {
  local rel="$1"
  local a
  for a in "${ALLOW_RAW_PAGE[@]}"; do
    [[ "$rel" == "$a" ]] && return 0
  done
  return 1
}

leftovers=()
while IFS= read -r -d '' f; do
  rel="${f#$root/}"
  if is_allowed "$rel"; then
    continue
  fi
  if ! rg -q "from ['\"].*/(Page|PageHeader)['\"]" "$f"; then
    if rg -q 'className="page' "$f"; then
      leftovers+=("$rel")
    fi
  fi
done < <(find "$pages" -name '*.tsx' -print0 | sort -z)

echo "pages using className=\"page\" without importing Page or PageHeader:"
if ((${#leftovers[@]} == 0)); then
  echo "  (none)"
  exit 0
fi

for rel in "${leftovers[@]}"; do
  echo "  $rel"
done
echo "leftover_count=${#leftovers[@]}"
exit 1
