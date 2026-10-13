#!/usr/bin/env bash
# Puts dist/Flareboard.app in "dist/Flareboard <version>.dmg" with a link to Applications, signs it,
# and with DO_NOTARIZE=1 notarizes and staples it. Adapted from Cleer's scripts/make_dmg.sh.
set -euo pipefail

# shellcheck source=notarize.sh
source "$(dirname "${BASH_SOURCE[0]}")/notarize.sh"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$ROOT_DIR/Packaging/Info.plist")"
APP_PATH="$ROOT_DIR/dist/Flareboard.app"
DMG_PATH="$ROOT_DIR/dist/Flareboard $VERSION.dmg"
STAGING_DIR="$ROOT_DIR/.build/dmg-staging"
SIGNING_IDENTITY="${SIGNING_IDENTITY:-Developer ID Application: deng yongyuan (CE8N4Z6AQ3)}"
NOTARY_PROFILE="${NOTARY_PROFILE:-AC_PASSWORD}"

test -d "$APP_PATH" || { echo "Missing $APP_PATH: run scripts/build_app.sh first." >&2; exit 1; }
/bin/rm -rf "$STAGING_DIR" "$DMG_PATH"
/bin/mkdir -p "$STAGING_DIR"
/usr/bin/ditto "$APP_PATH" "$STAGING_DIR/Flareboard.app"
/bin/ln -s /Applications "$STAGING_DIR/Applications"
/usr/bin/hdiutil create -volname "Flareboard" -srcfolder "$STAGING_DIR" -ov -format ULFO "$DMG_PATH" >/dev/null
/bin/rm -rf "$STAGING_DIR"

signed=0
for _ in 1 2 3 4 5; do
    if /usr/bin/codesign --force --sign "$SIGNING_IDENTITY" --timestamp "$DMG_PATH"; then signed=1; break; fi
    sleep 5
done
if [[ "$signed" != 1 && "${RELEASE:-0}" == "1" ]]; then
    echo "DMG signing failed; refusing to continue with RELEASE=1." >&2
    exit 1
fi

if [[ "${DO_NOTARIZE:-0}" == "1" ]]; then
    notarize "$DMG_PATH"
    staple "$DMG_PATH"
fi

echo "$DMG_PATH"
