import Charts
import FlareboardCore
import SwiftUI

struct StatsView: View {
    @Bindable var model: AppModel

    var body: some View {
        let t = model.texts
        VStack(spacing: 0) {
            header(t)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let error = model.error { ErrorBanner(texts: t, message: error) { model.refresh(reloadSites: model.websites.isEmpty) } }
                    if let overview = model.overview {
                        Hero(model: model, stats: overview.stats)
                        TrendChart(texts: t, buckets: model.buckets, unit: model.range.unit, period: model.prefs.period)
                        KPIStrip(texts: t, stats: overview.stats)
                        TopPages(texts: t, pages: overview.topPages, website: model.website) { model.openURL($0) }
                    } else if model.loading {
                        StatsSkeleton()
                    } else if model.websites.isEmpty, model.error == nil, model.fetchedAt != nil || model.account != nil {
                        NoWebsites(texts: t) { if let url = consolePage(console: model.prefs.consoleURL, path: "/websites") { model.openURL(url) } }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 14)
            }
            .scrollIndicators(.never)
            UpdateBar(model: model)
            footer(t)
        }
    }

    private func header(_ t: Texts) -> some View {
        HStack(spacing: 2) {
            if model.websites.isEmpty {
                siteLabel(t).padding(.horizontal, 6).padding(.vertical, 4)
            } else {
                siteMenu(t)
            }
            Spacer(minLength: 8)
            IconButton(symbol: "arrow.clockwise", label: t.refresh, spinning: model.loading) {
                if !model.loading { model.refresh() }
            }
            .keyboardShortcut("r")
            IconButton(symbol: "slider.horizontal.3", label: t.settings) { model.openSettings() }
                .keyboardShortcut(",")
        }
        .padding(.horizontal, 10)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }

    private func siteLabel(_ t: Texts) -> some View {
        HStack(spacing: 8) {
            LogoMark(size: 20)
            Text(model.website?.displayName ?? t.title)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
        }
    }

    private func siteMenu(_ t: Texts) -> some View {
        Menu {
            ForEach(model.websites) { site in
                Toggle(site.displayName, isOn: Binding(get: { site.id == model.prefs.websiteID }, set: { _ in model.pickWebsite(site.id) }))
            }
            Divider()
            Button(t.addWebsite) { if let url = consolePage(console: model.prefs.consoleURL, path: "/websites") { model.openURL(url) } }
        } label: {
            HStack(spacing: 8) {
                siteLabel(t)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .help(t.switchWebsite)
    }

    private func footer(_ t: Texts) -> some View {
        VStack(spacing: 0) {
            Divider()
            HStack {
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    if let at = model.fetchedAt {
                        Text(t.updatedAgo(context.date.timeIntervalSince(at)))
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer()
                TextButton(title: t.openDashboard, symbol: "arrow.up.right") {
                    if let url = model.dashboardURL { model.openURL(url) }
                }
            }
            .padding(.leading, 16)
            .padding(.trailing, 10)
            .padding(.vertical, 7)
        }
    }
}

private struct Hero: View {
    @Bindable var model: AppModel
    let stats: OverviewStats

    var body: some View {
        let t = model.texts
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(t.visitors).font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Text(t.count(stats.visitors.value))
                        .font(.system(size: 30, weight: .semibold))
                        .tracking(-0.6)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .contentTransition(.numericText())
                    DeltaChip(texts: t, change: stats.visitors.change, large: true)
                }
                if stats.visitors.change != nil {
                    Text(t.comparedCaption(model.prefs.period)).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 10) {
                Picker(t.period, selection: Binding(get: { model.prefs.period }, set: { model.setPeriod($0) })) {
                    ForEach(Array(Period.allCases.enumerated()), id: \.element) { i, p in
                        Text(t.periods[i]).tag(p)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .controlSize(.small)
                .fixedSize()
                if let live = model.live {
                    HStack(spacing: 6) {
                        Circle().fill(live > 0 ? Palette.live : Color.secondary.opacity(0.5)).frame(width: 7, height: 7)
                        Text(t.onlineCount(live)).font(.system(size: 12, weight: .medium)).monospacedDigit().lineLimit(1)
                    }
                    .padding(.trailing, 2)
                }
            }
        }
    }
}

private struct TrendChart: View {
    let texts: Texts
    let buckets: [Bucket]
    let unit: String
    let period: Period
    @State private var selected: Date?

    private var hovered: Bucket? {
        guard let selected, !buckets.isEmpty else { return nil }
        return buckets.min { abs($0.at.timeIntervalSince(selected)) < abs($1.at.timeIntervalSince(selected)) }
    }

    var body: some View {
        let t = texts
        let peak = buckets.map(\.value).max() ?? 0
        VStack(spacing: 6) {
            Chart {
                ForEach(buckets, id: \.at) { b in
                    AreaMark(x: .value("Time", b.at), y: .value(t.visitors, b.value))
                        .interpolationMethod(.monotone)
                        .foregroundStyle(Palette.series.opacity(peak > 0 ? 0.1 : 0))
                    LineMark(x: .value("Time", b.at), y: .value(t.visitors, b.value))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                        .foregroundStyle(Palette.series.opacity(peak > 0 ? 1 : 0))
                }
                if let h = hovered, peak > 0 {
                    RuleMark(x: .value("Time", h.at))
                        .foregroundStyle(Color.secondary.opacity(0.5))
                        .lineStyle(StrokeStyle(lineWidth: 1))
                        .annotation(position: .top, spacing: 2, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(t.bucketLabel(h.at, unit: unit, long: true)).font(.system(size: 10)).foregroundStyle(.secondary)
                                Text(t.visitorCount(h.value)).font(.system(size: 12, weight: .semibold)).monospacedDigit()
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .background(RoundedRectangle(cornerRadius: 6).fill(.background).shadow(color: .black.opacity(0.12), radius: 6, y: 2))
                            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.1)))
                        }
                    PointMark(x: .value("Time", h.at), y: .value(t.visitors, h.value))
                        .symbolSize(50)
                        .foregroundStyle(Palette.series)
                }
            }
            .chartXSelection(value: $selected)
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartYScale(domain: 0...max(peak * 1.12, 1))
            .chartPlotStyle { $0.overlay(alignment: .bottom) { Rectangle().fill(Color.primary.opacity(0.1)).frame(height: 1) } }
            .overlay {
                if peak == 0 {
                    Text(t.noVisitors[Period.allCases.firstIndex(of: period) ?? 0]).font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }
            .frame(height: 84)
            .accessibilityLabel(t.chartLabel)
            if buckets.count >= 2 {
                HStack {
                    Text(t.bucketLabel(buckets[0].at, unit: unit, long: false)).frame(maxWidth: .infinity, alignment: .leading)
                    Text(t.bucketLabel(buckets[buckets.count / 2].at, unit: unit, long: false)).frame(maxWidth: .infinity)
                    Text(unit == "day" ? t.today : t.now).frame(maxWidth: .infinity, alignment: .trailing)
                }
                .font(.system(size: 10))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
    }
}

private struct KPIStrip: View {
    let texts: Texts
    let stats: OverviewStats

    var body: some View {
        let t = texts
        let rate = stats.bounceRate
        HStack(spacing: 0) {
            cell(t.pageviews, t.compactCount(stats.pageviews.value), stats.pageviews.change)
            Divider()
            cell(t.visits, t.compactCount(stats.visits.value), stats.visits.change)
            Divider()
            cell(t.bounce, t.percent(rate, digits: rate > 0 && rate < 10 ? 1 : 0), stats.bounceRateChange, lowerIsBetter: true)
        }
        .fixedSize(horizontal: false, vertical: true)
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.1)))
    }

    private func cell(_ label: String, _ value: String, _ change: Double?, lowerIsBetter: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
            HStack(spacing: 5) {
                Text(value).font(.system(size: 14, weight: .semibold)).monospacedDigit().lineLimit(1)
                DeltaChip(texts: texts, change: change, lowerIsBetter: lowerIsBetter)
            }
            // Never cut a number: the cells take the room their values need.
            .fixedSize()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct TopPages: View {
    let texts: Texts
    let pages: [Point]
    let website: Website?
    let open: (URL) -> Void

    var body: some View {
        if !pages.isEmpty {
            let top = pages.map(\.y).max() ?? 0
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(texts.topPages).font(.system(size: 12, weight: .semibold))
                    Spacer()
                    Text(texts.views).font(.system(size: 11)).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 2)
                ForEach(Array(pages.enumerated()), id: \.offset) { _, page in
                    PageRow(texts: texts, path: page.x.isEmpty ? "/" : page.x, views: page.y, share: top > 0 ? page.y / top : 0, url: website?.pageURL(page.x.isEmpty ? "/" : page.x), open: open)
                }
            }
        }
    }
}

private struct PageRow: View {
    let texts: Texts
    let path: String
    let views: Double
    let share: Double
    let url: URL?
    let open: (URL) -> Void
    @State private var hovering = false

    var body: some View {
        Button { if let url { open(url) } } label: {
            HStack(spacing: 8) {
                Text(path).font(.system(size: 12)).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                Text(texts.count(views)).font(.system(size: 12)).monospacedDigit().foregroundStyle(.secondary)
            }
            .padding(.horizontal, 8)
            .frame(height: 26)
            .background(alignment: .leading) {
                GeometryReader { geo in
                    RoundedRectangle(cornerRadius: 5).fill(Palette.series.opacity(0.1)).frame(width: max(geo.size.width * share, 4))
                }
            }
            .background(RoundedRectangle(cornerRadius: 5).fill(Color.primary.opacity(hovering && url != nil ? 0.06 : 0)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(url == nil)
        .onHover { hovering = $0 }
        .help(url.map { String(format: texts.openPage, $0.absoluteString) } ?? path)
    }
}

private struct ErrorBanner: View {
    let texts: Texts
    let message: String
    let retry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.circle").foregroundStyle(.red).padding(.top, 1)
            Text(message).font(.system(size: 12)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            TextButton(title: texts.retry, action: retry)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.red.opacity(0.1)))
    }
}

private struct StatsSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    Placeholder(width: 56, height: 10)
                    Placeholder(width: 120, height: 28)
                    Placeholder(width: 96, height: 10)
                }
                Spacer()
                Placeholder(width: 112, height: 22)
            }
            Placeholder(height: 84)
            Placeholder(height: 52)
            VStack(alignment: .leading, spacing: 6) {
                ForEach([0.9, 0.7, 0.55, 0.4, 0.3], id: \.self) { w in
                    GeometryReader { geo in Placeholder(width: geo.size.width * w, height: 22) }.frame(height: 22)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

private struct NoWebsites: View {
    let texts: Texts
    let add: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "globe").font(.system(size: 26, weight: .light)).foregroundStyle(.secondary).padding(.bottom, 6)
            Text(texts.noSitesTitle).font(.system(size: 14, weight: .semibold))
            Text(texts.noSitesBody).font(.system(size: 12)).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button(texts.addWebsite, action: add).buttonStyle(.borderedProminent).padding(.top, 8)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }
}

/// Offers a new version at the bottom of the panel.
private struct UpdateBar: View {
    @Bindable var model: AppModel

    var body: some View {
        let t = model.texts
        switch model.updateStatus {
        case .available(let r):
            bar {
                Text(String(format: t.updateAvailable, r.version)).lineLimit(1)
                Spacer()
                Button(t.installUpdate) { model.installUpdate() }.controlSize(.small)
            }
        case .downloading(_, let p):
            bar {
                Text(String(format: t.downloading, Int(p * 100)))
                Spacer()
                ProgressView(value: p).frame(width: 90).controlSize(.small)
            }
        case .ready, .installing:
            bar { Text(t.installing); Spacer(); ProgressView().controlSize(.small) }
        default:
            EmptyView()
        }
    }

    private func bar(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 8) { content() }
                .font(.system(size: 12))
                .padding(.horizontal, 16)
                .padding(.vertical, 7)
                .background(Palette.series.opacity(0.06))
        }
    }
}
