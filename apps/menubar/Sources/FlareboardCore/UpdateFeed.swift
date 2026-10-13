import Foundation

/// A release of the menu bar app on GitHub: the newest one tagged menubar-v<version> that is
/// neither a draft nor a prerelease. The repository's latest release is the product's, so the
/// app asks the releases API (60 requests an hour per address; it checks once a day).
public struct AppRelease: Equatable, Sendable {
    public var version: String
    public var notes: String
    public var pageURL: URL
    public var downloadURL: URL
    /// Hex SHA-256 of the disk image, which GitHub computes for every asset.
    public var sha256: String?

    public init(version: String, notes: String, pageURL: URL, downloadURL: URL, sha256: String?) {
        self.version = version
        self.notes = notes
        self.pageURL = pageURL
        self.downloadURL = downloadURL
        self.sha256 = sha256
    }
}

public enum UpdateFeed {
    public static let repository = "Go7hic/flareboard"
    public static let tagPrefix = "menubar-v"

    public static var releasesURL: URL {
        URL(string: "https://api.github.com/repos/\(repository)/releases?per_page=30")!
    }

    struct GitHubRelease: Decodable {
        var tag_name: String
        var draft: Bool
        var prerelease: Bool
        var body: String?
        var html_url: URL
        var assets: [Asset]

        struct Asset: Decodable {
            var name: String
            var browser_download_url: URL
            var digest: String?
        }
    }

    /// The newest release of the app in a page of the releases API, if any.
    public static func latest(fromJSON data: Data) throws -> AppRelease? {
        let releases = try JSONDecoder().decode([GitHubRelease].self, from: data)
        var best: AppRelease?
        for r in releases where !r.draft && !r.prerelease && r.tag_name.hasPrefix(tagPrefix) {
            let version = String(r.tag_name.dropFirst(tagPrefix.count))
            guard let dmg = r.assets.first(where: { $0.name.lowercased().hasSuffix(".dmg") }) else { continue }
            if let b = best, compareVersions(version, b.version) <= 0 { continue }
            var sha: String?
            if let digest = dmg.digest, digest.hasPrefix("sha256:") { sha = String(digest.dropFirst(7)).lowercased() }
            best = AppRelease(version: version, notes: r.body ?? "", pageURL: r.html_url, downloadURL: dmg.browser_download_url, sha256: sha)
        }
        return best
    }

    public static func fetchLatest(session: URLSession = .shared) async throws -> AppRelease? {
        var request = URLRequest(url: releasesURL)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("Flareboard-Menubar/\(appVersionString)", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try latest(fromJSON: data)
    }
}

/// Compares dotted versions part by part: 1 when a is newer, -1 when older, 0 when equal.
public func compareVersions(_ a: String, _ b: String) -> Int {
    func parts(_ s: String) -> [Int] {
        s.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
    }
    let l = parts(a), r = parts(b)
    for i in 0..<max(l.count, r.count) {
        let x = i < l.count ? l[i] : 0, y = i < r.count ? r[i] : 0
        if x != y { return x > y ? 1 : -1 }
    }
    return 0
}
