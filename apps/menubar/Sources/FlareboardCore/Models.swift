import Foundation

public let defaultAPIBase = "https://api.flareboard.dev"
public let defaultConsoleURL = "https://flareboard.dev"

/// GET /api/me.
public struct Account: Codable, Equatable, Sendable {
    public var id: String?
    public var username: String?
    public var displayName: String?

    public init(id: String? = nil, username: String? = nil, displayName: String? = nil) {
        self.id = id
        self.username = username
        self.displayName = displayName
    }

    /// The name the settings show: the display name, else the username.
    public var name: String? {
        for value in [displayName, username] {
            if let value, !value.trimmingCharacters(in: .whitespaces).isEmpty { return value }
        }
        return nil
    }
}

/// One row of GET /api/websites.
public struct Website: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var name: String?
    public var domain: String?
    public var timezone: String?

    public init(id: String, name: String? = nil, domain: String? = nil, timezone: String? = nil) {
        self.id = id
        self.name = name
        self.domain = domain
        self.timezone = timezone
    }

    /// How the panel names a website: its name, or its domain.
    public var displayName: String {
        if let name = name?.trimmingCharacters(in: .whitespaces), !name.isEmpty { return name }
        if let domain = domain?.trimmingCharacters(in: .whitespaces), !domain.isEmpty { return domain }
        return id
    }

    /// A top page on the website itself, or nil when the path is not a path.
    public func pageURL(_ path: String) -> URL? {
        guard var domain = domain?.trimmingCharacters(in: .whitespaces), !domain.isEmpty, path.hasPrefix("/") else {
            return nil
        }
        if !domain.contains("://") { domain = "https://" + domain }
        while domain.hasSuffix("/") { domain.removeLast() }
        return URL(string: domain + path)
    }
}

/// A KPI and its percent change against the previous window of the same length.
public struct Stat: Codable, Equatable, Sendable {
    public var value: Double
    public var change: Double?

    public init(value: Double = 0, change: Double? = nil) {
        self.value = value
        self.change = change
    }
}

/// One bucket of a time series, or one row of a breakdown.
public struct Point: Codable, Equatable, Sendable {
    public var x: String
    public var y: Double

    public init(x: String, y: Double) {
        self.x = x
        self.y = y
    }
}

public struct OverviewStats: Codable, Equatable, Sendable {
    public var pageviews = Stat()
    public var visitors = Stat()
    public var visits = Stat()
    public var bounces = Stat()

    public init(pageviews: Stat = Stat(), visitors: Stat = Stat(), visits: Stat = Stat(), bounces: Stat = Stat()) {
        self.pageviews = pageviews
        self.visitors = visitors
        self.visits = visits
        self.bounces = bounces
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pageviews = try c.decodeIfPresent(Stat.self, forKey: .pageviews) ?? Stat()
        visitors = try c.decodeIfPresent(Stat.self, forKey: .visitors) ?? Stat()
        visits = try c.decodeIfPresent(Stat.self, forKey: .visits) ?? Stat()
        bounces = try c.decodeIfPresent(Stat.self, forKey: .bounces) ?? Stat()
    }

    /// Bounces as a percent of visits.
    public var bounceRate: Double {
        visits.value > 0 ? bounces.value / visits.value * 100 : 0
    }

    /// The percent change of the bounce rate, from the changes of visits and bounces.
    public var bounceRateChange: Double? {
        guard let prevVisits = Self.previous(visits), let prevBounces = Self.previous(bounces), prevVisits > 0 else {
            return nil
        }
        let previous = prevBounces / prevVisits * 100
        guard previous != 0 else { return nil }
        return (bounceRate - previous) / previous * 100
    }

    private static func previous(_ stat: Stat) -> Double? {
        guard let change = stat.change else { return nil }
        let factor = 1 + change / 100
        return factor > 0 ? stat.value / factor : nil
    }
}

public struct Timeseries: Codable, Equatable, Sendable {
    public var pageviews: [Point]?
    public var visitors: [Point]?

    public init(pageviews: [Point]? = nil, visitors: [Point]? = nil) {
        self.pageviews = pageviews
        self.visitors = visitors
    }
}

/// GET /api/websites/:id/stats/overview.
public struct Overview: Codable, Equatable, Sendable {
    public var stats = OverviewStats()
    public var metrics: [Point]?
    public var timeseries: Timeseries?

    public init(stats: OverviewStats = OverviewStats(), metrics: [Point]? = nil, timeseries: Timeseries? = nil) {
        self.stats = stats
        self.metrics = metrics
        self.timeseries = timeseries
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stats = try c.decodeIfPresent(OverviewStats.self, forKey: .stats) ?? OverviewStats()
        metrics = try c.decodeIfPresent([Point].self, forKey: .metrics)
        timeseries = try c.decodeIfPresent(Timeseries.self, forKey: .timeseries)
    }

    /// The chart's data: visitors per bucket.
    public var visitorSeries: [Point] { timeseries?.visitors ?? [] }
    public var topPages: [Point] { metrics ?? [] }
}

/// A stats window the panel offers.
public enum Period: String, CaseIterable, Codable, Sendable {
    case day = "24h"
    case week = "7d"
    case month = "30d"

    public var unit: String { self == .day ? "hour" : "day" }

    public var duration: TimeInterval {
        switch self {
        case .day: 24 * 3600
        case .week: 7 * 24 * 3600
        case .month: 30 * 24 * 3600
        }
    }

    /// The API's window ending now, in UTC milliseconds.
    public func range(endingAt now: Date) -> StatsRange {
        let end = Int64((now.timeIntervalSince1970 * 1000).rounded())
        let start = end - Int64(duration * 1000)
        return StatsRange(startAt: start, endAt: end, unit: unit)
    }
}

public struct StatsRange: Equatable, Sendable {
    public var startAt: Int64
    public var endAt: Int64
    public var unit: String

    public init(startAt: Int64, endAt: Int64, unit: String) {
        self.startAt = startAt
        self.endAt = endAt
        self.unit = unit
    }
}

/// What the menu bar shows next to the icon.
public enum TrayMode: String, CaseIterable, Codable, Sendable {
    case online
    case visitors
    case none = "icon"
}
