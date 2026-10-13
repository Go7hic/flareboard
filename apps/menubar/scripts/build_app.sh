#!/usr/bin/env bash
# Builds dist/Flareboard.app: a universal (arm64 + x86_64) release build, stripped, signed with the
# Developer ID and the hardened runtime. DO_NOTARIZE=1 also notarizes and staples it; RELEASE=1
# turns every signing problem into a failure instead of an ad hoc build. Adapted from Cleer's
# scripts/build_macos_app.sh.
set -euo pipefail

# shellcheck source=notarize.sh
source "$(dirname "${BASH_SOURCE[0]}")/notarize.sh"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_DIR="$DIST_DIR/Flareboard.app"
SIGNING_IDENTITY="${SIGNING_IDENTITY:-Developer ID Application: deng yongyuan (CE8N4Z6AQ3)}"
NOTARY_PROFILE="${NOTARY_PROFILE:-AC_PASSWORD}"
RELEASE="${RELEASE:-0}"

cd "$ROOT_DIR"
# Shipped binaries embed source paths; map them away from this machine's user.
BUILD_ARGS=(
    -c release --arch arm64 --arch x86_64
    -Xswiftc -file-prefix-map -Xswiftc "$ROOT_DIR=/build/flareboard"
    -Xswiftc -file-prefix-map -Xswiftc "$HOME=/build/home"
    # Otherwise dsymutil looks for the remapped module paths and warns.
    -Xswiftc -Xfrontend -Xswiftc -no-clang-module-breadcrumbs
)
swift build "${BUILD_ARGS[@]}" --product Flareboard
BIN_DIR="$(swift build "${BUILD_ARGS[@]}" --show-bin-path)"

/bin/rm -rf "$APP_DIR"
/bin/mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
/bin/cp "$BIN_DIR/Flareboard" "$APP_DIR/Contents/MacOS/Flareboard"
/bin/cp "$ROOT_DIR/Packaging/Info.plist" "$APP_DIR/Contents/Info.plist"
/bin/cp -R "$ROOT_DIR/Packaging/Resources/." "$APP_DIR/Contents/Resources/"
/bin/rm -f "$APP_DIR/Contents/Resources/.DS_Store"

# Local symbols only help debugging: keep them in a dSYM beside the app (not shipped), then strip.
/bin/rm -rf "$DIST_DIR/Flareboard.app.dSYM"
/usr/bin/xcrun dsymutil "$APP_DIR/Contents/MacOS/Flareboard" -o "$DIST_DIR/Flareboard.app.dSYM"
/usr/bin/xcrun strip -x "$APP_DIR/Contents/MacOS/Flareboard"
for arch in arm64 x86_64; do
    /usr/bin/lipo "$APP_DIR/Contents/MacOS/Flareboard" -verify_arch "$arch"
done

sign() {
    /usr/bin/codesign --force --sign "$SIGNING_IDENTITY" --options runtime "$1" "$APP_DIR"
}
# Apple's timestamp service times out now and then: try a few times before giving up.
signed=0
for _ in 1 2 3 4 5; do
    if sign --timestamp; then signed=1; break; fi
    sleep 5
done
if [[ "$signed" == 1 ]]; then
    echo "Signed with: $SIGNING_IDENTITY (secure timestamp)"
elif [[ "$RELEASE" == "1" ]]; then
    echo "Developer ID signing with a secure timestamp failed; refusing to continue with RELEASE=1." >&2
    exit 1
else
    echo "Signing without a timestamp (not suitable for release)." >&2
    sign --timestamp=none || /usr/bin/codesign --force --sign - "$APP_DIR"
fi
/usr/bin/codesign --verify --strict --deep "$APP_DIR"

if [[ "${DO_NOTARIZE:-0}" == "1" ]]; then
    /usr/bin/ditto -c -k --keepParent "$APP_DIR" "$DIST_DIR/Flareboard.zip"
    notarize "$DIST_DIR/Flareboard.zip" || { /bin/rm -f "$DIST_DIR/Flareboard.zip"; exit 1; }
    /bin/rm -f "$DIST_DIR/Flareboard.zip"
    staple "$APP_DIR"
fi

echo "$APP_DIR"
