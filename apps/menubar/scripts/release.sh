#!/usr/bin/env bash
# Releases the menu bar app from this Mac, as Cleer's scripts do: `mygo build` signs it with the
# Developer ID in mygo.json, notarizes the disk image with the notarytool profile there
# (AC_PASSWORD in the login keychain), signs the update with the key of `go tool mygo keygen`,
# and uploads the disk image and the update to the GitHub release menubar-v<version>, which
# installed apps then update to. The release is never marked latest: the product's v1.x keep it.
#
# Before: bump "version" in mygo.json and appVersion in view_settings.go, add the version's
# section to CHANGELOG.md, commit, and push to main.
#   apps/menubar/scripts/release.sh
set -euo pipefail
cd "$(dirname "$0")/.."

key="${MYGO_UPDATE_KEY:-$HOME/Library/Application Support/mygo/update-keys/mygo-update.key}"
version="$(jq -r .version mygo.json)"
tag="menubar-v$version"
repo="$(jq -r .updates.github mygo.json)"

test -r "$key" || { echo "No update key at $key (set MYGO_UPDATE_KEY)." >&2; exit 1; }
git diff --quiet HEAD -- . && test -z "$(git ls-files --others --exclude-standard -- .)" ||
  { echo "Commit apps/menubar first: the release is tagged at HEAD." >&2; exit 1; }
git fetch -q origin main
git merge-base --is-ancestor HEAD origin/main || { echo "Push HEAD to main first." >&2; exit 1; }
if gh release view "$tag" --repo "$repo" --json isDraft -q .isDraft 2>/dev/null | grep -q false; then
  echo "$tag is already published: bump the version." >&2
  exit 1
fi

CGO_ENABLED=0 go test ./...
go tool mygo vet .

# The version's section of the changelog, without its heading.
notes="$(mktemp)"
awk -v v="## $version" '$0 == v { on = 1; next } /^## / { on = 0 } on' CHANGELOG.md > "$notes"
test -s "$notes" || { echo "CHANGELOG.md has no ## $version section." >&2; exit 1; }
if ! gh release view "$tag" --repo "$repo" > /dev/null 2>&1; then
  gh release create "$tag" --repo "$repo" --target "$(git rev-parse HEAD)" --draft --latest=false \
    --title "Flareboard for macOS $version" --notes-file "$notes"
fi

# Apple's timestamp and notary services time out now and then: try the build three times.
for try in 1 2 3; do
  rm -rf build/darwin-universal
  if MYGO_UPDATER_PRIVATE_KEY="$(cat "$key")" go tool mygo build -platform darwin/universal -upload; then
    break
  fi
  test "$try" -lt 3 || exit 1
  echo "Build failed, trying again…" >&2
  sleep 15
done
spctl -a -t install "build/darwin-universal/Flareboard $version.dmg"

gh release edit "$tag" --repo "$repo" --draft=false --latest=false
echo "Published https://github.com/$repo/releases/tag/$tag"
