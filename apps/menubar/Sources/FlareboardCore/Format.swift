import Foundation

/// How a change reads: better, worse, or about the same.
public enum Tone: Sendable {
    case flat, good, bad

    /// Reads a percent change; `lowerIsBetter` flips it, as for the bounce rate.
    public init(change: Double?, lowerIsBetter: Bool = false) {
        guard let change, change.isFinite, abs(change) >= 0.5 else {
            self = .flat
            return
        }
        self = (change > 0) != lowerIsBetter ? .good : .bad
    }
}

extension Texts {
    /// A whole number in the language's way: 12,480, 12.480, 12 480.
    public func count(_ n: Double) -> String {
        guard n.isFinite else { return "—" }
        let f = NumberFormatter()
        f.locale = lang.locale
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: n.rounded())) ?? String(Int(n))
    }

    /// A short number for the menu bar: 842, 1.2k, 2.4M (with the language's decimal mark).
    public func compact(_ n: Double) -> String {
        guard n.isFinite else { return "" }
        let a = abs(n)
        let sign = n < 0 ? "-" : ""
        let (value, suffix): (Double, String) = a >= 1_000_000 ? (a / 1_000_000, "M") : a >= 1000 ? (a / 1000, "k") : (a, "")
        if suffix.isEmpty { return sign + count(a) }
        let f = NumberFormatter()
        f.locale = lang.locale
        f.numberStyle = .decimal
        f.maximumFractionDigits = 1
        f.minimumFractionDigits = 0
        return sign + (f.string(from: NSNumber(value: (value * 10).rounded(.down) / 10)) ?? "") + suffix
    }

    /// Short enough for a third of the panel.
    public func compactCount(_ n: Double) -> String {
        abs(n) >= 100_000 ? compact(n) : count(n)
    }

    /// A percentage given in percent (40 → 40%, 40 %).
    public func percent(_ n: Double, digits: Int = 0) -> String {
        guard n.isFinite else { return "—" }
        let f = NumberFormatter()
        f.locale = lang.locale
        f.numberStyle = .percent
        f.minimumFractionDigits = digits
        f.maximumFractionDigits = digits
        return f.string(from: NSNumber(value: n / 100)) ?? "\(n)%"
    }

    /// A change without its sign, which an arrow shows.
    public func delta(_ change: Double?) -> String? {
        guard let change, change.isFinite else { return nil }
        let a = abs(change)
        return a >= 1000 ? compact(a) + percentSign : percent(a)
    }

    private var percentSign: String {
        switch lang {
        case .de: "\u{00a0}%"
        case .fr: "\u{202f}%"
        default: "%"
        }
    }

    public func visitorCount(_ n: Double) -> String { String(format: visitorsCount, count(n)) }
    public func onlineCount(_ n: Int) -> String { String(format: online, count(Double(n))) }

    public func updatedAgo(_ interval: TimeInterval) -> String {
        if interval < 60 { return updatedNow }
        if interval < 3600 { return String(format: updated, String(format: minutesAgo, Int(interval / 60))) }
        return String(format: updated, String(format: hoursAgo, Int(interval / 3600)))
    }

    /// Names a chart bucket: an hour in the Mac's time zone ("15:00", or "15:00–16:00" in the
    /// tooltip), or a day ("Oct 6", "10月6日", "6. Okt.").
    public func bucketLabel(_ at: Date, unit: String, long: Bool, timeZone: TimeZone = .current) -> String {
        let f = DateFormatter()
        f.locale = lang.locale
        f.timeZone = timeZone
        if unit == "day" {
            f.setLocalizedDateFormatFromTemplate("MMMd")
            return f.string(from: at)
        }
        f.dateFormat = "HH:mm"
        if !long { return f.string(from: at) }
        return f.string(from: at) + "–" + f.string(from: at.addingTimeInterval(3600))
    }

    public func comparedCaption(_ period: Period) -> String {
        compared[Period.allCases.firstIndex(of: period) ?? 0]
    }
}
