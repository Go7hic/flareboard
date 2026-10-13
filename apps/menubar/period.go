package main

import "time"

// Period is a preset stats window the flyout can show.
type Period string

const (
	Period24h Period = "24h"
	Period7d  Period = "7d"
	Period30d Period = "30d"
)

func parsePeriod(s string) Period {
	switch Period(s) {
	case Period7d, Period30d:
		return Period(s)
	default:
		return Period24h
	}
}

func (p Period) index() int {
	switch p {
	case Period7d:
		return 1
	case Period30d:
		return 2
	default:
		return 0
	}
}

func periodFromIndex(i int) Period {
	switch i {
	case 1:
		return Period7d
	case 2:
		return Period30d
	default:
		return Period24h
	}
}

// Range is the API's startAt/endAt window in UTC milliseconds, plus the
// bucket size /stats/overview should use.
type Range struct {
	StartAt int64
	EndAt   int64
	Unit    string
}

func (p Period) Range(now time.Time) Range {
	end := now.UTC()
	switch p {
	case Period7d:
		return Range{StartAt: end.Add(-7 * 24 * time.Hour).UnixMilli(), EndAt: end.UnixMilli(), Unit: "day"}
	case Period30d:
		return Range{StartAt: end.Add(-30 * 24 * time.Hour).UnixMilli(), EndAt: end.UnixMilli(), Unit: "day"}
	default:
		return Range{StartAt: end.Add(-24 * time.Hour).UnixMilli(), EndAt: end.UnixMilli(), Unit: "hour"}
	}
}
