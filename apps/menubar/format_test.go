package main

import (
	"reflect"
	"testing"
)

func TestFormatCount(t *testing.T) {
	if got := formatCount(1240); got != "1,240" {
		t.Fatal(got)
	}
	if got := formatCount(12); got != "12" {
		t.Fatal(got)
	}
}

func TestFormatCompact(t *testing.T) {
	if got := formatCompact(1240); got != "1.2k" {
		t.Fatal(got)
	}
	if got := formatCompact(42); got != "42" {
		t.Fatal(got)
	}
	if got := formatCompact(2_400_000); got != "2.4M" {
		t.Fatal(got)
	}
}

func TestFormatChange(t *testing.T) {
	v := 12.0
	if got := formatChange(&v); got != "+12%" {
		t.Fatal(got)
	}
	v = -3.4
	if got := formatChange(&v); got != "-3%" {
		t.Fatal(got)
	}
	if formatChange(nil) != "" {
		t.Fatal("nil")
	}
}

func TestBounceRate(t *testing.T) {
	if got := bounceRate(610, 240); got < 39.3 || got > 39.4 {
		t.Fatal(got)
	}
	if bounceRate(0, 10) != 0 {
		t.Fatal("empty")
	}
}

func TestBounceRateChange(t *testing.T) {
	visitsChange := 0.0
	bounceChange := 10.0
	// same visits, 10% more bounces → bounce rate +10%
	delta := bounceRateChange(100, 50, &visitsChange, &bounceChange)
	if delta == nil || *delta < 9 || *delta > 11 {
		t.Fatalf("%v", delta)
	}
}

func TestChangeTone(t *testing.T) {
	up, down, flat := 12.0, -8.0, 0.2
	if changeTone(&up, false) != toneGood || changeTone(&down, false) != toneBad {
		t.Fatal("visitors")
	}
	if changeTone(&up, true) != toneBad || changeTone(&down, true) != toneGood {
		t.Fatal("bounce rate")
	}
	if changeTone(&flat, false) != toneFlat || changeTone(nil, false) != toneFlat {
		t.Fatal("flat")
	}
	if got := formatDeltaPercent(&down); got != "8%" {
		t.Fatal(got)
	}
}

func TestLocalizedNumbers(t *testing.T) {
	if got := deTexts.count(12480); got != "12.480" {
		t.Fatal(got)
	}
	if got := frTexts.count(12480); got != "12 480" {
		t.Fatal(got)
	}
	if got := deTexts.compact(1240); got != "1,2k" {
		t.Fatal(got)
	}
	if got := frTexts.pct(39.4, 1); got != "39,4 %" {
		t.Fatal(got)
	}
	if got := jaTexts.count(12480); got != "12,480" {
		t.Fatal(got)
	}
}

func TestLangFromLocale(t *testing.T) {
	for locale, want := range map[string]string{"zh-Hans-CN": "zh", "ja_JP": "ja", "de-AT": "de", "fr": "fr", "es-ES": "en", "": "en", "en-GB": "en"} {
		if got := langFromLocale(locale); got != want {
			t.Fatalf("%q: %q", locale, got)
		}
	}
}

func TestEveryLanguageHasEveryText(t *testing.T) {
	for _, l := range languages {
		v := reflect.ValueOf(*l.texts)
		for i := 0; i < v.NumField(); i++ {
			f := v.Field(i)
			empty := f.Kind() == reflect.String && f.String() == ""
			if f.Kind() == reflect.Array {
				for j := 0; j < f.Len(); j++ {
					empty = empty || f.Index(j).String() == ""
				}
			}
			if empty {
				t.Errorf("%s: %s is empty", l.code, v.Type().Field(i).Name)
			}
		}
	}
}
