import Foundation
import Security
import ServiceManagement

/// What the app keeps between launches, beside the key.
public struct Prefs: Codable, Equatable, Sendable {
    public var baseURL = defaultAPIBase
    public var consoleURL = defaultConsoleURL
    public var websiteID: String?
    public var period: Period = .day
    public var trayMode: TrayMode = .online
    /// Nil follows the system.
    public var language: Lang?
    public var autoUpdate = true
    public var lastUpdateCheck: Date?

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        baseURL = try c.decodeIfPresent(String.self, forKey: .baseURL) ?? defaultAPIBase
        consoleURL = try c.decodeIfPresent(String.self, forKey: .consoleURL) ?? defaultConsoleURL
        websiteID = try c.decodeIfPresent(String.self, forKey: .websiteID)
        period = (try? c.decodeIfPresent(Period.self, forKey: .period)) ?? .day
        trayMode = (try? c.decodeIfPresent(TrayMode.self, forKey: .trayMode)) ?? .online
        language = try? c.decodeIfPresent(Lang.self, forKey: .language)
        autoUpdate = try c.decodeIfPresent(Bool.self, forKey: .autoUpdate) ?? true
        lastUpdateCheck = try c.decodeIfPresent(Date.self, forKey: .lastUpdateCheck)
    }
}

public protocol PrefsStore: Sendable {
    func load() -> Prefs
    func save(_ prefs: Prefs)
}

public protocol SecretStore: Sendable {
    func readKey() -> String?
    /// Nil deletes the key.
    func writeKey(_ key: String?)
}

public protocol LoginItem: Sendable {
    var enabled: Bool { get }
    func setEnabled(_ on: Bool) throws
}

public struct DefaultsPrefsStore: PrefsStore {
    let key = "prefs"
    public init() {}

    public func load() -> Prefs {
        guard let data = UserDefaults.standard.data(forKey: key),
              let prefs = try? JSONDecoder().decode(Prefs.self, from: data)
        else { return Prefs() }
        return prefs
    }

    public func save(_ prefs: Prefs) {
        if let data = try? JSONEncoder().encode(prefs) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}

/// The API key, in the login keychain.
public struct KeychainSecretStore: SecretStore {
    let service = "dev.flareboard.menubar"
    let account = "api-key"
    public init() {}

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    public func readKey() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func writeKey(_ key: String?) {
        SecItemDelete(query as CFDictionary)
        guard let key, !key.isEmpty else { return }
        var q = query
        q[kSecValueData as String] = Data(key.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }
}

public struct AppLoginItem: LoginItem {
    public init() {}
    public var enabled: Bool { SMAppService.mainApp.status == .enabled }
    public func setEnabled(_ on: Bool) throws {
        if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
    }
}

/// Moves the settings of the first, MyGo, version (Application Support/Flareboard/settings.json,
/// with the key in plain text) to the preferences and the keychain, and removes the key from
/// that file.
public func migrateLegacySettings(prefs: PrefsStore, secrets: SecretStore, file: URL? = nil) {
    let url = file ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
        .appendingPathComponent("Flareboard/settings.json")
    guard let url, let data = try? Data(contentsOf: url),
          var json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return }
    if secrets.readKey() == nil, let key = json["apiKey"] as? String, !key.isEmpty {
        var p = prefs.load()
        if let v = json["baseURL"] as? String, !v.isEmpty { p.baseURL = v }
        if let v = json["consoleURL"] as? String, !v.isEmpty { p.consoleURL = v }
        if let v = json["websiteID"] as? String, !v.isEmpty { p.websiteID = v }
        if let v = json["period"] as? String, let period = Period(rawValue: v) { p.period = period }
        if let v = json["trayMode"] as? String, let mode = TrayMode(rawValue: v) { p.trayMode = mode }
        if let v = json["language"] as? String, let lang = Lang(rawValue: v) { p.language = lang }
        prefs.save(p)
        secrets.writeKey(key)
    }
    guard json["apiKey"] != nil else { return }
    json.removeValue(forKey: "apiKey")
    if let cleaned = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys]) {
        try? cleaned.write(to: url, options: .atomic)
    }
}
