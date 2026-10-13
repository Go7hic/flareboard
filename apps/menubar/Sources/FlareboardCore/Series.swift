import Foundation

/// One point of the chart: the start of its hour or day, and its value, zero where the API
/// sent none.
public struct Bucket: Equatable, Sendable {
    public var at: Date
    public var value: Double

    public init(at: Date, value: Double) {
        self.at = at
        self.value = value
    }
}

/// Lays the API's points on every bucket of the range. The API leaves out hours and days
/// without events, and keys hours in UTC ("2026-10-12 14:00") and days in the website's time
/// zone ("2026-10-12").
public func fillSeries(_ points: [Point], range: StatsRange, timezone: String?) -> [Bucket] {
    let byDay = range.unit == "day"
    var calendar = Calendar(identifier: .gregorian)
    let utc = TimeZone(identifier: "UTC")!
    calendar.timeZone = byDay ? (timezone.flatMap(TimeZone.init(identifier:)) ?? utc) : utc

    let key = DateFormatter()
    key.calendar = calendar
    key.timeZone = calendar.timeZone
    key.locale = Locale(identifier: "en_US_POSIX")
    key.dateFormat = byDay ? "yyyy-MM-dd" : "yyyy-MM-dd HH:00"

    var values: [String: Double] = [:]
    for p in points {
        if let at = parseBucket(p.x, timeZone: calendar.timeZone) {
            values[key.string(from: at), default: 0] += p.y
        }
    }

    let start = Date(timeIntervalSince1970: TimeInterval(range.startAt) / 1000)
    let end = Date(timeIntervalSince1970: TimeInterval(range.endAt) / 1000)
    let component: Calendar.Component = byDay ? .day : .hour
    guard var at = calendar.dateInterval(of: component, for: start)?.start else { return [] }
    var out: [Bucket] = []
    while at <= end, out.count < 400 {
        out.append(Bucket(at: at, value: values[key.string(from: at)] ?? 0))
        guard let next = calendar.date(byAdding: component, value: 1, to: at) else { break }
        at = next
    }
    return out
}

func parseBucket(_ raw: String, timeZone: TimeZone) -> Date? {
    let x = raw.trimmingCharacters(in: .whitespaces)
    let iso = ISO8601DateFormatter()
    if let d = iso.date(from: x) { return d }
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = timeZone
    for layout in ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"] {
        f.dateFormat = layout
        if let d = f.date(from: x) { return d }
    }
    return nil
}
