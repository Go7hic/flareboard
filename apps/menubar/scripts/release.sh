#!/usr/bin/env bash
# Releases the menu bar app from this Mac: builds the universal app, signs it with the Developer ID,
# notarizes the app and the disk image with the notarytool profile (AC_PASSWORD, as Cleer uses), and
# publishes the disk image to the GitHub release menubar-v<version>, never marked latest (the
# product's v1.x releases keep that). Installed apps find it through the releases API.
#
# Before: bump CFBundleShortVersionString and CFBundleVersion in Packaging/Info.plist, add the
# version's section to CHANGELOG.md, commit, and push to main.
#   apps/menubar/scripts/release.sh
set -euo pipefail
cd "$(dirname "$0")/.."

repo="Go7hic/flareboard"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' Packaging/Info.plist)"
tag="menubar-v$version"
dmg="dist/Flareboard $version.dmg"

git diff --quiet HEAD -- . && test -z "$(git ls-files --others --exclude-standard -- .)" ||
    { echo "Commit apps/menubar first: the release is tagged at HEAD." >&2; exit 1; }
git fetch -q origin main
git merge-base --is-ancestor HEAD origin/main || { echo "Push HEAD to main first." >&2; exit 1; }
existing="$(gh api "repos/$repo/releases?per_page=100" --jq "[.[] | select(.tag_name == \"$tag\")] | length")"
test "$existing" = 0 || { echo "A release (or draft) $tag exists: bump the version or delete it." >&2; exit 1; }

notes="$(mktemp)"
awk -v v="## $version" '$0 == v { on = 1; next } /^## / { on = 0 } on' CHANGELOG.md > "$notes"
test -s "$notes" || { echo "CHANGELOG.md has no ## $version section." >&2; exit 1; }

swift test
RELEASE=1 DO_NOTARIZE=1 scripts/build_app.sh
RELEASE=1 DO_NOTARIZE=1 scripts/make_dmg.sh
/usr/sbin/spctl -a -t install "$dmg"
/usr/sbin/spctl -a dist/Flareboard.app

gh release create "$tag" "$dmg" --repo "$repo" --target "$(git rev-parse HEAD)" --latest=false \
    --title "Flareboard for macOS $version" --notes-file "$notes"
echo "Published https://github.com/$repo/releases/tag/$tag"
