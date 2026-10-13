package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

// texts is the panel's copy in one language.
type texts struct {
	lang string
	// Numbers: the separators of thousands and decimals, and what follows
	// a percentage.
	group, decimal, percent string

	title          string
	openFlareboard string
	openDashboard  string
	quit           string
	version        string

	// Connecting.
	connectTitle string
	connectLead  string
	apiKey       string
	connect      string
	connecting   string
	createKey    string
	selfHosted   string
	apiBase      string
	apiBaseHint  string
	consoleURL   string
	consoleHint  string
	needKey      string
	needPersonal string
	badKey       string
	noScope      string
	offline      string // %s is the API's host
	timeout      string // %s is the API's host

	// Stats.
	switchWebsite string
	addWebsite    string
	refresh       string
	settings      string
	period        string
	periods       [3]string
	compared      [3]string
	visitors      string
	visitorsCount string // %s is a count
	pageviews     string
	visits        string
	bounce        string
	topPages      string
	views         string
	now           string
	today         string
	online        string // %s is a count
	updatedNow    string
	updated       string // %s is how long ago
	minutesAgo    string // %d
	hoursAgo      string // %d
	retry         string
	noSitesTitle  string
	noSitesBody   string
	noVisitors    [3]string
	chartLabel    string
	openPage      string

	// Settings.
	back         string
	account      string
	disconnect   string
	menuBar      string
	showInMenu   string
	trayModes    [3]string
	openAtLogin  string
	loginFailed  string
	connection   string
	save         string
	saving       string
	general      string
	language     string
	system       string
	updates      string
	checkNow     string
	autoUpdate   string
	checkUpdates string
}

var enTexts = texts{
	lang:           "en",
	group:          ",",
	decimal:        ".",
	percent:        "%",
	title:          "Flareboard",
	openFlareboard: "Open Flareboard",
	openDashboard:  "Open dashboard",
	quit:           "Quit Flareboard",
	version:        "Version %s",

	connectTitle: "Connect Flareboard",
	connectLead:  "See who is on your website from the menu bar. Paste a personal API key: read access is enough.",
	apiKey:       "API key",
	connect:      "Connect",
	connecting:   "Connecting…",
	createKey:    "Create an API key",
	selfHosted:   "Self-hosted server",
	apiBase:      "API URL",
	apiBaseHint:  "Your own API, if you run Flareboard yourself.",
	consoleURL:   "Dashboard URL",
	consoleHint:  "Leave blank to guess it from the API URL.",
	needKey:      "Paste a personal API key.",
	needPersonal: "This is a project key (fb_pk_…). Use a personal key that starts with fb_sk_.",
	badKey:       "This API key does not work. It may have been revoked: create a new one in the dashboard.",
	noScope:      "This API key cannot read stats. Create one with read access.",
	offline:      "Can't reach %s. Check your connection.",
	timeout:      "%s is taking too long to answer.",

	switchWebsite: "Switch website",
	addWebsite:    "Add a website…",
	refresh:       "Refresh",
	settings:      "Settings",
	period:        "Period",
	periods:       [3]string{"24h", "7d", "30d"},
	compared:      [3]string{"vs previous 24 hours", "vs previous 7 days", "vs previous 30 days"},
	visitors:      "Visitors",
	visitorsCount: "%s visitors",
	pageviews:     "Pageviews",
	visits:        "Visits",
	bounce:        "Bounce rate",
	topPages:      "Top pages",
	views:         "Views",
	now:           "Now",
	today:         "Today",
	online:        "%s online",
	updatedNow:    "Updated just now",
	updated:       "Updated %s",
	minutesAgo:    "%d min ago",
	hoursAgo:      "%d h ago",
	retry:         "Try again",
	noSitesTitle:  "No websites yet",
	noSitesBody:   "Add a website in the dashboard and its traffic shows up here.",
	noVisitors:    [3]string{"No visitors in the last 24 hours", "No visitors in the last 7 days", "No visitors in the last 30 days"},
	chartLabel:    "Visitors over time",
	openPage:      "Open %s",

	back:         "Back",
	account:      "Account",
	disconnect:   "Disconnect",
	menuBar:      "Menu bar",
	showInMenu:   "Next to the icon",
	trayModes:    [3]string{"Online now", "Visitors", "Nothing"},
	openAtLogin:  "Open at login",
	loginFailed:  "Couldn't change this. Move Flareboard to Applications and try again.",
	connection:   "Connection",
	save:         "Save",
	saving:       "Saving…",
	general:      "General",
	language:     "Language",
	system:       "System",
	updates:      "Updates",
	checkNow:     "Check now",
	autoUpdate:   "Check for updates automatically",
	checkUpdates: "Check for Updates…",
}

var zhTexts = texts{
	lang:           "zh",
	group:          ",",
	decimal:        ".",
	percent:        "%",
	title:          "Flareboard",
	openFlareboard: "打开 Flareboard",
	openDashboard:  "打开控制台",
	quit:           "退出 Flareboard",
	version:        "版本 %s",

	connectTitle: "连接 Flareboard",
	connectLead:  "在菜单栏随时看到网站的访客。粘贴一个个人 API 密钥，只读权限就够了。",
	apiKey:       "API 密钥",
	connect:      "连接",
	connecting:   "正在连接…",
	createKey:    "创建 API 密钥",
	selfHosted:   "自托管服务器",
	apiBase:      "API 地址",
	apiBaseHint:  "自己部署 Flareboard 时，填你自己的 API 地址。",
	consoleURL:   "控制台地址",
	consoleHint:  "留空则按 API 地址推断。",
	needKey:      "请粘贴个人 API 密钥。",
	needPersonal: "这是项目密钥（fb_pk_…），请使用以 fb_sk_ 开头的个人密钥。",
	badKey:       "这个 API 密钥无效，可能已被撤销。请在控制台重新创建一个。",
	noScope:      "这个 API 密钥没有读取统计的权限，请创建一个带只读权限的密钥。",
	offline:      "无法连接 %s，请检查网络。",
	timeout:      "%s 响应超时。",

	switchWebsite: "切换网站",
	addWebsite:    "添加网站…",
	refresh:       "刷新",
	settings:      "设置",
	period:        "时间范围",
	periods:       [3]string{"24 小时", "7 天", "30 天"},
	compared:      [3]string{"较前 24 小时", "较前 7 天", "较前 30 天"},
	visitors:      "访客",
	visitorsCount: "%s 位访客",
	pageviews:     "浏览量",
	visits:        "访问",
	bounce:        "跳出率",
	topPages:      "热门页面",
	views:         "浏览",
	now:           "现在",
	today:         "今天",
	online:        "%s 人在线",
	updatedNow:    "刚刚更新",
	updated:       "%s更新",
	minutesAgo:    "%d 分钟前",
	hoursAgo:      "%d 小时前",
	retry:         "重试",
	noSitesTitle:  "还没有网站",
	noSitesBody:   "在控制台添加网站后，这里就会显示它的流量。",
	noVisitors:    [3]string{"最近 24 小时没有访客", "最近 7 天没有访客", "最近 30 天没有访客"},
	chartLabel:    "访客趋势",
	openPage:      "打开 %s",

	back:         "返回",
	account:      "账户",
	disconnect:   "断开连接",
	menuBar:      "菜单栏",
	showInMenu:   "图标旁显示",
	trayModes:    [3]string{"在线人数", "访客", "不显示"},
	openAtLogin:  "登录时打开",
	loginFailed:  "无法更改。请把 Flareboard 移到“应用程序”后再试。",
	connection:   "连接",
	save:         "保存",
	saving:       "正在保存…",
	general:      "通用",
	language:     "语言",
	system:       "跟随系统",
	updates:      "更新",
	checkNow:     "立即检查",
	autoUpdate:   "自动检查更新",
	checkUpdates: "检查更新…",
}

// languages are the panel's languages, as the dashboard has them, with
// their own names for the settings.
var languages = []struct {
	code, name string
	texts      *texts
}{
	{"en", "English", &enTexts},
	{"zh", "简体中文", &zhTexts},
	{"ja", "日本語", &jaTexts},
	{"de", "Deutsch", &deTexts},
	{"fr", "Français", &frTexts},
}

// langFromLocale picks the panel's language for a system locale such as
// "zh-Hans-CN" or "de_DE".
func langFromLocale(locale string) string {
	locale = strings.ToLower(locale)
	for _, l := range languages {
		if locale == l.code || strings.HasPrefix(locale, l.code+"-") || strings.HasPrefix(locale, l.code+"_") {
			return l.code
		}
	}
	return "en"
}

func detectLang() string {
	loc := ""
	func() {
		defer func() { _ = recover() }()
		loc = mygo.App.Locale()
	}()
	return langFromLocale(loc)
}

func textsFor(lang string) texts {
	for _, l := range languages {
		if l.code == lang {
			return *l.texts
		}
	}
	return enTexts
}

func (a *app) txt() texts {
	return textsFor(a.lang)
}

// localize swaps the separators of a number formatted in English.
func (t texts) localize(s string) string {
	if t.group == "," && t.decimal == "." && t.percent == "%" {
		return s
	}
	var b strings.Builder
	for _, r := range s {
		switch r {
		case ',':
			b.WriteString(t.group)
		case '.':
			b.WriteString(t.decimal)
		case '%':
			b.WriteString(t.percent)
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (t texts) count(n float64) string           { return t.localize(formatCount(n)) }
func (t texts) compact(n float64) string         { return t.localize(formatCompact(n)) }
func (t texts) pct(n float64, digits int) string { return t.localize(formatPercent(n, digits)) }
func (t texts) delta(change *float64) string     { return t.localize(formatDeltaPercent(change)) }
func (t texts) visitorCount(n float64) string    { return fmt.Sprintf(t.visitorsCount, t.count(n)) }
func (t texts) onlineCount(n int) string         { return fmt.Sprintf(t.online, t.count(float64(n))) }

func (t texts) updatedAgo(d time.Duration) string {
	switch {
	case d < time.Minute:
		return t.updatedNow
	case d < time.Hour:
		return fmt.Sprintf(t.updated, fmt.Sprintf(t.minutesAgo, int(d/time.Minute)))
	default:
		return fmt.Sprintf(t.updated, fmt.Sprintf(t.hoursAgo, int(d/time.Hour)))
	}
}

var (
	deMonths = [12]string{"Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."}
	frMonths = [12]string{"janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."}
)

// bucketLabel names a chart bucket on the axis and in the tooltip, in the
// Mac's own time zone for hours.
func (t texts) bucketLabel(at time.Time, unit string, long bool) string {
	if unit == "day" {
		switch t.lang {
		case "zh", "ja":
			return fmt.Sprintf("%d月%d日", at.Month(), at.Day())
		case "de":
			return fmt.Sprintf("%d. %s", at.Day(), deMonths[at.Month()-1])
		case "fr":
			return fmt.Sprintf("%d %s", at.Day(), frMonths[at.Month()-1])
		}
		return at.Format("Jan 2")
	}
	local := at.Local()
	if !long {
		return local.Format("15:00")
	}
	end := local.Add(time.Hour)
	return local.Format("15:04") + "–" + end.Format("15:04")
}
