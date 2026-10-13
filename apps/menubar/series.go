package main

import (
	"strings"
	"time"
)

// TrayMode is what the menu bar shows next to the icon.
type TrayMode string

const (
	TrayOnline   TrayMode = "online"
	TrayVisitors TrayMode = "visitors"
	TrayIcon     TrayMode = "icon"
)

var trayModes = []TrayMode{TrayOnline, TrayVisitors, TrayIcon}

func parseTrayMode(s string) TrayMode {
	switch TrayMode(s) {
	case TrayVisitors, TrayIcon:
		return TrayMode(s)
	default:
		return TrayOnline
	}
}

func (s Settings) trayMode() TrayMode { return parseTrayMode(s.TrayMode) }

func trayModeIndex(m TrayMode) int {
	for i, v := range trayModes {
		if v == m {
			return i
		}
	}
	return 0
}

// Bucket is one point of a chart: the start of its hour or day, and its
// value, zero where the API sent none.
type Bucket struct {
	At    time.Time
	Value float64
}

// fillSeries lays the API's points on every bucket of the range. The API
// leaves out hours and days without events, and keys hours in UTC and
// days in the website's time zone.
func fillSeries(points []Point, r Range, timezone string) []Bucket {
	loc := time.UTC
	step := time.Hour
	layout := "2006-01-02 15:00"
	if r.Unit == "day" {
		step = 0
		layout = "2006-01-02"
		if l, err := time.LoadLocation(timezone); err == nil && timezone != "" {
			loc = l
		}
	}
	values := map[string]float64{}
	for _, p := range points {
		if at, ok := parseBucket(p.X, loc); ok {
			values[at.In(loc).Format(layout)] += p.Y
		}
	}
	start := time.UnixMilli(r.StartAt).In(loc)
	end := time.UnixMilli(r.EndAt).In(loc)
	var at time.Time
	if step == 0 {
		at = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, loc)
	} else {
		at = start.Truncate(step)
	}
	var out []Bucket
	for !at.After(end) && len(out) < 400 {
		out = append(out, Bucket{At: at, Value: values[at.Format(layout)]})
		if step == 0 {
			at = at.AddDate(0, 0, 1)
		} else {
			at = at.Add(step)
		}
	}
	return out
}

func parseBucket(x string, loc *time.Location) (time.Time, bool) {
	x = strings.TrimSpace(x)
	if t, err := time.Parse(time.RFC3339, x); err == nil {
		return t, true
	}
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02 15:04", "2006-01-02T15:04:05", "2006-01-02"} {
		if t, err := time.ParseInLocation(layout, x, loc); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// VisitorSeries is the chart's data: visitors per bucket, or pageviews
// from an API too old to send visitors.
func (o Overview) VisitorSeries() []Point {
	if len(o.Timeseries.Visitors) > 0 || len(o.Timeseries.Pageviews) > 0 {
		return o.Timeseries.Visitors
	}
	return o.Pageviews.Pageviews
}
