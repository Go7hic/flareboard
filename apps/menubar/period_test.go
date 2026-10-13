package main

import (
	"testing"
	"time"
)

func TestParsePeriod(t *testing.T) {
	if parsePeriod("7d") != Period7d {
		t.Fatal(parsePeriod("7d"))
	}
	if parsePeriod("nope") != Period24h {
		t.Fatal(parsePeriod("nope"))
	}
}

func TestPeriodRange(t *testing.T) {
	now := time.Date(2026, 10, 12, 15, 0, 0, 0, time.UTC)
	r := Period24h.Range(now)
	if r.Unit != "hour" {
		t.Fatalf("unit %s", r.Unit)
	}
	if r.EndAt-r.StartAt != 24*60*60*1000 {
		t.Fatalf("span %d", r.EndAt-r.StartAt)
	}
	r7 := Period7d.Range(now)
	if r7.Unit != "day" || r7.EndAt-r7.StartAt != 7*24*60*60*1000 {
		t.Fatalf("7d %+v", r7)
	}
}

func TestPeriodIndexRoundTrip(t *testing.T) {
	for _, p := range []Period{Period24h, Period7d, Period30d} {
		if got := periodFromIndex(p.index()); got != p {
			t.Fatalf("%s -> %d -> %s", p, p.index(), got)
		}
	}
}
