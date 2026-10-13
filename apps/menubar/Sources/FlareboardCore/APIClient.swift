import Foundation

/// Where the app reaches Flareboard, and with what key.
public struct Connection: Equatable, Sendable {
    public var baseURL: String
    public var apiKey: String

    public init(baseURL: String, apiKey: String) {
        self.baseURL = baseURL
        self.apiKey = apiKey
    }
}

/// Loads Flareboard data. Tests use a fake.
public protocol Fetcher: Sendable {
    func me(_ c: Connection) async throws -> Account
    func websites(_ c: Connection) async throws -> [Website]
    func overview(_ c: Connection, websiteID: String, range: StatsRange) async throws -> Overview
    /// How many visitors are on the website now (the last five minutes).
    func realtime(_ c: Connection, websiteID: String) async throws -> Int
}

public struct APIError: Error, Equatable, Sendable {
    public var status: Int
    public var message: String

    public init(status: Int, message: String) {
        self.status = status
        self.message = message
    }

    static func from(status: Int, body: Data) -> APIError {
        struct Payload: Decodable { var message: String? }
        let message = (try? JSONDecoder().decode(Payload.self, from: body))?.message?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !message.isEmpty { return APIError(status: status, message: message) }
        switch status {
        case 401: return APIError(status: status, message: "Invalid API key")
        case 403: return APIError(status: status, message: "This API key does not have the read scope")
        case 404: return APIError(status: status, message: "Website not found")
        default: return APIError(status: status, message: "HTTP \(status)")
        }
    }
}

public struct HTTPFetcher: Fetcher {
    let session: URLSession

    public init(session: URLSession = HTTPFetcher.defaultSession) {
        self.session = session
    }

    public static let defaultSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.httpAdditionalHeaders = ["User-Agent": "Flareboard-Menubar/\(appVersionString)"]
        return URLSession(configuration: config)
    }()

    public func me(_ c: Connection) async throws -> Account {
        try await get(c, "/api/me")
    }

    public func websites(_ c: Connection) async throws -> [Website] {
        try await get(c, "/api/websites")
    }

    public func overview(_ c: Connection, websiteID: String, range: StatsRange) async throws -> Overview {
        try await get(c, "/api/websites/\(Self.escape(websiteID))/stats/overview", query: [
            "startAt": String(range.startAt),
            "endAt": String(range.endAt),
            "unit": range.unit,
            "type": "path",
            "limit": "5",
        ])
    }

    public func realtime(_ c: Connection, websiteID: String) async throws -> Int {
        struct Realtime: Decodable { var visitors: Int? }
        let r: Realtime = try await get(c, "/api/realtime/\(Self.escape(websiteID))")
        return r.visitors ?? 0
    }

    private static func escape(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? s
    }

    private func get<T: Decodable>(_ c: Connection, _ path: String, query: [String: String] = [:]) async throws -> T {
        var base = c.baseURL.trimmingCharacters(in: .whitespaces)
        if base.isEmpty { base = defaultAPIBase }
        while base.hasSuffix("/") { base.removeLast() }
        guard var components = URLComponents(string: base + path) else { throw URLError(.badURL) }
        if !query.isEmpty {
            components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(c.apiKey.trimmingCharacters(in: .whitespacesAndNewlines))", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard http.statusCode < 300 else { throw APIError.from(status: http.statusCode, body: data) }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError(status: http.statusCode, message: "Unexpected response from the API")
        }
    }
}

/// What went wrong, in the panel's words.
public func describeError(_ error: Error, texts t: Texts, base: String) -> String {
    let host = hostOf(base)
    if let api = error as? APIError {
        switch api.status {
        case 401: return t.badKey
        case 403: return t.noScope
        default: return api.message
        }
    }
    if let url = error as? URLError {
        if url.code == .timedOut { return String(format: t.timeout, host) }
        return String(format: t.offline, host)
    }
    return error.localizedDescription
}
