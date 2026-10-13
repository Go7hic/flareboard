import Foundation

/// The version of the running app, from its Info.plist.
public var appVersionString: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
}

public func normalizeBaseURL(_ raw: String) -> String {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.isEmpty { return defaultAPIBase }
    while s.hasSuffix("/") { s.removeLast() }
    if !s.contains("://") { s = "https://" + s }
    return s
}

/// The console for an API: the setting when there is one, else a guess.
public func normalizeConsoleURL(_ raw: String, apiBase: String) -> String {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if !s.isEmpty {
        while s.hasSuffix("/") { s.removeLast() }
        if !s.contains("://") { s = "https://" + s }
        return s
    }
    if apiBase.contains("api.flareboard.dev") { return defaultConsoleURL }
    if apiBase.contains("localhost:8788") || apiBase.contains("127.0.0.1:8788") { return "http://localhost:5173" }
    var base = apiBase
    while base.hasSuffix("/") { base.removeLast() }
    return base
}

public func websiteURL(console: String, websiteID: String) -> URL? {
    var base = console.isEmpty ? defaultConsoleURL : console
    while base.hasSuffix("/") { base.removeLast() }
    let id = websiteID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? websiteID
    return URL(string: base + "/websites/" + id)
}

public func consolePage(console: String, path: String) -> URL? {
    var base = console.isEmpty ? defaultConsoleURL : console
    while base.hasSuffix("/") { base.removeLast() }
    return URL(string: base + path)
}

public func hostOf(_ base: String) -> String {
    URL(string: base)?.host ?? base
}

/// The start and end of a key, as fb_sk_…3f9a.
public func maskKey(_ key: String) -> String {
    let k = key.trimmingCharacters(in: .whitespacesAndNewlines)
    guard k.count > 10 else { return "fb_sk_…" }
    return String(k.prefix(6)) + "…" + String(k.suffix(4))
}
