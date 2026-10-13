package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPFetcherOverview(t *testing.T) {
	var gotAuth, gotPath, gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		_ = json.NewEncoder(w).Encode(Overview{
			Stats: OverviewStats{
				Pageviews: Stat{Value: 1240},
				Visitors:  Stat{Value: 530},
			},
			Timeseries: Timeseries{Pageviews: []Point{{X: "2026-10-08", Y: 410}}},
			Metrics:    []Point{{X: "/pricing", Y: 220}},
		})
	}))
	defer srv.Close()

	h := &HTTPFetcher{HTTP: srv.Client()}
	out, err := h.Overview(context.Background(), Settings{BaseURL: srv.URL, APIKey: "fb_sk_test"}, "site-1", Range{StartAt: 1, EndAt: 2, Unit: "day"})
	if err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer fb_sk_test" {
		t.Fatalf("auth %q", gotAuth)
	}
	if gotPath != "/api/websites/site-1/stats/overview" {
		t.Fatalf("path %q", gotPath)
	}
	if !strings.Contains(gotQuery, "startAt=1") || !strings.Contains(gotQuery, "unit=day") {
		t.Fatalf("query %q", gotQuery)
	}
	if out.Stats.Visitors.Value != 530 || len(out.Timeseries.Pageviews) != 1 {
		t.Fatalf("%+v", out)
	}
}

func TestHTTPFetcherUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"Invalid API key"}`))
	}))
	defer srv.Close()
	h := &HTTPFetcher{HTTP: srv.Client()}
	_, err := h.Me(context.Background(), Settings{BaseURL: srv.URL, APIKey: "nope"})
	ae, ok := err.(*APIError)
	if !ok || ae.Status != 401 || ae.Message != "Invalid API key" {
		t.Fatalf("%v", err)
	}
}

func TestNormalizeURLs(t *testing.T) {
	if got := normalizeBaseURL("api.example.com/"); got != "https://api.example.com" {
		t.Fatal(got)
	}
	if got := normalizeConsoleURL("", "https://api.flareboard.dev"); got != defaultConsoleURL {
		t.Fatal(got)
	}
	if got := normalizeConsoleURL("", "http://localhost:8788"); got != "http://localhost:5173" {
		t.Fatal(got)
	}
}

func TestSiteNameAndPageURL(t *testing.T) {
	if got := siteName(Website{Name: "Docs", Domain: "docs.dev"}); got != "Docs" {
		t.Fatal(got)
	}
	if got := siteName(Website{ID: "w1", Domain: "docs.dev"}); got != "docs.dev" {
		t.Fatal(got)
	}
	if got := pageURL(Website{Domain: "docs.dev"}, "/pricing"); got != "https://docs.dev/pricing" {
		t.Fatal(got)
	}
	if got := pageURL(Website{Domain: "docs.dev"}, "(none)"); got != "" {
		t.Fatal(got)
	}
}

func TestHTTPFetcherRealtime(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_, _ = w.Write([]byte(`{"visitors":8,"sessions":[],"window30":{"visitors":30}}`))
	}))
	defer srv.Close()
	h := &HTTPFetcher{HTTP: srv.Client()}
	n, err := h.Realtime(context.Background(), Settings{BaseURL: srv.URL, APIKey: "fb_sk_test"}, "site-1")
	if err != nil || n != 8 || gotPath != "/api/realtime/site-1" {
		t.Fatalf("%d %v %q", n, err, gotPath)
	}
}

func TestDescribeError(t *testing.T) {
	if got := describeError(enTexts, &APIError{Status: 401, Message: "Invalid API key"}, defaultAPIBase); got != enTexts.badKey {
		t.Fatal(got)
	}
	_, err := (&HTTPFetcher{HTTP: http.DefaultClient}).Me(context.Background(), Settings{BaseURL: "http://127.0.0.1:1", APIKey: "k"})
	if got := describeError(enTexts, err, "http://127.0.0.1:1"); !strings.Contains(got, "127.0.0.1:1") {
		t.Fatal(got)
	}
}
