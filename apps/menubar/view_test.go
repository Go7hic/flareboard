package main

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

var testNow = time.Date(2026, 10, 12, 15, 0, 0, 0, time.UTC)

// testApp is an app whose fetches run in place, against a fake API.
func testApp(api *fakeFetcher) *app {
	a := newApp()
	a.lang = "en"
	a.now = func() time.Time { return testNow }
	a.api = api
	a.login = &fakeLogin{}
	a.updates = &fakeUpdater{}
	a.spawn = func(fn func()) { fn() }
	return a
}

func connectedApp(api *fakeFetcher) *app {
	a := testApp(api)
	a.applySettings(Settings{APIKey: "fb_sk_test_1234", WebsiteID: "w1"})
	a.account = api.account
	a.websites = api.sites
	return a
}

func TestConnectAsksForKey(t *testing.T) {
	a := testApp(&fakeFetcher{})
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	if !tt.HasText("Connect Flareboard") {
		t.Fatalf("texts %q", tt.Texts())
	}
	if err := tt.Click("Connect"); err != nil {
		t.Fatal(err)
	}
	if a.formErr != enTexts.needKey {
		t.Fatalf("formErr %q", a.formErr)
	}
}

func TestConnectRejectsProjectKey(t *testing.T) {
	a := testApp(&fakeFetcher{})
	a.draft.APIKey = "fb_pk_public"
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	if err := tt.Click("Connect"); err != nil {
		t.Fatal(err)
	}
	if a.formErr != enTexts.needPersonal || a.connected() {
		t.Fatalf("formErr %q", a.formErr)
	}
}

func TestConnectKeepsOnlyAWorkingKey(t *testing.T) {
	api := &fakeFetcher{meErr: &APIError{Status: 401, Message: "Invalid API key"}}
	a := testApp(api)
	a.draft.APIKey = "fb_sk_revoked"
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	if err := tt.Click("Connect"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if a.connected() || a.formErr != enTexts.badKey || !tt.HasText(enTexts.badKey) {
		t.Fatalf("connected %v formErr %q", a.connected(), a.formErr)
	}

	api.meErr = nil
	api.sites = []Website{{ID: "w1", Name: "Docs", Domain: "docs.dev"}}
	api.overview = sampleOverview()
	api.live = 8
	a.draft.APIKey = "fb_sk_good_key"
	if err := tt.Click("Connect"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !a.connected() || a.settings.WebsiteID != "w1" || !a.hasOverview {
		t.Fatalf("settings %+v overview %v", a.settings, a.hasOverview)
	}
	for _, want := range []string{"Docs", "3,260", "8 online", "Top pages", "/pricing"} {
		if !tt.HasText(want) {
			t.Fatalf("missing %q in %q", want, tt.Texts())
		}
	}
}

func TestStatsShowsKPIs(t *testing.T) {
	api := &fakeFetcher{sites: []Website{{ID: "w1", Name: "Docs", Domain: "docs.dev"}}}
	a := connectedApp(api)
	a.overview = sampleOverview()
	a.hasOverview = true
	a.fetchedAt = testNow.Add(-2 * time.Minute)
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	for _, want := range []string{"Visitors", "3,260", "Pageviews", "12,480", "Visits", "Bounce rate", "40%", "vs previous 24 hours", "Updated 2 min ago", "/pricing"} {
		if !tt.HasText(want) {
			t.Fatalf("missing %q in %q", want, tt.Texts())
		}
	}
}

func TestPeriodControlChangesSetting(t *testing.T) {
	api := &fakeFetcher{sites: []Website{{ID: "w1", Name: "Docs"}}, overview: sampleOverview()}
	a := connectedApp(api)
	a.overview = sampleOverview()
	a.hasOverview = true
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	if err := tt.Click("7d"); err != nil {
		t.Fatal(err)
	}
	if a.settings.Period != string(Period7d) || a.periodIndex != 1 || api.lastRange.Unit != "day" {
		t.Fatalf("period %s index %d range %+v", a.settings.Period, a.periodIndex, api.lastRange)
	}
	tt.Frame()
	if !tt.HasText("vs previous 7 days") {
		t.Fatalf("texts %q", tt.Texts())
	}
}

func TestTopPageOpensOnTheWebsite(t *testing.T) {
	api := &fakeFetcher{sites: []Website{{ID: "w1", Name: "Docs", Domain: "docs.dev"}}}
	a := connectedApp(api)
	a.overview = sampleOverview()
	a.hasOverview = true
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	if err := tt.Click("/pricing"); err != nil {
		t.Fatal(err)
	}
	if got := tt.OpenedURLs(); len(got) != 1 || got[0] != "https://docs.dev/pricing" {
		t.Fatalf("opened %q", got)
	}
}

func TestErrorShowsRetry(t *testing.T) {
	api := &fakeFetcher{sites: []Website{{ID: "w1", Name: "Docs"}}}
	a := connectedApp(api)
	a.err = "Can't reach api.flareboard.dev. Check your connection."
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	api.overview = sampleOverview()
	if err := tt.Click("Try again"); err != nil {
		t.Fatal(err)
	}
	if a.err != "" || !a.hasOverview {
		t.Fatalf("err %q overview %v", a.err, a.hasOverview)
	}
}

func TestNoWebsitesInvitesToAddOne(t *testing.T) {
	a := connectedApp(&fakeFetcher{})
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	if !tt.HasText("No websites yet") {
		t.Fatalf("texts %q", tt.Texts())
	}
}

func TestSettingsChangeTrayModeAndDisconnect(t *testing.T) {
	api := &fakeFetcher{sites: []Website{{ID: "w1", Name: "Docs"}}, account: Account{Username: "ada"}}
	a := connectedApp(api)
	a.openSettings()
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	for _, want := range []string{"Settings", "ada", "fb_sk_…1234", "Online now", "Open at login"} {
		if !tt.HasText(want) {
			t.Fatalf("missing %q in %q", want, tt.Texts())
		}
	}
	if err := tt.Click("Nothing"); err != nil {
		t.Fatal(err)
	}
	if a.settings.trayMode() != TrayIcon {
		t.Fatalf("tray mode %q", a.settings.TrayMode)
	}
	if err := tt.Click("Open at login"); err != nil {
		t.Fatal(err)
	}
	if !a.openAtLogin || !a.login.(*fakeLogin).on {
		t.Fatal("open at login")
	}
	if err := tt.Click("Disconnect"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if a.connected() || !tt.HasText("Connect Flareboard") {
		t.Fatalf("still connected, texts %q", tt.Texts())
	}
}

func TestRevokedKeyAsksForANewOne(t *testing.T) {
	api := &fakeFetcher{meErr: &APIError{Status: 401}}
	a := connectedApp(api)
	a.refresh(true)
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	if a.connected() || !tt.HasText("Connect Flareboard") || !tt.HasText(enTexts.badKey) {
		t.Fatalf("connected %v texts %q", a.connected(), tt.Texts())
	}
}

func TestLanguageSettingSwitchesThePanel(t *testing.T) {
	a := connectedApp(&fakeFetcher{sites: []Website{{ID: "w1", Name: "Docs"}}})
	a.overview = sampleOverview()
	a.hasOverview = true
	a.setLanguageChoice("Deutsch")
	if a.lang != "de" || a.settings.Language != "de" || a.langChoice != "Deutsch" {
		t.Fatalf("lang %q setting %q choice %q", a.lang, a.settings.Language, a.langChoice)
	}
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	for _, want := range []string{"Besucher", "3.260", "12.480", "40\u00a0%", "Top-Seiten"} {
		if !tt.HasText(want) {
			t.Fatalf("missing %q in %q", want, tt.Texts())
		}
	}
	a.setLanguageChoice(enTexts.system)
	if a.lang != "en" || a.settings.Language != "" || a.langChoice != "System" {
		t.Fatalf("lang %q setting %q choice %q", a.lang, a.settings.Language, a.langChoice)
	}
}

func TestSettingsChecksForUpdates(t *testing.T) {
	a := connectedApp(&fakeFetcher{sites: []Website{{ID: "w1", Name: "Docs"}}})
	a.openSettings()
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	if !tt.HasText("Version " + appVersion) {
		t.Fatalf("texts %q", tt.Texts())
	}
	if err := tt.Click("Check now"); err != nil {
		t.Fatal(err)
	}
	if err := tt.Click("Check for updates automatically"); err != nil {
		t.Fatal(err)
	}
	up := a.updates.(*fakeUpdater)
	if up.checks != 1 || !up.auto || !a.autoUpdate {
		t.Fatalf("%+v", up)
	}
}

func TestVersionMatchesMygoJSON(t *testing.T) {
	raw, err := os.ReadFile("mygo.json")
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct {
		Version string `json:"version"`
		Updates struct {
			GitHub    string `json:"github"`
			TagPrefix string `json:"tagPrefix"`
		} `json:"updates"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Version != appVersion {
		t.Fatalf("mygo.json %s, appVersion %s", cfg.Version, appVersion)
	}
	// The repository's other releases (v1.x, sdk-js-v…) must not look like the app's.
	if cfg.Updates.TagPrefix != "menubar-v" || cfg.Updates.GitHub == "" {
		t.Fatalf("%+v", cfg.Updates)
	}
	changelog, err := os.ReadFile("CHANGELOG.md")
	if err != nil || !strings.Contains(string(changelog), "\n## "+appVersion+"\n") {
		t.Fatalf("CHANGELOG.md needs a ## %s section", appVersion)
	}
}

func TestEscapeLeavesSettings(t *testing.T) {
	a := connectedApp(&fakeFetcher{sites: []Website{{ID: "w1", Name: "Docs"}}})
	a.openSettings()
	tt := ui.NewTester(a.view, panelWidth, panelHeight)
	tt.Key(0, ui.KeyEscape)
	if a.screen != screenStats {
		t.Fatal("still in settings")
	}
}

func sampleOverview() Overview {
	up, down, flat := 12.4, -8.1, 0.0
	var visitors, pageviews []Point
	for i, v := range []float64{140, 120, 160, 140, 210, 260, 230, 300, 280, 340, 310, 390, 420, 380, 460, 510, 470, 530, 560, 520, 610, 640, 600, 680, 520} {
		x := testNow.Add(time.Duration(i-24) * time.Hour).Format("2006-01-02 15:00")
		if i == 7 {
			continue // an hour without visits, which the API leaves out
		}
		visitors = append(visitors, Point{X: x, Y: v})
		pageviews = append(pageviews, Point{X: x, Y: v * 3.8})
	}
	return Overview{
		Stats: OverviewStats{
			Pageviews: Stat{Value: 12480, Change: &up},
			Visitors:  Stat{Value: 3260, Change: &up},
			Visits:    Stat{Value: 4110, Change: &down},
			Bounces:   Stat{Value: 1640, Change: &flat},
		},
		Timeseries: Timeseries{Pageviews: pageviews, Visitors: visitors},
		Metrics: []Point{
			{X: "/", Y: 4210}, {X: "/pricing", Y: 1830}, {X: "/docs/quickstart", Y: 1210},
			{X: "/blog/flareboard-is-live", Y: 860}, {X: "/demo", Y: 640},
		},
	}
}

type fakeFetcher struct {
	account   Account
	meErr     error
	sites     []Website
	overview  Overview
	live      int
	lastRange Range
}

func (f *fakeFetcher) Me(context.Context, Settings) (Account, error) {
	return f.account, f.meErr
}

func (f *fakeFetcher) Websites(context.Context, Settings) ([]Website, error) {
	return f.sites, nil
}

func (f *fakeFetcher) Overview(_ context.Context, _ Settings, _ string, r Range) (Overview, error) {
	f.lastRange = r
	return f.overview, nil
}

func (f *fakeFetcher) Realtime(context.Context, Settings, string) (int, error) {
	return f.live, nil
}

type fakeUpdater struct {
	checks int
	auto   bool
}

func (f *fakeUpdater) Enabled() bool        { return true }
func (f *fakeUpdater) Check()               { f.checks++ }
func (f *fakeUpdater) Automatic() bool      { return f.auto }
func (f *fakeUpdater) SetAutomatic(on bool) { f.auto = on }

type fakeLogin struct{ on bool }

func (f *fakeLogin) Enabled() bool { return f.on }
func (f *fakeLogin) SetEnabled(on bool) error {
	f.on = on
	return nil
}
