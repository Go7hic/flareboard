package main

import (
	"fmt"
	"math"
	"strings"
)

func formatCount(n float64) string {
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return "—"
	}
	if n < 0 {
		return "-" + formatCount(-n)
	}
	v := int64(math.Round(n))
	if v < 1000 {
		return fmt.Sprintf("%d", v)
	}
	s := fmt.Sprintf("%d", v)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}
	return b.String()
}

func formatCompact(n float64) string {
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return ""
	}
	abs := math.Abs(n)
	sign := ""
	if n < 0 {
		sign = "-"
	}
	switch {
	case abs >= 1_000_000:
		return sign + trimFloat(abs/1_000_000) + "M"
	case abs >= 1000:
		return sign + trimFloat(abs/1000) + "k"
	default:
		return sign + fmt.Sprintf("%.0f", abs)
	}
}

func trimFloat(v float64) string {
	s := fmt.Sprintf("%.1f", v)
	s = strings.TrimSuffix(s, ".0")
	return s
}

func formatPercent(n float64, digits int) string {
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return "—"
	}
	if digits < 0 {
		digits = 0
	}
	return fmt.Sprintf("%.*f%%", digits, n)
}

func formatChange(change *float64) string {
	if change == nil || math.IsNaN(*change) || math.IsInf(*change, 0) {
		return ""
	}
	v := *change
	switch {
	case v > 0.05:
		return fmt.Sprintf("+%.0f%%", v)
	case v < -0.05:
		return fmt.Sprintf("%.0f%%", v)
	default:
		return "0%"
	}
}

func bounceRate(visits, bounces float64) float64 {
	if visits <= 0 {
		return 0
	}
	return (bounces / visits) * 100
}

func previousValue(value float64, change *float64) (float64, bool) {
	if change == nil {
		return 0, false
	}
	factor := 1 + *change/100
	if factor <= 0 {
		return 0, false
	}
	return value / factor, true
}

func bounceRateChange(visits, bounces float64, visitChange, bounceChange *float64) *float64 {
	prevVisits, okV := previousValue(visits, visitChange)
	prevBounces, okB := previousValue(bounces, bounceChange)
	if !okV || !okB || prevVisits <= 0 {
		return nil
	}
	prev := (prevBounces / prevVisits) * 100
	if prev == 0 {
		return nil
	}
	cur := bounceRate(visits, bounces)
	delta := ((cur - prev) / prev) * 100
	return &delta
}

// tone is how a change reads: better, worse, or about the same.
type tone int

const (
	toneFlat tone = iota
	toneGood
	toneBad
)

// changeTone reads a percent change; lowerIsBetter flips it, as for the
// bounce rate.
func changeTone(change *float64, lowerIsBetter bool) tone {
	if change == nil || math.IsNaN(*change) || math.IsInf(*change, 0) || math.Abs(*change) < 0.5 {
		return toneFlat
	}
	up := *change > 0
	if up != lowerIsBetter {
		return toneGood
	}
	return toneBad
}

// formatDeltaPercent is a change without its sign, which an arrow shows.
func formatDeltaPercent(change *float64) string {
	if change == nil || math.IsNaN(*change) || math.IsInf(*change, 0) {
		return ""
	}
	v := math.Abs(*change)
	if v >= 1000 {
		return formatCompact(v) + "%"
	}
	return fmt.Sprintf("%.0f%%", v)
}
