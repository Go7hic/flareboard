import Foundation
import Observation

public enum Screen: Equatable, Sendable {
    case stats
    case settings
}

/// Where an update stands, for the settings and the panel's footer.
public enum UpdateStatus: Equatable, Sendable {
    case idle
    case checking
    case upToDate
    case available(AppRelease)
    case downloading(AppRelease, progress: Double)
    case ready(AppRelease)
    case installing
    case failed(String)

    public var release: AppRelease? {
        switch self {
        case .available(let r), .downloading(let r, _), .ready(let r): r
        default: nil
        }
    }
}

/// The panel's state and what changes it. Views read it on the main actor; fetches await off it
/// and come back with a generation number, so a stale answer never replaces a newer one.
@MainActor
@Observable
public final class AppModel {
    public static let livePoll: TimeInterval = 30
    public static let staleAfter: TimeInterval = 60
    public static let updateInterval: TimeInterval = 24 * 3600

    // Collaborators.
    @ObservationIgnored let api: Fetcher
    @ObservationIgnored let prefsStore: PrefsStore
    @ObservationIgnored let secrets: SecretStore
    @ObservationIgnored let login: LoginItem
    @ObservationIgnored public var now: () -> Date = Date.init
    @ObservationIgnored public var systemLang: Lang = .system
    @ObservationIgnored public var openURL: (URL) -> Void = { _ in }
    @ObservationIgnored public var fetchRelease: @Sendable () async throws -> AppRelease? = { try await UpdateFeed.fetchLatest() }
    @ObservationIgnored public var currentVersion: String = appVersionString
    @ObservationIgnored let installer = UpdateInstaller()

    // Settings.
    public private(set) var prefs: Prefs
    public private(set) var apiKey: String
    public var draftKey = ""
    public var draftBaseURL = ""
    public var draftConsoleURL = ""
    public var screen: Screen = .stats

    // Data.
    public private(set) var account: Account?
    public private(set) var websites: [Website] = []
    public private(set) var overview: Overview?
    public private(set) var live: Int?
    public private(set) var fetchedAt: Date?
    public private(set) var loading = false
    public private(set) var connecting = false
    public var error: String?
    public var formError: String?
    public var loginError: String?
    public var openAtLogin: Bool
    public var updateStatus: UpdateStatus = .idle
    /// True while the panel shows, so ticks refresh what it shows.
    public var panelOpen = false

    @ObservationIgnored private var gen = 0
    @ObservationIgnored private var liveGen = 0

    public init(api: Fetcher = HTTPFetcher(), prefs: PrefsStore = DefaultsPrefsStore(), secrets: SecretStore = KeychainSecretStore(), login: LoginItem = AppLoginItem()) {
        self.api = api
        self.prefsStore = prefs
        self.secrets = secrets
        self.login = login
        self.prefs = prefs.load()
        self.apiKey = secrets.readKey() ?? ""
        self.openAtLogin = login.enabled
        resetDraft()
        installer.onStateChanged = { [weak self] state in
            Task { @MainActor in self?.installerChanged(state) }
        }
    }

    // MARK: Reading

    public var lang: Lang { prefs.language ?? systemLang }
    public var texts: Texts { lang.texts }
    public var connected: Bool { !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    public var website: Website? { websites.first { $0.id == prefs.websiteID } }
    public var connection: Connection { Connection(baseURL: prefs.baseURL, apiKey: apiKey) }
    public var range: StatsRange { prefs.period.range(endingAt: fetchedAt ?? now()) }
    public var buckets: [Bucket] {
        guard let overview else { return [] }
        return fillSeries(overview.visitorSeries, range: range, timezone: website?.timezone)
    }

    /// The text next to the menu bar icon.
    public var trayTitle: String {
        guard connected, website != nil else { return "" }
        switch prefs.trayMode {
        case .online: return live.map { texts.compact(Double($0)) } ?? ""
        case .visitors: return overview.map { texts.compact($0.stats.visitors.value) } ?? ""
        case .none: return ""
        }
    }

    public var trayTooltip: String {
        guard connected, let site = website else { return texts.title }
        if let live { return texts.onlineCount(live) + " · " + site.displayName }
        return site.displayName
    }

    public var dashboardURL: URL? {
        if let id = prefs.websiteID { return websiteURL(console: prefs.consoleURL, websiteID: id) }
        return consolePage(console: prefs.consoleURL, path: "/websites")
    }

    public var apiKeysURL: URL? {
        let base = normalizeBaseURL(draftBaseURL)
        return consolePage(console: normalizeConsoleURL(draftConsoleURL, apiBase: base), path: "/api-keys")
    }

    // MARK: Settings

    private func save() { prefsStore.save(prefs) }

    private func resetDraft() {
        draftKey = ""
        draftBaseURL = prefs.baseURL
        draftConsoleURL = prefs.consoleURL == normalizeConsoleURL("", apiBase: prefs.baseURL) ? "" : prefs.consoleURL
    }

    public func openSettings() {
        resetDraft()
        formError = nil
        screen = .settings
    }

    public func closeSettings() {
        guard connected else { return }
        formError = nil
        screen = .stats
    }

    public func setPeriod(_ period: Period) {
        guard prefs.period != period else { return }
        prefs.period = period
        save()
        refresh()
    }

    public func pickWebsite(_ id: String) {
        guard prefs.websiteID != id, websites.contains(where: { $0.id == id }) else { return }
        prefs.websiteID = id
        overview = nil
        live = nil
        save()
        refresh()
    }

    public func setTrayMode(_ mode: TrayMode) {
        prefs.trayMode = mode
        save()
    }

    public func setLanguage(_ lang: Lang?) {
        prefs.language = lang
        save()
    }

    public func setOpenAtLogin(_ on: Bool) {
        loginError = nil
        do {
            try login.setEnabled(on)
            openAtLogin = on
        } catch {
            openAtLogin = login.enabled
            loginError = texts.loginFailed
        }
    }

    public func setAutoUpdate(_ on: Bool) {
        prefs.autoUpdate = on
        save()
    }

    // MARK: Connecting

    /// Checks the key (and server) in the draft against the API, and keeps them only once the
    /// API accepts them. A key left empty in the settings keeps the current one.
    public func connect() {
        guard !connecting else { return }
        let t = texts
        var key = draftKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if key.isEmpty, connected, screen == .settings { key = apiKey }
        if key.isEmpty { formError = t.needKey; return }
        if key.hasPrefix("fb_pk_") { formError = t.needPersonal; return }
        let base = normalizeBaseURL(draftBaseURL)
        let console = normalizeConsoleURL(draftConsoleURL, apiBase: base)
        let c = Connection(baseURL: base, apiKey: key)
        formError = nil
        connecting = true
        Task {
            do {
                let account = try await api.me(c)
                let sites = try await api.websites(c)
                connecting = false
                if base != prefs.baseURL || !sites.contains(where: { $0.id == prefs.websiteID }) {
                    prefs.websiteID = nil
                }
                prefs.baseURL = base
                prefs.consoleURL = console
                save()
                apiKey = key
                secrets.writeKey(key)
                self.account = account
                websites = sites
                overview = nil
                live = nil
                draftKey = ""
                screen = .stats
                refresh()
            } catch {
                connecting = false
                formError = describeError(error, texts: texts, base: base)
            }
        }
    }

    /// Forgets the key and everything loaded with it.
    public func disconnect() {
        gen += 1
        liveGen += 1
        apiKey = ""
        secrets.writeKey(nil)
        prefs.websiteID = nil
        save()
        account = nil
        websites = []
        overview = nil
        live = nil
        fetchedAt = nil
        loading = false
        error = nil
        resetDraft()
        screen = .stats
    }

    // MARK: Loading

    public func refresh(reloadSites: Bool = false) {
        guard connected else { return }
        gen += 1
        let gen = gen
        loading = true
        error = nil
        let c = connection
        let period = prefs.period
        let wanted = prefs.websiteID
        let wantSites = reloadSites || websites.isEmpty
        let known = websites
        let end = now()
        Task {
            do {
                var account = self.account
                var sites = known
                if wantSites {
                    account = try await api.me(c)
                    sites = try await api.websites(c)
                }
                var overview: Overview?
                var live: Int?
                var id = wanted
                if let first = sites.first {
                    if !sites.contains(where: { $0.id == id }) { id = first.id }
                    overview = try await api.overview(c, websiteID: id!, range: period.range(endingAt: end))
                    live = try? await api.realtime(c, websiteID: id!)
                }
                guard gen == self.gen else { return }
                loading = false
                self.account = account
                websites = sites
                if prefs.websiteID != id {
                    prefs.websiteID = id
                    save()
                }
                self.overview = overview
                self.live = live
                fetchedAt = end
            } catch {
                guard gen == self.gen else { return }
                loading = false
                if let api = error as? APIError, api.status == 401 {
                    // The key was revoked: ask for a new one.
                    disconnect()
                    formError = texts.badKey
                    return
                }
                self.error = describeError(error, texts: texts, base: c.baseURL)
            }
        }
    }

    /// Updates the online count alone, for the icon's title.
    public func refreshLive() {
        guard connected, let id = prefs.websiteID, !loading else { return }
        liveGen += 1
        let gen = liveGen
        let c = connection
        Task {
            guard let n = try? await api.realtime(c, websiteID: id), gen == liveGen, prefs.websiteID == id else { return }
            live = n
        }
    }

    /// Runs every livePoll: keeps the online count current, and the stats while the panel shows.
    public func tick() {
        guard connected else { return }
        if panelOpen, screen == .stats, now().timeIntervalSince(fetchedAt ?? .distantPast) > Self.staleAfter {
            refresh()
        } else {
            refreshLive()
        }
        if prefs.autoUpdate, now().timeIntervalSince(prefs.lastUpdateCheck ?? .distantPast) > Self.updateInterval {
            checkForUpdates(userInitiated: false)
        }
    }

    public func panelOpened() {
        panelOpen = true
        if connected { screen = screen == .settings ? .settings : .stats }
        if connected, overview == nil || now().timeIntervalSince(fetchedAt ?? .distantPast) > Self.staleAfter {
            refresh(reloadSites: websites.isEmpty)
        }
    }

    // MARK: Updates

    public func checkForUpdates(userInitiated: Bool) {
        switch updateStatus {
        case .checking, .downloading, .installing, .ready: return
        default: break
        }
        if userInitiated { updateStatus = .checking }
        prefs.lastUpdateCheck = now()
        save()
        let fetch = fetchRelease
        let current = currentVersion
        Task {
            do {
                if let release = try await fetch(), compareVersions(release.version, current) > 0 {
                    updateStatus = .available(release)
                } else if userInitiated || updateStatus == .checking {
                    updateStatus = .upToDate
                }
            } catch {
                if userInitiated { updateStatus = .failed(String(format: texts.updateFailed, error.localizedDescription)) }
            }
        }
    }

    public func installUpdate() {
        guard case .available(let release) = updateStatus else {
            if case .ready = updateStatus { installer.installAndRelaunch() }
            return
        }
        do {
            try UpdateInstaller.checkReplaceable()
        } catch let e as UpdateInstallerError {
            updateStatus = .failed(e.message(texts))
            return
        } catch {
            return
        }
        updateStatus = .downloading(release, progress: 0)
        installer.download(from: release.downloadURL, expectedSHA256: release.sha256)
    }

    private func installerChanged(_ state: UpdateInstallerState) {
        let release = updateStatus.release
        switch state {
        case .idle: break
        case .downloading(let p): if let release { updateStatus = .downloading(release, progress: p) }
        case .readyToInstall:
            if let release { updateStatus = .ready(release) }
            installer.installAndRelaunch()
        case .installing: updateStatus = .installing
        case .failed(let e): updateStatus = .failed(e.message(texts))
        }
    }
}
