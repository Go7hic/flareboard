package main

import (
	"time"

	"github.com/egoist/mygo/ui"
)

// iconButton is a square button showing an icon, which fills as the
// pointer goes over it.
func iconButton(c *ui.Context, icon *ui.SVG, label string, spin bool) ui.Element {
	t := c.Theme()
	p := colors(t)
	b := ui.ButtonBase(c).Size(28, 28).Center().Radius(6).Label(label).Tooltip(label).TextColor(t.TextMuted)
	switch {
	case b.Pressed():
		b.Background(p.press).TextColor(t.Text)
	case b.Hovered():
		b.Background(p.hover).TextColor(t.Text)
	}
	b.Children(func() {
		i := ui.Icon(c, icon).Size(15, 15)
		if spin {
			i.Rotate(i.Loop("spin", 900*time.Millisecond, ui.Linear) * 360)
		}
	})
	return b
}

// textButton is a quiet button of text, and an icon after it or not.
func textButton(c *ui.Context, label string, icon *ui.SVG) ui.Element {
	t := c.Theme()
	p := colors(t)
	b := ui.ButtonBase(c).Gap(4).Padding(4, 8).Radius(6).AlignItems(ui.Center).TextColor(t.Text)
	switch {
	case b.Pressed():
		b.Background(p.press)
	case b.Hovered():
		b.Background(p.hover)
	}
	b.Children(func() {
		ui.Text(c, label).FontSize(12).FontWeight(500).NoWrap()
		if icon != nil {
			ui.Icon(c, icon).Size(12, 12).TextColor(t.TextMuted)
		}
	})
	return b
}

// periodControl chooses the stats window: a small segmented control.
func periodControl(c *ui.Context, index *int, labels [3]string, label string) ui.Element {
	t := c.Theme()
	p := colors(t)
	seg := ui.SegmentedBase(c, index, len(labels))
	seg.Track.Label(label).Padding(2).Gap(2).Radius(7).Background(p.track).Children(func() {
		for i, name := range labels {
			s := seg.Segment(i).Padding(3, 8).Radius(5).TextColor(t.TextMuted)
			if i == *index {
				s.Background(p.raised).TextColor(t.Text).Shadow(0, 1, 2, 0, ui.RGBA(0, 0, 0, 0.08))
			} else if s.Hovered() {
				s.TextColor(t.Text)
			}
			s.Children(func() {
				ui.Text(c, name).FontSize(11).FontWeight(500).NoWrap()
			})
		}
	})
	return seg.Track
}

// deltaChip shows a change with an arrow, so it never relies on color.
func deltaChip(c *ui.Context, txt texts, change *float64, lowerIsBetter bool, large bool) {
	text := txt.delta(change)
	if text == "" {
		return
	}
	t := c.Theme()
	p := colors(t)
	tn := changeTone(change, lowerIsBetter)
	ink := p.toneColor(t, tn)
	icon := iconMinus
	if tn != toneFlat {
		if *change > 0 {
			icon = iconArrowUp
		} else {
			icon = iconArrowDown
		}
	}
	size, iconSize := float32(11), float32(10)
	row := ui.Row(c).Gap(2).AlignItems(ui.Center).TextColor(ink)
	if large {
		size, iconSize = 12, 11
		row.Padding(2, 6, 2, 5).Radius(5).Background(ink.Alpha(0.12))
	}
	row.Children(func() {
		ui.Icon(c, icon).Size(iconSize, iconSize)
		ui.Text(c, text).FontSize(size).FontWeight(600).FontFeatures("tnum").NoWrap()
	})
}

// skeleton is a block standing in for content that is loading.
func skeleton(c *ui.Context, w, h float32) ui.Element {
	p := colors(c.Theme())
	b := ui.Box(c).Height(h).Radius(4).Background(p.track)
	if w > 0 {
		b.Width(w)
	} else {
		b.FillWidth()
	}
	return b
}

// group is a rounded box of settings rows, with hairlines between them.
func group(c *ui.Context, fn func()) {
	p := colors(c.Theme())
	ui.Column(c).FillWidth().Radius(8).Background(p.group).Dividers(1, p.hairline).Children(fn)
}

// groupRow is one row of a group: a label, and controls after it.
func groupRow(c *ui.Context, label string, fn func()) {
	ui.Row(c).FillWidth().MinHeight(36).Padding(6, 10).Gap(8).AlignItems(ui.Center).Children(func() {
		ui.Text(c, label).FontSize(13).Grow(1)
		fn()
	})
}

// switchRow is a row of a group with a switch, which its label turns too.
// set receives the new value, which on already holds.
func switchRow(c *ui.Context, label string, on *bool, set func(bool)) {
	ui.Row(c).FillWidth().MinHeight(36).Padding(6, 10).Gap(8).AlignItems(ui.Center).Children(func() {
		if ui.Text(c, label).FontSize(13).Grow(1).Clicked() {
			*on = !*on
			set(*on)
		}
		if ui.Switch(c, on).Label(label).Changed() {
			set(*on)
		}
	})
}

func sectionTitle(c *ui.Context, text string) {
	ui.Text(c, text).FontSize(11).FontWeight(600).TextColor(c.Theme().TextMuted).Padding(8, 2, 0, 2)
}
