import Foundation
import Testing
@testable import FlareboardCore

let testNow = Date(timeIntervalSince1970: 1_791_817_200) // 2026-10-12 15:00 UTC

@Suite struct SeriesTests {
    @Test func hoursKeepEmptyHours() {
        let r = Period.day.range(endingAt: testNow)
        let got = fillSeries([Point(x: "2026-10-12 14:00", y: 5), Point(x: "2026-10-11 15:00", y: 2)], range: r, timezone: "Asia/Shanghai")
        #expect(got.count == 25)
        #expect(got[0].value == 2)
        #expect(got[23].value == 5)
        #expect(got[10].value == 0)
        #expect(got[24].at == testNow)
    }

    @Test func daysUseTheWebsiteTimeZone() {
        // 15:00 UTC is 23:00 in Shanghai.
        let r = Period.week.range(endingAt: testNow)
        let got = fillSeries([Point(x: "2026-10-12", y: 9), Point(x: "2026-10-05", y: 1)], range: r, timezone: "Asia/Shanghai")
        #expect(got.count == 8)
        #expect(got.first?.value == 1)
        #expect(got.last?.value == 9)
    }
}

@Suite struct FormatTests {
    @Test func numbersFollowTheLanguage() {
        #expect(Texts.en.count(12480) == "12,480")
        #expect(Texts.de.count(12480) == "12.480")
        #expect(Texts.fr.count(12480) == "12\u{202f}480")
        #expect(Texts.ja.count(12480) == "12,480")
        #expect(Texts.en.compact(1240) == "1.2k")
        #expect(Texts.de.compact(1240) == "1,2k")
        #expect(Texts.en.compact(2_400_000) == "2.4M")
        #expect(Texts.en.compact(42) == "42")
        #expect(Texts.en.percent(40) == "40%")
        #expect(Texts.de.percent(40) == "40\u{00a0}%")
        #expect(Texts.en.delta(-8.1) == "8%")
        #expect(Texts.en.delta(nil) == nil)
    }

    @Test func tones() {
        #expect(Tone(change: 12) == .good)
        #expect(Tone(change: -8) == .bad)
        #expect(Tone(change: 12, lowerIsBetter: true) == .bad)
        #expect(Tone(change: 0.2) == .flat)
        #expect(Tone(change: nil) == .flat)
    }

    @Test func bounceRate() {
        let s = OverviewStats(visits: Stat(value: 100, change: 0), bounces: Stat(value: 50, change: 10))
        #expect(s.bounceRate == 50)
        let change = s.bounceRateChange ?? 0
        #expect(change > 9 && change < 11)
    }

    @Test func dayLabels() {
        let utc = TimeZone(identifier: "UTC")!
        let d = Date(timeIntervalSince1970: 1_791_244_800) // 2026-10-06 00:00 UTC
        #expect(Texts.en.bucketLabel(d, unit: "day", long: false, timeZone: utc) == "Oct 6")
        #expect(Texts.zh.bucketLabel(d, unit: "day", long: false, timeZone: utc) == "10月6日")
        #expect(Texts.en.bucketLabel(testNow, unit: "hour", long: true, timeZone: utc) == "15:00–16:00")
    }
}

@Suite struct TextsTests {
    @Test(arguments: Lang.allCases) func everyTextIsThere(lang: Lang) {
        for child in Mirror(reflecting: lang.texts).children {
            if let s = child.value as? String {
                #expect(!s.isEmpty, "\(lang) \(child.label ?? "")")
            } else if let list = child.value as? [String] {
                #expect(list.count == 3 && list.allSatisfy { !$0.isEmpty }, "\(lang) \(child.label ?? "")")
            }
        }
    }

    @Test(arguments: Lang.allCases) func formatsTakeTheirArguments(lang: Lang) {
        let t = lang.texts
        for format in [t.version, t.offline, t.timeout, t.visitorsCount, t.online, t.updated, t.openPage, t.updateAvailable, t.updateFailed] {
            #expect(format.contains("%@"), "\(lang) \(format)")
        }
        for format in [t.minutesAgo, t.hoursAgo, t.downloading] {
            #expect(format.contains("%d"), "\(lang) \(format)")
        }
    }

    @Test func languageFromLocale() {
        #expect(Lang.from(localeIdentifier: "zh-Hans-CN") == .zh)
        #expect(Lang.from(localeIdentifier: "ja_JP") == .ja)
        #expect(Lang.from(localeIdentifier: "de-AT") == .de)
        #expect(Lang.from(localeIdentifier: "fr") == .fr)
        #expect(Lang.from(localeIdentifier: "es-ES") == .en)
    }
}

@Suite struct URLTests {
    @Test func helpers() {
        #expect(normalizeBaseURL("api.example.com/") == "https://api.example.com")
        #expect(normalizeConsoleURL("", apiBase: defaultAPIBase) == defaultConsoleURL)
        #expect(normalizeConsoleURL("", apiBase: "http://localhost:8788") == "http://localhost:5173")
        #expect(maskKey("fb_sk_test_1234") == "fb_sk_…1234")
        #expect(Website(id: "w1", domain: "docs.dev").pageURL("/pricing")?.absoluteString == "https://docs.dev/pricing")
        #expect(Website(id: "w1", domain: "docs.dev").pageURL("(none)") == nil)
        #expect(Website(id: "w1", domain: "docs.dev").displayName == "docs.dev")
    }

    @Test func errors() {
        #expect(describeError(APIError(status: 401, message: "x"), texts: .en, base: defaultAPIBase) == Texts.en.badKey)
        #expect(describeError(URLError(.notConnectedToInternet), texts: .en, base: defaultAPIBase) == "Can't reach api.flareboard.dev. Check your connection.")
    }
}

@Suite struct UpdateFeedTests {
    @Test func picksTheNewestAppRelease() throws {
        let json = """
        [
          {"tag_name": "menubar-v0.4.0", "draft": true, "prerelease": false, "html_url": "https://github.com/x/y/releases/a", "assets": [{"name": "Flareboard.dmg", "browser_download_url": "https://github.com/a.dmg"}]},
          {"tag_name": "v1.2.0", "draft": false, "prerelease": false, "html_url": "https://github.com/x/y/releases/b", "assets": [{"name": "Other.dmg", "browser_download_url": "https://github.com/b.dmg"}]},
          {"tag_name": "menubar-v0.10.0", "draft": false, "prerelease": false, "body": "Notes", "html_url": "https://github.com/x/y/releases/c", "assets": [{"name": "Flareboard 0.10.0.dmg", "browser_download_url": "https://github.com/c.dmg", "digest": "sha256:ABCD"}]},
          {"tag_name": "menubar-v0.9.0", "draft": false, "prerelease": false, "html_url": "https://github.com/x/y/releases/d", "assets": [{"name": "Flareboard 0.9.0.dmg", "browser_download_url": "https://github.com/d.dmg"}]}
        ]
        """
        let r = try #require(try UpdateFeed.latest(fromJSON: Data(json.utf8)))
        #expect(r.version == "0.10.0")
        #expect(r.sha256 == "abcd")
        #expect(r.notes == "Notes")
        #expect(r.downloadURL.absoluteString == "https://github.com/c.dmg")
    }

    @Test func versions() {
        #expect(compareVersions("0.10.0", "0.9.9") == 1)
        #expect(compareVersions("0.2.0", "0.2") == 0)
        #expect(compareVersions("0.2.0", "1.0.0") == -1)
    }
}

@Suite struct MigrationTests {
    @Test func movesTheKeyToTheKeychainAndOutOfTheFile() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("settings.json")
        try Data(#"{"apiKey":"fb_sk_old_key_1234","baseURL":"https://api.example.com","websiteID":"w9","period":"7d","trayMode":"visitors"}"#.utf8).write(to: file)
        let prefs = MemoryPrefs()
        let secrets = MemorySecrets()
        migrateLegacySettings(prefs: prefs, secrets: secrets, file: file)
        #expect(secrets.readKey() == "fb_sk_old_key_1234")
        #expect(prefs.load().websiteID == "w9")
        #expect(prefs.load().period == .week)
        #expect(prefs.load().trayMode == .visitors)
        #expect(prefs.load().baseURL == "https://api.example.com")
        let left = try String(contentsOf: file, encoding: .utf8)
        #expect(!left.contains("fb_sk_old"))
    }
}
