package main

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

// TestSnapshots renders the flyout's screens to PNG files for design review:
//
//	FLAREBOARD_SNAPSHOTS=/tmp/shots go test -run TestSnapshots .
//
// It is skipped unless the variable is set.
func TestSnapshots(t *testing.T) {
	dir := os.Getenv("FLAREBOARD_SNAPSHOTS")
	if dir == "" {
		t.Skip("set FLAREBOARD_SNAPSHOTS to a directory to render the screens")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, l := range languages {
		lang := l.code
		for _, dark := range []bool{false, true} {
			theme := "light"
			if dark {
				theme = "dark"
			}
			for name, setup := range snapshotStates() {
				a := testApp(&fakeFetcher{})
				a.systemLang = lang
				a.lang = lang
				setup(a)
				tt := ui.NewTester(a.view, panelWidth, panelHeight)
				tt.SetScale(2)
				tt.SetDark(dark)
				tt.SetVibrancy(true)
				tt.Frame()
				tt.Frame()
				writePNG(t, filepath.Join(dir, lang+"-"+theme+"-"+name+".png"), onDesktop(tt.Image(), dark))
			}
		}
	}
}

func snapshotStates() map[string]func(*app) {
	sites := []Website{{ID: "w1", Name: "Flareboard", Domain: "flareboard.dev"}, {ID: "w2", Name: "Blog", Domain: "blog.example"}}
	loaded := func(a *app) {
		a.applySettings(Settings{APIKey: "fb_sk_test_1234", WebsiteID: "w1"})
		a.account = Account{Username: "go7hic", DisplayName: "Go7hic"}
		a.websites = sites
		a.overview = sampleOverview()
		a.hasOverview = true
		a.live, a.hasLive = 8, true
		a.fetchedAt = testNow.Add(-2 * time.Minute)
	}
	return map[string]func(*app){
		"connect": func(a *app) {},
		"connect-error": func(a *app) {
			a.draft.APIKey = "fb_sk_revoked"
			a.formErr = a.txt().badKey
			a.advancedOpen = true
		},
		"stats": loaded,
		"stats-hover": func(a *app) {
			loaded(a)
			a.hover = 18
		},
		"settings": func(a *app) {
			loaded(a)
			a.openSettings()
		},
		"loading": func(a *app) {
			a.applySettings(Settings{APIKey: "fb_sk_test_1234"})
			a.loading = true
		},
		"error": func(a *app) {
			loaded(a)
			a.err = fmt.Sprintf(a.txt().offline, "api.flareboard.dev")
		},
		"no-sites": func(a *app) {
			a.applySettings(Settings{APIKey: "fb_sk_test_1234"})
		},
		"empty-period": func(a *app) {
			loaded(a)
			a.overview = Overview{Stats: a.overview.Stats}
			a.overview.Stats.Visitors = Stat{}
		},
	}
}

// onDesktop puts the transparent flyout on a plain backdrop, as the menu bar's vibrancy would.
func onDesktop(img *image.RGBA, dark bool) *image.RGBA {
	out := image.NewRGBA(img.Bounds())
	bg := color.RGBA{236, 236, 238, 255}
	if dark {
		bg = color.RGBA{30, 30, 32, 255}
	}
	draw.Draw(out, out.Bounds(), image.NewUniform(bg), image.Point{}, draw.Src)
	draw.Draw(out, out.Bounds(), img, image.Point{}, draw.Over)
	return out
}

func writePNG(t *testing.T, path string, img image.Image) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
}
