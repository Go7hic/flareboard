import Foundation
import Testing
@testable import FlareboardCore

final class MemoryPrefs: PrefsStore, @unchecked Sendable {
    private var prefs = Prefs()
    func load() -> Prefs { prefs }
    func save(_ prefs: Prefs) { self.prefs = prefs }
}

final class MemorySecrets: SecretStore, @unchecked Sendable {
    private var key: String?
    init(_ key: String? = nil) { self.key = key }
    func readKey() -> String? { key }
    func writeKey(_ key: String?) { self.key = key }
}

final class FakeLogin: LoginItem, @unchecked Sendable {
    var on = false
    var enabled: Bool { on }
    func setEnabled(_ on: Bool) throws { self.on = on }
}

final class FakeAPI: Fetcher, @unchecked Sendable {
    var account = Account(username: "ada")
    var meError: Error?
    var sites: [Website] = []
    var overview = Overview()
    var live = 0
    var lastRange: StatsRange?

    func me(_ c: Connection) async throws -> Account {
        if let meError { throw meError }
        return account
    }
    func websites(_ c: Connection) async throws -> [Website] { sites }
    func overview(_ c: Connection, websiteID: String, range: StatsRange) async throws -> Overview {
        lastRange = range
        return overview
    }
    func realtime(_ c: Connection, websiteID: String) async throws -> Int { live }
}

func sampleOverview() -> Overview {
    var visitors: [Point] = []
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = "yyyy-MM-dd HH:00"
    for (i, v) in [140.0, 120, 160, 140, 210, 260, 230, 300, 280, 340, 310, 390, 420, 380, 460, 510, 470, 530, 560, 520, 610, 640, 600, 680, 520].enumerated() where i != 7 {
        visitors.append(Point(x: f.string(from: testNow.addingTimeInterval(TimeInterval(i - 24) * 3600)), y: v))
    }
    return Overview(
        stats: OverviewStats(pageviews: Stat(value: 12480, change: 12.4), visitors: Stat(value: 3260, change: 12.4), visits: Stat(value: 4110, change: -8.1), bounces: Stat(value: 1640, change: 0)),
        metrics: [Point(x: "/", y: 4210), Point(x: "/pricing", y: 1830), Point(x: "/docs/quickstart", y: 1210), Point(x: "/blog/flareboard-is-live", y: 860), Point(x: "/demo", y: 640)],
        timeseries: Timeseries(pageviews: [], visitors: visitors)
    )
}

@MainActor
func makeModel(_ api: FakeAPI, key: String? = nil) -> AppModel {
    let m = AppModel(api: api, prefs: MemoryPrefs(), secrets: MemorySecrets(key), login: FakeLogin())
    m.now = { testNow }
    m.systemLang = .en
    return m
}

/// Lets the model's tasks run.
@MainActor
func settle() async {
    for _ in 0..<20 { await Task.yield() }
}

@MainActor
@Suite struct ModelTests {
    @Test func connectAsksForAPersonalKey() {
        let m = makeModel(FakeAPI())
        m.connect()
        #expect(m.formError == Texts.en.needKey)
        m.draftKey = "fb_pk_public"
        m.connect()
        #expect(m.formError == Texts.en.needPersonal)
        #expect(!m.connected)
    }

    @Test func connectKeepsOnlyAWorkingKey() async {
        let api = FakeAPI()
        api.meError = APIError(status: 401, message: "Invalid API key")
        let m = makeModel(api)
        m.draftKey = "fb_sk_revoked"
        m.connect()
        await settle()
        #expect(!m.connected)
        #expect(m.formError == Texts.en.badKey)

        api.meError = nil
        api.sites = [Website(id: "w1", name: "Docs", domain: "docs.dev")]
        api.overview = sampleOverview()
        api.live = 8
        m.draftKey = "fb_sk_good_key_1234"
        m.connect()
        await settle()
        #expect(m.connected)
        #expect(m.prefs.websiteID == "w1")
        #expect(m.overview?.stats.visitors.value == 3260)
        #expect(m.live == 8)
        #expect(m.trayTitle == "8")
        #expect(m.trayTooltip == "8 online · Docs")
    }

    @Test func periodReloadsTheStats() async {
        let api = FakeAPI()
        api.sites = [Website(id: "w1", name: "Docs")]
        api.overview = sampleOverview()
        let m = makeModel(api, key: "fb_sk_test_1234")
        m.refresh()
        await settle()
        m.setPeriod(.week)
        await settle()
        #expect(api.lastRange?.unit == "day")
        #expect(m.prefs.period == .week)
        #expect(m.buckets.count == 8)
    }

    @Test func revokedKeyAsksForANewOne() async {
        let api = FakeAPI()
        api.meError = APIError(status: 401, message: "")
        let m = makeModel(api, key: "fb_sk_test_1234")
        m.refresh(reloadSites: true)
        await settle()
        #expect(!m.connected)
        #expect(m.formError == Texts.en.badKey)
    }

    @Test func trayModes() async {
        let api = FakeAPI()
        api.sites = [Website(id: "w1", name: "Docs")]
        api.overview = sampleOverview()
        api.live = 1240
        let m = makeModel(api, key: "fb_sk_test_1234")
        m.refresh()
        await settle()
        #expect(m.trayTitle == "1.2k")
        m.setTrayMode(.visitors)
        #expect(m.trayTitle == "3.2k")
        m.setTrayMode(.none)
        #expect(m.trayTitle == "")
        m.setLanguage(.de)
        m.setTrayMode(.online)
        #expect(m.trayTitle == "1,2k")
    }

    @Test func disconnectForgetsEverything() async {
        let api = FakeAPI()
        api.sites = [Website(id: "w1", name: "Docs")]
        api.overview = sampleOverview()
        let m = makeModel(api, key: "fb_sk_test_1234")
        m.refresh()
        await settle()
        m.disconnect()
        #expect(!m.connected)
        #expect(m.overview == nil)
        #expect(m.websites.isEmpty)
        #expect(m.trayTitle == "")
    }

    @Test func updateCheckFindsANewerVersion() async {
        let m = makeModel(FakeAPI())
        m.currentVersion = "0.2.0"
        let release = AppRelease(version: "0.3.0", notes: "", pageURL: URL(string: "https://github.com/x")!, downloadURL: URL(string: "https://github.com/x.dmg")!, sha256: nil)
        m.fetchRelease = { release }
        m.checkForUpdates(userInitiated: true)
        await settle()
        #expect(m.updateStatus == .available(release))

        m.currentVersion = "0.3.0"
        m.updateStatus = .idle
        m.checkForUpdates(userInitiated: true)
        await settle()
        #expect(m.updateStatus == .upToDate)
    }
}
