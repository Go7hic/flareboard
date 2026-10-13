import AppKit
import FlareboardCore
import SwiftUI

/// Colors beyond the system's: the chart's series color and the status colors match the
/// dashboard's tokens (--chart-1, Geist green and red), in each appearance.
enum Palette {
    static let series = dynamic(light: 0x006BFF, dark: 0x006EFE)
    static let good = dynamic(light: 0x297A3A, dark: 0x62C073)
    static let bad = dynamic(light: 0xCB2A2F, dark: 0xFF6166)
    static let live = dynamic(light: 0x28A948, dark: 0x00AC3A)

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let hex = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        })
    }

    static func tone(_ tone: Tone) -> Color {
        switch tone {
        case .good: good
        case .bad: bad
        case .flat: .secondary
        }
    }
}

enum Images {
    static let mark: NSImage = NSImage(data: markPNG) ?? NSImage()

    /// The menu bar's template image, 18 points tall as macOS draws status items.
    static let tray: NSImage = {
        let image = NSImage(data: trayPNG) ?? NSImage()
        if let rep = image.representations.first {
            image.size = NSSize(width: CGFloat(rep.pixelsWide) / 2, height: CGFloat(rep.pixelsHigh) / 2)
        }
        image.isTemplate = true
        return image
    }()
}

struct LogoMark: View {
    var size: CGFloat
    var body: some View {
        Image(nsImage: Images.mark)
            .resizable()
            .interpolation(.high)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// A change with an arrow, so it never relies on color alone.
struct DeltaChip: View {
    let texts: Texts
    let change: Double?
    var lowerIsBetter = false
    var large = false

    var body: some View {
        if let text = texts.delta(change) {
            let tone = Tone(change: change, lowerIsBetter: lowerIsBetter)
            let color = Palette.tone(tone)
            HStack(spacing: 2) {
                Image(systemName: tone == .flat ? "minus" : (change ?? 0) > 0 ? "arrow.up" : "arrow.down")
                    .font(.system(size: large ? 10 : 9, weight: .bold))
                Text(text)
                    .font(.system(size: large ? 12 : 11, weight: .semibold))
                    .monospacedDigit()
            }
            .foregroundStyle(color)
            .padding(.horizontal, large ? 6 : 0)
            .padding(.vertical, large ? 2 : 0)
            .background {
                if large { RoundedRectangle(cornerRadius: 5).fill(color.opacity(0.12)) }
            }
            .fixedSize()
        }
    }
}

/// A square button showing a symbol, which fills as the pointer goes over it.
struct IconButton: View {
    let symbol: String
    let label: String
    var spinning = false
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .medium))
                .rotationEffect(.degrees(spinning ? 360 : 0))
                .animation(spinning ? .linear(duration: 0.9).repeatForever(autoreverses: false) : .default, value: spinning)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
                .foregroundStyle(hovering ? .primary : .secondary)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(hovering ? 0.07 : 0)))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(label)
        .accessibilityLabel(label)
    }
}

/// A quiet button of text, with a symbol after it or not.
struct TextButton: View {
    let title: String
    var symbol: String?
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(title).font(.system(size: 12, weight: .medium)).lineLimit(1)
                if let symbol {
                    Image(systemName: symbol).font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(hovering ? 0.07 : 0)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

/// A block standing in for content that is loading.
struct Placeholder: View {
    var width: CGFloat?
    var height: CGFloat
    var body: some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Color.primary.opacity(0.07))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}
