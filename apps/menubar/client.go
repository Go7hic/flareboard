package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const defaultAPIBase = "https://api.flareboard.dev"
const defaultConsoleURL = "https://flareboard.dev"

// Settings is what the app keeps between launches.
type Settings struct {
	BaseURL    string `json:"baseURL"`
	ConsoleURL string `json:"consoleURL"`
	APIKey     string `json:"apiKey"`
	WebsiteID  string `json:"websiteID"`
	Period     string `json:"period"`
	TrayMode   string `json:"trayMode,omitempty"`
	// Language is a code of languages, or empty to follow the system.
	Language string `json:"language,omitempty"`
}

func (s Settings) period() Period {
	return parsePeriod(s.Period)
}

// Account is GET /api/me.
type Account struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

// Website is one row of GET /api/websites.
type Website struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Domain   string `json:"domain"`
	Timezone string `json:"timezone"`
}

// Stat is a KPI and its percent change against the previous window.
type Stat struct {
	Value  float64  `json:"value"`
	Change *float64 `json:"change"`
}

// Point is one bucket of a time series or breakdown.
type Point struct {
	X string  `json:"x"`
	Y float64 `json:"y"`
}

// Overview is GET /api/websites/:id/stats/overview.
type Overview struct {
	Stats      OverviewStats `json:"stats"`
	Pageviews  SeriesWrap    `json:"pageviews"`
	Metrics    []Point       `json:"metrics"`
	Timeseries Timeseries    `json:"timeseries"`
}

type OverviewStats struct {
	Pageviews Stat `json:"pageviews"`
	Visitors  Stat `json:"visitors"`
	Visits    Stat `json:"visits"`
	Bounces   Stat `json:"bounces"`
	Totaltime Stat `json:"totaltime"`
}

type SeriesWrap struct {
	Pageviews []Point `json:"pageviews"`
}

type Timeseries struct {
	Pageviews []Point `json:"pageviews"`
	Visitors  []Point `json:"visitors"`
}

// Fetcher loads Flareboard data. Tests swap in a fake.
type Fetcher interface {
	Me(ctx context.Context, cfg Settings) (Account, error)
	Websites(ctx context.Context, cfg Settings) ([]Website, error)
	Overview(ctx context.Context, cfg Settings, websiteID string, r Range) (Overview, error)
	// Realtime returns how many visitors are on the website now.
	Realtime(ctx context.Context, cfg Settings, websiteID string) (int, error)
}

type HTTPFetcher struct {
	HTTP *http.Client
}

func newHTTPFetcher() *HTTPFetcher {
	return &HTTPFetcher{HTTP: &http.Client{Timeout: 20 * time.Second}}
}

func (h *HTTPFetcher) Me(ctx context.Context, cfg Settings) (Account, error) {
	var acc Account
	err := h.get(ctx, cfg, "/api/me", nil, &acc)
	return acc, err
}

func (h *HTTPFetcher) Websites(ctx context.Context, cfg Settings) ([]Website, error) {
	var sites []Website
	err := h.get(ctx, cfg, "/api/websites", nil, &sites)
	if sites == nil {
		sites = []Website{}
	}
	return sites, err
}

func (h *HTTPFetcher) Overview(ctx context.Context, cfg Settings, websiteID string, r Range) (Overview, error) {
	var out Overview
	q := url.Values{
		"startAt": {fmt.Sprintf("%d", r.StartAt)},
		"endAt":   {fmt.Sprintf("%d", r.EndAt)},
		"unit":    {r.Unit},
		"type":    {"path"},
		"limit":   {"5"},
	}
	err := h.get(ctx, cfg, "/api/websites/"+url.PathEscape(websiteID)+"/stats/overview", q, &out)
	return out, err
}

func (h *HTTPFetcher) Realtime(ctx context.Context, cfg Settings, websiteID string) (int, error) {
	var out struct {
		Visitors int `json:"visitors"`
	}
	err := h.get(ctx, cfg, "/api/realtime/"+url.PathEscape(websiteID), nil, &out)
	return out.Visitors, err
}

func (h *HTTPFetcher) get(ctx context.Context, cfg Settings, path string, query url.Values, dest any) error {
	base := strings.TrimRight(cfg.BaseURL, "/")
	if base == "" {
		base = defaultAPIBase
	}
	u, err := url.Parse(base + path)
	if err != nil {
		return err
	}
	if query != nil {
		u.RawQuery = query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.APIKey))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Flareboard-Menubar/0.2")

	client := h.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		return err
	}
	if res.StatusCode >= 300 {
		return apiError(res.StatusCode, body)
	}
	if dest == nil {
		return nil
	}
	if err := json.Unmarshal(body, dest); err != nil {
		return fmt.Errorf("unexpected response: %w", err)
	}
	return nil
}

type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("HTTP %d", e.Status)
}

func apiError(status int, body []byte) error {
	var payload struct {
		Message string `json:"message"`
	}
	_ = json.Unmarshal(body, &payload)
	msg := strings.TrimSpace(payload.Message)
	switch {
	case status == 401:
		if msg == "" {
			msg = "Invalid API key"
		}
	case status == 403 && msg == "":
		msg = "This API key does not have the read scope"
	case status == 404 && msg == "":
		msg = "Website not found"
	case msg == "":
		msg = fmt.Sprintf("HTTP %d", status)
	}
	return &APIError{Status: status, Message: msg}
}

func normalizeBaseURL(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return defaultAPIBase
	}
	s = strings.TrimRight(s, "/")
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	return s
}

func normalizeConsoleURL(raw, apiBase string) string {
	s := strings.TrimSpace(raw)
	if s != "" {
		return strings.TrimRight(s, "/")
	}
	switch {
	case strings.Contains(apiBase, "api.flareboard.dev"):
		return defaultConsoleURL
	case strings.Contains(apiBase, "localhost:8788") || strings.Contains(apiBase, "127.0.0.1:8788"):
		return "http://localhost:5173"
	default:
		return strings.TrimRight(apiBase, "/")
	}
}

// siteName is how the panel names a website: its name, or its domain.
func siteName(w Website) string {
	if name := strings.TrimSpace(w.Name); name != "" {
		return name
	}
	if domain := strings.TrimSpace(w.Domain); domain != "" {
		return domain
	}
	return w.ID
}

// pageURL is a top page on the website itself.
func pageURL(w Website, path string) string {
	domain := strings.TrimSpace(w.Domain)
	if domain == "" || !strings.HasPrefix(path, "/") {
		return ""
	}
	if !strings.Contains(domain, "://") {
		domain = "https://" + domain
	}
	return strings.TrimRight(domain, "/") + path
}

func hostOf(base string) string {
	if u, err := url.Parse(base); err == nil && u.Host != "" {
		return u.Host
	}
	return base
}

// describeError says what went wrong in the panel's words.
func describeError(txt texts, err error, base string) string {
	var ae *APIError
	if errors.As(err, &ae) {
		switch ae.Status {
		case 401:
			return txt.badKey
		case 403:
			return txt.noScope
		}
		return ae.Message
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Sprintf(txt.timeout, hostOf(base))
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		if ue.Timeout() {
			return fmt.Sprintf(txt.timeout, hostOf(base))
		}
		return fmt.Sprintf(txt.offline, hostOf(base))
	}
	return err.Error()
}

func websiteURL(consoleURL, websiteID string) string {
	base := strings.TrimRight(consoleURL, "/")
	if base == "" {
		base = defaultConsoleURL
	}
	return base + "/websites/" + url.PathEscape(websiteID)
}

func apiKeysURL(consoleURL string) string {
	base := strings.TrimRight(consoleURL, "/")
	if base == "" {
		base = defaultConsoleURL
	}
	return base + "/api-keys"
}
