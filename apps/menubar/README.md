# Flareboard menu bar

A native macOS menu bar app (MyGo, no webview) for one Flareboard website at a glance. It signs in with a personal API key (`fb_sk_…`, read scope).

- The icon shows how many people are on the website now (or the period's visitors, or nothing: **Settings → Next to the icon**). It updates every 30 seconds.
- The panel shows visitors for 24 hours, 7 days or 30 days with the change against the previous period, a chart (hover for each hour or day), pageviews, visits, bounce rate and the top pages. A click on a page opens it on the website.
- The website menu (top left) switches websites. **Open dashboard** opens the website in the console.
- The panel speaks English, Simplified Chinese, Japanese, German and French, as the dashboard does. It follows the system language unless **Settings → Language** picks one. The copy is in `copy.go` (English, Chinese) and `locales.go` (Japanese, German, French), with the dashboard's terms; a test fails when a language misses a text.
- Shortcuts in the panel: `⌘R` refreshes, `⌘,` opens the settings, `Esc` goes back or closes.

## Run

Needs [Go 1.27](https://go.dev/dl/) or later.

```bash
cd apps/menubar
CGO_ENABLED=0 go test ./...
go tool mygo vet .
go tool mygo dev
```

Click the menu bar icon and paste an API key from the console: account menu, then **API keys**. The app checks the key before keeping it. Self-hosted installs set their API URL under **Self-hosted server**.

```bash
go tool mygo build          # build/darwin-arm64/Flareboard.app and a .dmg
```

The key is stored in the app's user-data directory as `settings.json`, mode `0600`. Development builds (`mygo dev`) use a separate data folder from a packaged app. **Open at login** works for the packaged app in Applications.

## Design review

The views render without a window. This writes every screen, in every language, light and dark, to PNG files:

```bash
FLAREBOARD_SNAPSHOTS=/tmp/flareboard-shots CGO_ENABLED=0 go test -run TestSnapshots .
```

The images in `resources/` come from the dashboard logo (`apps/dashboard/public/logo.avif`): `icon.png` is the app icon, `mark.png` the logo in the panel, and `tray.png` the F of the logo as a template image for the menu bar.

## Releases and updates

`scripts/release.sh` releases from this Mac, the way Cleer does: `mygo build` signs the app with the Developer ID in `mygo.json`, notarizes the universal disk image with the `AC_PASSWORD` notarytool profile of the login keychain, signs the update, and uploads both to the GitHub release `menubar-v<version>`. The release is never marked latest, so the product's `v1.x` releases keep that. Installed apps check the newest `menubar-v` release once a day (**Settings → Updates**, or **Check for Updates…** in the icon's right-click menu), show the version's section of `CHANGELOG.md`, and replace themselves. MyGo signs updates with its own key, and the app checks them against `updates.publicKey` in `mygo.json`.

To release:

1. Bump `version` in `mygo.json` and `appVersion` in `view_settings.go` (a test checks they match), and add a `## <version>` section to `CHANGELOG.md`.
2. Commit and push to main, then run `apps/menubar/scripts/release.sh`.

The secret key that signs updates is in `~/Library/Application Support/mygo/update-keys/` (`MYGO_UPDATE_KEY` points elsewhere). Keep a copy in a password manager: installed apps accept only updates signed with it.
