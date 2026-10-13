package main

import (
	"fmt"
	"math"
	"runtime"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/chart"
)

func (a *app) view(c *ui.Context) {
	if c.Shortcut(0, ui.KeyEscape) {
		switch {
		case a.screen == screenSettings && a.connected():
			a.closeSettings()
		case a.panel != nil:
			a.panel.Close()
		}
	}
	t := c.Theme()
	c.Root().Background(ui.Transparent)
	box := ui.Column(c).Fill()
	switch {
	case c.Vibrancy():
	case runtime.GOOS == "windows":
		box.Background(t.Background)
	default:
		box.Background(t.Background).Radius(12).Border(1, t.Border)
	}
	box.Children(func() {
		switch {
		case !a.connected():
			a.connectView(c)
		case a.screen == screenSettings:
			a.settingsView(c)
		default:
			a.statsView(c)
		}
	})
}

func (a *app) statsView(c *ui.Context) {
	if c.Shortcut(ui.Cmd, ui.KeyR) && !a.loading {
		a.refresh(false)
	}
	if c.Shortcut(ui.Cmd, ui.KeyComma) {
		a.openSettings()
	}
	a.statsHeader(c)
	ui.Scroll(c).Grow(1).FillWidth().Children(func() {
		ui.Column(c).FillWidth().Padding(6, 16, 14, 16).Gap(14).Children(func() {
			if a.err != "" {
				a.errorBanner(c)
			}
			switch {
			case !a.hasOverview && a.loading:
				a.statsSkeleton(c)
			case !a.hasOverview && len(a.websites) == 0 && a.err == "":
				a.noWebsites(c)
			case a.hasOverview:
				a.hero(c)
				a.trendChart(c)
				a.kpiStrip(c)
				a.topPages(c)
			}
		})
	})
	a.statsFooter(c)
}

func (a *app) statsHeader(c *ui.Context) {
	txt := a.txt()
	t := c.Theme()
	p := colors(t)
	ui.Row(c).FillWidth().Padding(10, 10, 6, 10).Gap(2).AlignItems(ui.Center).Children(func() {
		site, ok := a.website()
		picker := ui.ButtonBase(c.Key("site")).Gap(8).Padding(4, 6).Radius(7).AlignItems(ui.Center).
			Shrink(1).MinWidth(0).Label(txt.switchWebsite)
		switch {
		case picker.Pressed():
			picker.Background(p.press)
		case picker.Hovered():
			picker.Background(p.hover)
		}
		picker.Children(func() {
			ui.Image(c, markBitmap()).Size(20, 20).Radius(5)
			name := txt.title
			if ok {
				name = siteName(site)
			}
			ui.Text(c, name).FontSize(13).FontWeight(600).SingleLine().Shrink(1)
			if len(a.websites) > 0 {
				ui.Icon(c, iconChevrons).Size(12, 12).TextColor(t.TextMuted)
			}
		})
		if len(a.websites) > 0 {
			picker.Menu(func(m *ui.Menu) {
				for _, w := range a.websites {
					if m.Item(siteName(w)).Checked(w.ID == a.settings.WebsiteID).Chosen() {
						a.pickWebsite(w.ID)
					}
				}
				m.Separator()
				if m.Item(txt.addWebsite).Chosen() {
					c.Services().OpenURL(a.settings.ConsoleURL + "/websites")
				}
			})
		}
		ui.Spacer(c)
		if iconButton(c.Key("refresh"), iconRefresh, txt.refresh, a.loading).Clicked() && !a.loading {
			a.refresh(false)
		}
		if iconButton(c.Key("settings"), iconSettings, txt.settings, false).Clicked() {
			a.openSettings()
		}
	})
}

func (a *app) errorBanner(c *ui.Context) {
	t := c.Theme()
	txt := a.txt()
	ui.Row(c).FillWidth().Padding(8, 8, 8, 10).Gap(8).Radius(8).AlignItems(ui.Start).
		Background(t.Danger.Alpha(0.1)).Children(func() {
		ui.Icon(c, iconAlert).Size(14, 14).TextColor(t.Danger).Margin(2, 0, 0, 0)
		ui.Text(c, a.err).FontSize(12).Grow(1).Shrink(1).Selectable()
		if textButton(c.Key("retry"), txt.retry, nil).Clicked() {
			a.refresh(len(a.websites) == 0)
		}
	})
}

func (a *app) hero(c *ui.Context) {
	t := c.Theme()
	p := colors(t)
	txt := a.txt()
	s := a.overview.Stats.Visitors
	ui.Row(c).FillWidth().AlignItems(ui.Start).Gap(12).Children(func() {
		ui.Column(c).Grow(1).Gap(3).Children(func() {
			ui.Text(c, txt.visitors).FontSize(12).FontWeight(500).TextColor(t.TextMuted)
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				ui.Text(c, txt.count(s.Value)).FontSize(30).FontWeight(600).LetterSpacing(-0.6).NoWrap()
				deltaChip(c, txt, s.Change, false, true)
			})
			if s.Change != nil {
				ui.Text(c, txt.compared[a.periodIndex]).FontSize(11).TextColor(t.TextMuted)
			}
		})
		ui.Column(c).AlignItems(ui.End).Gap(10).Children(func() {
			if periodControl(c.Key("period"), &a.periodIndex, txt.periods, txt.period).Changed() {
				a.setPeriod(a.periodIndex)
			}
			if a.hasLive {
				ui.Row(c).Gap(6).AlignItems(ui.Center).Padding(0, 2).Children(func() {
					dot := p.live
					if a.live == 0 {
						dot = t.TextMuted.Alpha(0.6)
					}
					ui.Box(c).Size(7, 7).Radius(4).Background(dot)
					ui.Text(c, txt.onlineCount(a.live)).FontSize(12).FontWeight(500).FontFeatures("tnum").NoWrap()
				})
			}
		})
	})
}

func (a *app) trendChart(c *ui.Context) {
	t := c.Theme()
	p := colors(t)
	txt := a.txt()
	r := a.settings.period().Range(a.fetchedAt)
	site, _ := a.website()
	buckets := fillSeries(a.overview.VisitorSeries(), r, site.Timezone)
	if len(buckets) < 2 {
		return
	}
	n := len(buckets)
	xs := make([]float32, n)
	vals := make([]float64, n)
	for i, b := range buckets {
		xs[i] = float32(i) / float32(n-1)
		vals[i] = b.Value
	}
	_, hi := chart.Extent(vals...)
	empty := hi <= 0
	if empty {
		hi = 1
	}
	y := chart.NewLinear(0, hi*1.12)
	ys := make([]float32, n)
	for i, v := range vals {
		ys[i] = y.At(v)
	}
	if a.hover >= n {
		a.hover = -1
	}
	describe := func(i int) string {
		return txt.bucketLabel(buckets[i].At, r.Unit, true) + " · " + txt.visitorCount(vals[i])
	}
	ui.Column(c).FillWidth().Gap(6).Children(func() {
		chart.Plot(c, chart.Axes{}, func(area ui.Element) {
			area.Draw(func(pt *ui.Painter, rc ui.Rect) {
				pt.Line(rc.X, rc.Y+rc.H-0.5, rc.X+rc.W, rc.Y+rc.H-0.5, 1, p.hairline)
				if empty {
					return
				}
				pt.FillPath(chart.Area(rc, xs, nil, ys, chart.CurveMonotone), p.series.Alpha(0.1))
				pt.StrokePath(chart.Line(rc, xs, ys, chart.CurveMonotone), 2, p.series)
			})
			if empty {
				chart.Anchor(c, 0.5, 0.5, ui.Center, ui.Center, func() {
					ui.Text(c, txt.noVisitors[a.periodIndex]).FontSize(12).TextColor(t.TextMuted).NoWrap()
				})
				return
			}
			chart.Select(c, area, &a.hover, xs, describe)
			if i := a.hover; i >= 0 {
				chart.RuleX(c, xs[i], 1).Background(t.TextMuted.Alpha(0.5))
				chart.Point(c, xs[i], ys[i], 8, 8).Radius(4).Background(p.series).Border(2, p.raised)
				h := ui.Center
				switch {
				case i < n/5:
					h = ui.Start
				case i > n-1-n/5:
					h = ui.End
				}
				// The tip hangs from the top, or stands on the bottom when the
				// point is high enough to be under it.
				tipY, v := float32(1), ui.Start
				if ys[i] > 0.5 {
					tipY, v = 0, ui.End
				}
				chart.Anchor(c, xs[i], tipY, h, v, func() {
					ui.Column(c).Padding(5, 8).Gap(1).Radius(6).Background(p.tip).Border(1, p.hairline).TextColor(t.Text).
						Shadow(0, 4, 12, 0, ui.RGBA(0, 0, 0, 0.12)).Children(func() {
						ui.Text(c, txt.bucketLabel(buckets[i].At, r.Unit, true)).FontSize(10).NoWrap().TextColor(t.TextMuted)
						ui.Text(c, txt.visitorCount(vals[i])).FontSize(12).FontWeight(600).FontFeatures("tnum").NoWrap()
					})
				})
			}
		}).Label(txt.chartLabel).Height(84).FillWidth()
		ui.Row(c).FillWidth().Children(func() {
			first := txt.bucketLabel(buckets[0].At, r.Unit, false)
			mid := txt.bucketLabel(buckets[n/2].At, r.Unit, false)
			last := txt.now
			if r.Unit == "day" {
				last = txt.today
			}
			for i, label := range []string{first, mid, last} {
				l := ui.Text(c, label).FontSize(10).FontFeatures("tnum").TextColor(t.TextMuted).NoWrap().Grow(1).Basis(0)
				switch i {
				case 1:
					l.TextAlign(ui.Center)
				case 2:
					l.TextAlign(ui.End)
				}
			}
		})
	})
}

func (a *app) kpiStrip(c *ui.Context) {
	t := c.Theme()
	p := colors(t)
	txt := a.txt()
	s := a.overview.Stats
	bounce := bounceRate(s.Visits.Value, s.Bounces.Value)
	bounceChange := bounceRateChange(s.Visits.Value, s.Bounces.Value, s.Visits.Change, s.Bounces.Change)
	digits := 0
	if bounce > 0 && bounce < 10 {
		digits = 1
	}
	cell := func(label, value string, change *float64, lowerIsBetter bool) {
		ui.Column(c).Grow(1).Gap(3).Padding(10, 12).Children(func() {
			ui.Text(c, label).FontSize(11).TextColor(t.TextMuted).SingleLine()
			ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
				ui.Text(c, value).FontSize(15).FontWeight(600).FontFeatures("tnum").NoWrap()
				deltaChip(c, txt, change, lowerIsBetter, false)
			})
		})
	}
	ui.Row(c).FillWidth().AlignItems(ui.Stretch).Radius(8).Border(1, p.hairline).Dividers(1, p.hairline).Children(func() {
		cell(txt.pageviews, txt.compactCount(s.Pageviews.Value), s.Pageviews.Change, false)
		cell(txt.visits, txt.compactCount(s.Visits.Value), s.Visits.Change, false)
		cell(txt.bounce, txt.pct(bounce, digits), bounceChange, true)
	})
}

func (a *app) topPages(c *ui.Context) {
	pages := a.overview.Metrics
	if len(pages) == 0 {
		return
	}
	t := c.Theme()
	p := colors(t)
	txt := a.txt()
	site, _ := a.website()
	var top float64
	for _, pg := range pages {
		top = math.Max(top, pg.Y)
	}
	ui.Column(c).FillWidth().Gap(4).Children(func() {
		ui.Row(c).FillWidth().Padding(0, 8, 2, 8).Children(func() {
			ui.Text(c, txt.topPages).FontSize(12).FontWeight(600).Grow(1)
			ui.Text(c, txt.views).FontSize(11).TextColor(t.TextMuted)
		})
		for i, pg := range pages {
			path := pg.X
			if path == "" {
				path = "/"
			}
			share := float32(0)
			if top > 0 {
				share = float32(pg.Y / top)
			}
			link := pageURL(site, path)
			row := ui.ButtonBase(c.Key(fmt.Sprintf("page-%d", i))).FillWidth().Height(26).Radius(5).
				Label(fmt.Sprintf(txt.openPage, path)).Disabled(link == "")
			if row.Hovered() && link != "" {
				row.Background(p.hover)
			}
			row.Children(func() {
				ui.Box(c).Absolute().Left(0).Top(0).Bottom(0).WidthPercent(share * 100).Radius(5).Background(p.bar)
				ui.Row(c).Fill().Padding(0, 8).Gap(8).AlignItems(ui.Center).Children(func() {
					ui.Text(c, path).FontSize(12).SingleLine().Grow(1).Shrink(1)
					ui.Text(c, txt.count(pg.Y)).FontSize(12).FontFeatures("tnum").TextColor(t.TextMuted).NoWrap()
				})
			})
			if row.Clicked() && link != "" {
				c.Services().OpenURL(link)
			}
		}
	})
}

func (a *app) statsSkeleton(c *ui.Context) {
	ui.Column(c).FillWidth().Gap(16).Opacity(0.8).Children(func() {
		ui.Row(c).FillWidth().Children(func() {
			ui.Column(c).Grow(1).Gap(8).Children(func() {
				skeleton(c, 56, 10)
				skeleton(c, 120, 28)
				skeleton(c, 96, 10)
			})
			skeleton(c, 112, 22)
		})
		skeleton(c, 0, 84)
		skeleton(c, 0, 52)
		ui.Column(c).FillWidth().Gap(6).Children(func() {
			for _, w := range []float32{0.9, 0.7, 0.55, 0.4, 0.3} {
				skeleton(c, 0, 22).WidthPercent(w * 100)
			}
		})
	})
}

func (a *app) noWebsites(c *ui.Context) {
	t := c.Theme()
	txt := a.txt()
	ui.Column(c).FillWidth().Padding(48, 16).Gap(8).AlignItems(ui.Center).Children(func() {
		ui.Icon(c, iconGlobe).Size(28, 28).TextColor(t.TextMuted).Margin(0, 0, 6, 0)
		ui.Text(c, txt.noSitesTitle).FontSize(14).FontWeight(600)
		ui.Text(c, txt.noSitesBody).FontSize(12).TextColor(t.TextMuted).TextAlign(ui.Center)
		if ui.PrimaryButton(c.Key("add-site"), txt.addWebsite).Margin(8, 0, 0, 0).Clicked() {
			c.Services().OpenURL(a.settings.ConsoleURL + "/websites")
		}
	})
}

func (a *app) statsFooter(c *ui.Context) {
	t := c.Theme()
	p := colors(t)
	txt := a.txt()
	ui.Row(c).FillWidth().Padding(6, 10, 8, 16).AlignItems(ui.Center).BorderWidth(1, 0, 0, 0).BorderColor(p.hairline).Children(func() {
		status := ""
		if !a.fetchedAt.IsZero() {
			ago := a.now().Sub(a.fetchedAt)
			status = txt.updatedAgo(ago)
			c.After(30 * time.Second)
		}
		ui.Text(c, status).FontSize(11).TextColor(t.TextMuted).Grow(1).SingleLine()
		if textButton(c.Key("dashboard"), txt.openDashboard, iconExternal).Clicked() {
			c.Services().OpenURL(a.dashboardURL())
		}
	})
}

// compactCount keeps numbers in the KPI cells short enough for a third
// of the panel.
func (t texts) compactCount(n float64) string {
	if math.Abs(n) >= 100_000 {
		return t.compact(n)
	}
	return t.count(n)
}
