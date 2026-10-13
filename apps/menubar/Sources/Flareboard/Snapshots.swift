#if DEBUG
import AppKit
import FlareboardCore
import SwiftUI

// `swift run Flareboard --snapshots DIR` renders every screen, in every language, light and dark,
// with sample data, to PNG files for design review. Debug builds only.

private final class SampleFetcher: Fetcher, @unchecked Sendable {
    enum Mode { case data, noSites, offline, loading, emptyPeriod }
    let mode: Mode
    init(_ mode: Mode) { self.mode = mode }

    func me(_ c: Connection) async throws -> Account {
        if mode == .loading { try await Task.sleep(for: .seconds(3600)) }
        return Account(username: "go7hic", displayName: "Go7hic")
    }

    func websites(_ c: Connection) async throws -> [Website] {
        mode == .noSites ? [] : [Website(id: "w1", name: "Flareboard", domain: "flareboard.dev", timezone: "UTC"), Website(id: "w2", name: "Blog", domain: "blog.example")]
    }

    func overview(_ c: Connection, websiteID: String, range: StatsRange) async throws -> Overview {
        if mode == .offline { throw URLError(.notConnectedToInternet) }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd HH:00"
        let end = Date(timeIntervalSince1970: TimeInterval(range.endAt) / 1000)
        var visitors: [Point] = []
        if mode != .emptyPeriod {
            for (i, v) in [140.0, 120, 160, 140, 210, 260, 230, 300, 280, 340, 310, 390, 420, 380, 460, 510, 470, 530, 560, 520, 610, 640, 600, 680, 520].enumerated() where i != 7 {
                visitors.append(Point(x: f.string(from: end.addingTimeInterval(TimeInterval(i - 24) * 3600)), y: v))
            }
        }
        return Overview(
            stats: OverviewStats(pageviews: Stat(value: 12480, change: 12.4), visitors: Stat(value: mode == .emptyPeriod ? 0 : 3260, change: mode == .emptyPeriod ? nil : 12.4), visits: Stat(value: 4110, change: -8.1), bounces: Stat(value: 1640, change: 0)),
            metrics: mode == .emptyPeriod ? [] : [Point(x: "/", y: 4210), Point(x: "/pricing", y: 1830), Point(x: "/docs/quickstart", y: 1210), Point(x: "/blog/flareboard-is-live", y: 860), Point(x: "/demo", y: 640)],
            timeseries: Timeseries(pageviews: [], visitors: visitors)
        )
    }

    func realtime(_ c: Connection, websiteID: String) async throws -> Int { 8 }
}

private final class MemoryPrefs: PrefsStore, @unchecked Sendable {
    var prefs = Prefs()
    func load() -> Prefs { prefs }
    func save(_ prefs: Prefs) { self.prefs = prefs }
}

private final class MemorySecrets: SecretStore, @unchecked Sendable {
    var key: String?
    init(_ key: String?) { self.key = key }
    func readKey() -> String? { key }
    func writeKey(_ key: String?) { self.key = key }
}

private struct NoLogin: LoginItem {
    var enabled: Bool { false }
    func setEnabled(_ on: Bool) throws {}
}

@MainActor
enum Snapshots {
    static func run(into dir: URL) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let states: [(String, SampleFetcher.Mode, String?, (AppModel) -> Void)] = [
            ("connect", .data, nil, { _ in }),
            ("connect-error", .data, nil, { $0.draftKey = "fb_sk_revoked"; $0.formError = $0.texts.badKey }),
            ("stats", .data, "fb_sk_test_1234", { $0.refresh(reloadSites: true) }),
            ("loading", .loading, "fb_sk_test_1234", { $0.refresh(reloadSites: true) }),
            ("error", .offline, "fb_sk_test_1234", { $0.refresh(reloadSites: true) }),
            ("no-sites", .noSites, "fb_sk_test_1234", { $0.refresh(reloadSites: true) }),
            ("empty-period", .emptyPeriod, "fb_sk_test_1234", { $0.refresh(reloadSites: true) }),
            ("settings", .data, "fb_sk_test_1234", { $0.refresh(reloadSites: true); $0.openSettings() }),
        ]
        for lang in Lang.allCases {
            for dark in [false, true] {
                for (name, mode, key, setup) in states {
                    let model = AppModel(api: SampleFetcher(mode), prefs: MemoryPrefs(), secrets: MemorySecrets(key), login: NoLogin())
                    model.setLanguage(lang)
                    setup(model)
                    RunLoop.main.run(until: Date().addingTimeInterval(0.3))
                    let view = PanelView(model: model).background(Color(nsColor: .windowBackgroundColor))
                    let file = dir.appendingPathComponent("\(lang.rawValue)-\(dark ? "dark" : "light")-\(name).png")
                    render(view, dark: dark, to: file)
                }
            }
        }
    }

    private static func render(_ view: some View, dark: Bool, to file: URL) {
        let host = NSHostingView(rootView: view)
        host.frame = CGRect(origin: .zero, size: PanelView.size)
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.setFrameOrigin(NSPoint(x: -10_000, y: -10_000))
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.4))
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return }
        host.cacheDisplay(in: host.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: file)
        window.orderOut(nil)
    }
}
#endif
