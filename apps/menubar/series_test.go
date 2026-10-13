package main

import (
	"testing"
	"time"
)

func TestFillSeriesHoursKeepsEmptyHours(t *testing.T) {
	r := Period24h.Range(testNow)
	got := fillSeries([]Point{{X: "2026-10-12 14:00", Y: 5}, {X: "2026-10-11 15:00", Y: 2}}, r, "Asia/Shanghai")
	if len(got) != 25 {
		t.Fatalf("%d buckets", len(got))
	}
	if got[0].Value != 2 || got[23].Value != 5 || got[10].Value != 0 {
		t.Fatalf("%+v", got)
	}
	if !got[24].At.Equal(testNow) {
		t.Fatal(got[24].At)
	}
}

func TestFillSeriesDaysUsesTheWebsiteTimeZone(t *testing.T) {
	r := Period7d.Range(testNow) // 15:00 UTC is 23:00 in Shanghai
	got := fillSeries([]Point{{X: "2026-10-12", Y: 9}, {X: "2026-10-05", Y: 1}}, r, "Asia/Shanghai")
	if len(got) != 8 {
		t.Fatalf("%d buckets", len(got))
	}
	loc, _ := time.LoadLocation("Asia/Shanghai")
	if got[0].Value != 1 || got[7].Value != 9 || got[7].At.In(loc).Day() != 12 {
		t.Fatalf("%+v", got)
	}
}

func TestParseTrayMode(t *testing.T) {
	if parseTrayMode("") != TrayOnline || parseTrayMode("icon") != TrayIcon {
		t.Fatal("tray mode")
	}
}
