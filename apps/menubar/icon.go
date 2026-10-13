package main

import (
	"bytes"
	_ "embed"
	"image/png"
	"runtime"
	"sync"

	"github.com/egoist/mygo/ui"
)

// tray.png is the F of the logo, black on transparent, 36px tall: macOS
// shows menu bar icons 18 points tall and tints template images.
//
//go:embed resources/tray.png
var trayPNG []byte

// mark.png is the colored logo, for the panel and for tray areas that do
// not tint icons.
//
//go:embed resources/mark.png
var markPNG []byte

func trayIcon() (icon []byte, template bool) {
	if runtime.GOOS == "darwin" {
		return trayPNG, true
	}
	return markPNG, false
}

var markBitmap = sync.OnceValue(func() *ui.Bitmap {
	img, err := png.Decode(bytes.NewReader(markPNG))
	if err != nil {
		panic(err)
	}
	return ui.NewBitmap(img)
})

// Icons are Lucide's (ISC license), drawn in the color of the text.
func lucide(body string) *ui.SVG {
	return ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` + body + `</svg>`))
}

var (
	iconRefresh     = lucide(`<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>`)
	iconSettings    = lucide(`<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>`)
	iconChevrons    = lucide(`<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>`)
	iconChevronLeft = lucide(`<path d="m15 18-6-6 6-6"/>`)
	iconArrowUp     = lucide(`<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>`)
	iconArrowDown   = lucide(`<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>`)
	iconMinus       = lucide(`<path d="M5 12h14"/>`)
	iconExternal    = lucide(`<path d="M7 7h10v10"/><path d="M7 17 17 7"/>`)
	iconAlert       = lucide(`<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>`)
	iconGlobe       = lucide(`<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>`)
	iconLogOut      = lucide(`<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>`)
)

// palette holds the panel's colors beyond the theme's: the chart's series
// color and the status colors match the dashboard's tokens.
type palette struct {
	series   ui.Color // --chart-1
	good     ui.Color // text of a better change
	bad      ui.Color // text of a worse change
	live     ui.Color // the online dot
	hairline ui.Color
	hover    ui.Color
	press    ui.Color
	track    ui.Color // the well of the period control
	raised   ui.Color // the chosen period
	group    ui.Color // grouped rows in the settings
	bar      ui.Color // share bars of the top pages
	tip      ui.Color // the chart's tooltip
}

func colors(t *ui.Theme) palette {
	ink := t.Text
	p := palette{
		hairline: ink.Alpha(0.1),
		hover:    ink.Alpha(0.06),
		press:    ink.Alpha(0.1),
		track:    ink.Alpha(0.06),
		group:    ink.Alpha(0.045),
	}
	if t.Dark {
		p.series = ui.Hex("#006efe")
		p.good = ui.Hex("#62c073")
		p.bad = ui.Hex("#ff6166")
		p.live = ui.Hex("#00ac3a")
		p.raised = ui.RGBA(255, 255, 255, 0.16)
		p.bar = p.series.Alpha(0.16)
		p.tip = ui.Hex("#2c2c2e")
	} else {
		p.series = ui.Hex("#006bff")
		p.good = ui.Hex("#297a3a")
		p.bad = ui.Hex("#cb2a2f")
		p.live = ui.Hex("#28a948")
		p.raised = ui.RGB(255, 255, 255)
		p.bar = p.series.Alpha(0.08)
		p.tip = ui.RGB(255, 255, 255)
	}
	return p
}

func (p palette) toneColor(t *ui.Theme, tn tone) ui.Color {
	switch tn {
	case toneGood:
		return p.good
	case toneBad:
		return p.bad
	}
	return t.TextMuted
}
