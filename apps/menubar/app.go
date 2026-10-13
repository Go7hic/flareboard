package main

import (
	"context"
	"log"
	"runtime"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

type screen int

const (
	screenStats screen = iota
	screenSettings
)

const (
	panelWidth  = 360
	panelHeight = 540
	// livePoll is how often the online count next to the icon updates.
	livePoll = 30 * time.Second
	// staleAfter is how old the stats may be before opening the panel
	// loads them again.
	staleAfter = 60 * time.Second
)

// loginItem starts the app when the user logs in. Tests swap in a fake,
// as mygo.App only answers on the main thread of a running app.
type loginItem interface {
	Enabled() bool
	SetEnabled(on bool) error
}

type appLogin struct{}

func (appLogin) Enabled() bool            { return mygo.App.OpenAtLogin() }
func (appLogin) SetEnabled(on bool) error { return mygo.App.SetOpenAtLogin(on) }

// app is the flyout's state. Tray callbacks and the view read and change
// it on the main thread. Fetches run on other goroutines and come back
// through onMain.
type app struct {
	// lang is the language the panel shows: the setting's, or the
	// system's (systemLang).
	lang       string
	systemLang string
	api        Fetcher
	login      loginItem
	updates    appUpdater
	tray       *mygo.Tray
	menu       *mygo.Menu
	panel      *mygo.Window
	now        func() time.Time
	// spawn runs a fetch off the main thread; tests run it in place.
	spawn func(func())

	settings Settings
	draft    Settings
	screen   screen

	account       Account
	websites      []Website
	periodIndex   int
	overview      Overview
	hasOverview   bool
	live          int
	hasLive       bool
	loading       bool
	connecting    bool
	err           string
	formErr       string
	loginErr      string
	openAtLogin   bool
	autoUpdate    bool
	trayModeIndex int
	langChoice    string
	advancedOpen  bool
	hover         int
	fetchedAt     time.Time
	gen           int
	liveGen       int
	persistOK     bool
}

func newApp() *app {
	return &app{
		lang:       "en",
		systemLang: "en",
		api:        newHTTPFetcher(),
		login:      appLogin{},
		updates:    pluginUpdater{},
		now:        time.Now,
		spawn:      func(fn func()) { go fn() },
		hover:      -1,
		draft:      Settings{BaseURL: defaultAPIBase},
	}
}

func (a *app) onMain(fn func()) {
	if a.panel != nil {
		a.panel.Update(fn)
		return
	}
	if !a.persistOK {
		fn()
		return
	}
	mygo.RunOnMain(fn)
}

func (a *app) persist() {
	if !a.persistOK {
		return
	}
	if err := saveSettings(a.settings); err != nil {
		log.Println("settings:", err)
	}
}

func (a *app) connected() bool {
	return strings.TrimSpace(a.settings.APIKey) != ""
}

func (a *app) applySettings(s Settings) {
	s.BaseURL = normalizeBaseURL(s.BaseURL)
	s.ConsoleURL = normalizeConsoleURL(s.ConsoleURL, s.BaseURL)
	s.Period = string(parsePeriod(s.Period))
	s.TrayMode = string(parseTrayMode(s.TrayMode))
	a.settings = s
	a.draft = s
	a.periodIndex = s.period().index()
	a.trayModeIndex = trayModeIndex(s.trayMode())
	a.lang = a.resolveLang()
	a.langChoice = a.langLabel(s.Language)
	if s.APIKey == "" {
		a.screen = screenSettings
	} else {
		a.screen = screenStats
	}
}

func (a *app) openSettings() {
	a.draft = a.settings
	if a.draft.BaseURL == "" {
		a.draft.BaseURL = defaultAPIBase
	}
	a.formErr = ""
	a.screen = screenSettings
}

func (a *app) closeSettings() {
	if !a.connected() {
		return
	}
	a.formErr = ""
	a.screen = screenStats
}

// connect checks the key in the draft against the API, and keeps it only
// once the API accepts it.
func (a *app) connect() {
	if a.connecting {
		return
	}
	txt := a.txt()
	key := strings.TrimSpace(a.draft.APIKey)
	switch {
	case key == "":
		a.formErr = txt.needKey
		return
	case strings.HasPrefix(key, "fb_pk_"):
		a.formErr = txt.needPersonal
		return
	}
	next := a.settings
	next.APIKey = key
	next.BaseURL = normalizeBaseURL(a.draft.BaseURL)
	next.ConsoleURL = normalizeConsoleURL(a.draft.ConsoleURL, next.BaseURL)
	a.formErr = ""
	a.connecting = true
	a.spawn(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		account, err := a.api.Me(ctx, next)
		var sites []Website
		if err == nil {
			sites, err = a.api.Websites(ctx, next)
		}
		a.onMain(func() {
			a.connecting = false
			if err != nil {
				a.formErr = describeError(a.txt(), err, next.BaseURL)
				return
			}
			changedServer := next.BaseURL != a.settings.BaseURL
			a.account = account
			a.websites = sites
			if changedServer || !hasWebsite(sites, next.WebsiteID) {
				next.WebsiteID = ""
			}
			a.applySettings(next)
			a.hasOverview = false
			a.hasLive = false
			a.persist()
			a.refresh(false)
		})
	})
}

// disconnect forgets the key and everything loaded with it.
func (a *app) disconnect() {
	a.gen++
	a.liveGen++
	keep := Settings{BaseURL: a.settings.BaseURL, ConsoleURL: a.settings.ConsoleURL, Period: a.settings.Period, TrayMode: a.settings.TrayMode, Language: a.settings.Language}
	a.applySettings(keep)
	a.account = Account{}
	a.websites = nil
	a.overview = Overview{}
	a.hasOverview = false
	a.hasLive = false
	a.loading = false
	a.err = ""
	a.formErr = ""
	a.persist()
	a.syncTray()
}

func (a *app) pickWebsite(id string) {
	if a.settings.WebsiteID == id || !hasWebsite(a.websites, id) {
		return
	}
	a.settings.WebsiteID = id
	a.hasOverview = false
	a.hasLive = false
	a.hover = -1
	a.persist()
	a.refresh(false)
}

func (a *app) setPeriod(index int) {
	p := periodFromIndex(index)
	a.periodIndex = index
	if a.settings.Period == string(p) {
		return
	}
	a.settings.Period = string(p)
	a.hover = -1
	a.persist()
	a.refresh(false)
}

func (a *app) setTrayMode(m TrayMode) {
	a.settings.TrayMode = string(m)
	a.trayModeIndex = trayModeIndex(m)
	a.persist()
	a.syncTray()
}

func (a *app) resolveLang() string {
	for _, l := range languages {
		if l.code == a.settings.Language {
			return l.code
		}
	}
	return a.systemLang
}

// langOptions are the choices of the language setting: the system's, then
// each language by its own name.
func (a *app) langOptions() []string {
	opts := []string{a.txt().system}
	for _, l := range languages {
		opts = append(opts, l.name)
	}
	return opts
}

func (a *app) langLabel(code string) string {
	for _, l := range languages {
		if l.code == code {
			return l.name
		}
	}
	return a.txt().system
}

// setLanguageChoice applies the language setting's label.
func (a *app) setLanguageChoice(label string) {
	code := ""
	for _, l := range languages {
		if l.name == label {
			code = l.code
		}
	}
	a.settings.Language = code
	a.lang = a.resolveLang()
	a.langChoice = a.langLabel(code)
	a.persist()
	a.buildMenu()
	a.syncTray()
}

func (a *app) setOpenAtLogin(on bool) {
	a.loginErr = ""
	if err := a.login.SetEnabled(on); err != nil {
		a.openAtLogin = !on
		a.loginErr = a.txt().loginFailed
		log.Println("open at login:", err)
		return
	}
	a.openAtLogin = on
}

// saveConnection applies a changed API or console URL from the settings.
func (a *app) saveConnection() {
	a.draft.APIKey = a.settings.APIKey
	a.connect()
}

func (a *app) website() (Website, bool) {
	for _, w := range a.websites {
		if w.ID == a.settings.WebsiteID {
			return w, true
		}
	}
	return Website{}, false
}

func (a *app) refresh(reloadSites bool) {
	if !a.connected() {
		a.screen = screenSettings
		return
	}
	a.gen++
	gen := a.gen
	a.loading = true
	a.err = ""
	cfg := a.settings
	wantSites := reloadSites || len(a.websites) == 0
	known := a.websites
	account := a.account
	now := a.now()
	a.spawn(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		var (
			sites    = known
			overview Overview
			live     int
			liveErr  error
			err      error
		)
		if wantSites {
			account, err = a.api.Me(ctx, cfg)
			if err == nil {
				sites, err = a.api.Websites(ctx, cfg)
			}
		}
		id := cfg.WebsiteID
		if err == nil && len(sites) > 0 {
			if !hasWebsite(sites, id) {
				id = sites[0].ID
			}
			overview, err = a.api.Overview(ctx, cfg, id, cfg.period().Range(now))
			if err == nil {
				live, liveErr = a.api.Realtime(ctx, cfg, id)
			}
		}
		a.onMain(func() {
			if a.gen != gen {
				return
			}
			a.loading = false
			if err != nil {
				a.err = describeError(a.txt(), err, cfg.BaseURL)
				if ae, ok := err.(*APIError); ok && ae.Status == 401 {
					// The key was revoked: ask for a new one.
					a.disconnect()
					a.formErr = a.txt().badKey
				}
				return
			}
			a.account = account
			a.websites = sites
			if id != a.settings.WebsiteID {
				a.settings.WebsiteID = id
				a.persist()
			}
			a.overview = overview
			a.hasOverview = len(sites) > 0
			a.live, a.hasLive = live, liveErr == nil && len(sites) > 0
			a.fetchedAt = a.now()
			a.syncTray()
		})
	})
}

// refreshLive updates the online count alone, for the icon's title.
func (a *app) refreshLive() {
	if !a.connected() || a.settings.WebsiteID == "" || a.loading {
		return
	}
	a.liveGen++
	gen := a.liveGen
	cfg := a.settings
	a.spawn(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		live, err := a.api.Realtime(ctx, cfg, cfg.WebsiteID)
		a.onMain(func() {
			if a.liveGen != gen || a.settings.WebsiteID != cfg.WebsiteID {
				return
			}
			if err != nil {
				return
			}
			a.live, a.hasLive = live, true
			a.syncTray()
		})
	})
}

// tick runs every livePoll on the main thread: it keeps the online count
// current, and the stats too while the panel shows them.
func (a *app) tick() {
	if !a.connected() {
		return
	}
	if a.panel != nil && a.screen == screenStats && a.now().Sub(a.fetchedAt) > staleAfter {
		a.refresh(false)
		return
	}
	a.refreshLive()
}

func hasWebsite(sites []Website, id string) bool {
	for _, w := range sites {
		if w.ID == id {
			return true
		}
	}
	return false
}

func (a *app) syncTray() {
	if a.tray == nil {
		return
	}
	txt := a.txt()
	site, ok := a.website()
	if !a.connected() || !ok {
		a.tray.SetTitle("")
		a.tray.SetToolTip(txt.title)
		return
	}
	title := ""
	switch a.settings.trayMode() {
	case TrayOnline:
		if a.hasLive {
			title = " " + txt.compact(float64(a.live))
		}
	case TrayVisitors:
		if a.hasOverview {
			title = " " + txt.compact(a.overview.Stats.Visitors.Value)
		}
	}
	a.tray.SetTitle(title)
	tip := siteName(site)
	if a.hasLive {
		tip = txt.onlineCount(a.live) + " · " + tip
	}
	a.tray.SetToolTip(tip)
}

func (a *app) toggle() {
	if a.panel != nil {
		a.panel.Close()
		return
	}
	if a.connected() {
		a.screen = screenStats
	}
	a.hover = -1
	a.panel = mygo.NewFlyout(mygo.FlyoutOptions{
		Tray:      a.tray,
		Placement: mygo.PlacementBottom,
		Gap:       4,
		Width:     panelWidth,
		Height:    panelHeight,
		Focusable: true,
		Shadow:    true,
		Popover:   true,
		Content:   ui.View(a.view),
	})
	a.panel.OnClosed(func() { a.panel = nil })
	if a.connected() && (a.now().Sub(a.fetchedAt) > staleAfter || !a.hasOverview) {
		a.refresh(len(a.websites) == 0)
	}
}

func (a *app) ready() {
	a.persistOK = true
	a.systemLang = detectLang()
	a.lang = a.systemLang
	if loaded, err := loadSettings(); err != nil {
		log.Println("settings:", err)
	} else {
		a.applySettings(loaded)
	}
	a.langChoice = a.langLabel(a.settings.Language)
	a.openAtLogin = a.login.Enabled()
	a.autoUpdate = a.updates.Automatic()
	var err error
	icon, template := trayIcon()
	a.tray, err = mygo.NewTray(mygo.TrayOptions{
		Icon:           icon,
		IconIsTemplate: template,
		ToolTip:        a.txt().title,
	})
	if err != nil {
		log.Fatal("tray: ", err)
	}
	a.buildMenu()
	if runtime.GOOS != "linux" {
		a.tray.OnClick(a.toggle)
		a.tray.OnRightClick(func() {
			if a.panel != nil {
				a.panel.Close()
			}
			a.tray.SetMenu(a.menu)
			defer a.tray.SetMenu(nil)
			a.tray.PopUpMenu()
		})
	}
	mygo.App.OnWillQuit(func(*mygo.QuitEvent) { a.tray.Destroy() })
	if a.connected() {
		a.refresh(true)
	}
	go func() {
		for range time.Tick(livePoll) {
			mygo.RunOnMain(a.tick)
		}
	}()
}

// buildMenu makes the icon's menu in the panel's language.
func (a *app) buildMenu() {
	if a.tray == nil {
		return
	}
	txt := a.txt()
	a.menu = mygo.NewMenu([]*mygo.MenuItem{
		{Label: txt.openFlareboard, Click: func(*mygo.MenuItem, *mygo.Window) { a.toggle() }},
		{Label: txt.openDashboard, Click: func(*mygo.MenuItem, *mygo.Window) { a.openURL(a.dashboardURL()) }},
		mygo.Separator(),
		{Label: txt.checkUpdates, Click: func(*mygo.MenuItem, *mygo.Window) { a.updates.Check() }},
		mygo.Separator(),
		{Label: txt.quit, Click: func(*mygo.MenuItem, *mygo.Window) { mygo.App.Quit() }},
	})
	if runtime.GOOS == "linux" {
		a.tray.SetMenu(a.menu)
	}
}

func (a *app) openURL(u string) {
	if err := mygo.Shell.OpenExternal(u); err != nil {
		log.Println("open:", err)
	}
}

func (a *app) dashboardURL() string {
	if a.settings.WebsiteID == "" {
		return strings.TrimRight(a.settings.ConsoleURL, "/") + "/websites"
	}
	return websiteURL(a.settings.ConsoleURL, a.settings.WebsiteID)
}
