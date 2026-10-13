# Flareboard for macOS

A menu bar app for one Flareboard website at a glance, in SwiftUI. It signs in with a personal API key (`fb_sk_…`, read scope), which it keeps in the login keychain.

- The icon shows how many people are on the website now (or the period's visitors, or nothing: **Settings → Next to the icon**), updated every 30 seconds.
- The panel shows visitors for 24 hours, 7 days or 30 days with the change against the previous period, a chart (hover for each hour or day), pageviews, visits, bounce rate and the top pages. A click on a page opens it on the website. The website menu (top left) switches websites; **Open dashboard** opens the console.
- English, Simplified Chinese, Japanese, German and French, with the dashboard's terms and local number formats. It follows the system unless **Settings → Language** picks one. The copy is in `Sources/FlareboardCore/Texts.swift` (English, Chinese) and `Locales.swift` (Japanese, German, French); a test fails when a language misses a text.
- Shortcuts in the panel: `⌘R` refreshes, `⌘,` opens the settings.
- The first version (MyGo) kept its settings, key included, in `~/Library/Application Support/Flareboard/settings.json`. This one moves them to the preferences and the keychain on its first launch, and removes the key from that file.

## Layout

| Path | What |
|---|---|
| `Sources/FlareboardCore` | Everything that does not draw: the API client, the app's state (`AppModel`), formatting, copy, the chart's data, storage and updates. Tested. |
| `Sources/Flareboard` | The status item and its popover (`main.swift`), and the SwiftUI views. |
| `Packaging` | `Info.plist` (version and build) and the app icon. |
| `scripts` | `build_app.sh`, `make_dmg.sh` and `release.sh`, adapted from Cleer's. |
| `resources` | The source images, from the dashboard logo: `icon.png`, `mark.png` and `tray.png` (the F as a template image), embedded in `Sources/Flareboard/Images.swift`. |

## Develop

Needs Xcode 16 or later (Swift 6).

```bash
cd apps/menubar
swift test
swift run Flareboard
```

`swift run Flareboard --snapshots /tmp/flareboard-shots` (debug builds) renders every screen, in every language, light and dark, with sample data, to PNG files for design review.

## Build and release

```bash
scripts/build_app.sh                           # dist/Flareboard.app, universal, signed
scripts/make_dmg.sh                            # dist/Flareboard <version>.dmg
```

They sign with the Developer ID `Developer ID Application: deng yongyuan (CE8N4Z6AQ3)` (`SIGNING_IDENTITY` overrides it) and, with `DO_NOTARIZE=1`, notarize with the notarytool profile `AC_PASSWORD` of the login keychain (`NOTARY_PROFILE`), as Cleer does.

To release, bump `CFBundleShortVersionString` and `CFBundleVersion` in `Packaging/Info.plist`, add a `## <version>` section to `CHANGELOG.md`, commit and push to main, then run `scripts/release.sh`. Afterwards, bump `MAC_APP_VERSION` in `apps/dashboard/src/lib/landing-links.ts`, which the home page's download button links to. It tests, builds, notarizes, and publishes the disk image to the GitHub release `menubar-v<version>`, which is never marked latest (the product's `v1.x` releases keep that).

## Updates

Installed apps check once a day (**Settings → Updates**, or **Check for Updates…** in the icon's right-click menu) for the newest `menubar-v` release through the GitHub releases API, and offer it in the panel. Installing downloads the disk image, checks it against the SHA-256 GitHub gives every asset, and accepts only an app signed by the same team with this bundle identifier that Gatekeeper accepts. It then swaps the app in place, keeping the old one until the new one is in, and relaunches. The updater is Cleer's (`UpdateInstaller.swift`). The app must be in a folder it can write to, such as Applications.
