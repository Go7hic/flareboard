import AppKit
import FlareboardCore
import Observation
import SwiftUI

/// The menu bar item: a click opens the panel in a popover, a right click shows a menu.
@MainActor
final class StatusController: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private let model: AppModel
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var timer: Timer?

    init(model: AppModel) {
        self.model = model
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        model.openURL = { NSWorkspace.shared.open($0) }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.image = Images.tray
            button.imagePosition = .imageLeading
            button.target = self
            button.action = #selector(clicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self
        popover.contentSize = PanelView.size
        popover.contentViewController = NSHostingController(rootView: PanelView(model: model))

        syncTray()
        if model.connected { model.refresh(reloadSites: true) }
        timer = Timer.scheduledTimer(withTimeInterval: AppModel.livePoll, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.model.tick() }
        }
        // The first update check waits for the app to settle.
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let model = self?.model, model.prefs.autoUpdate,
                  model.now().timeIntervalSince(model.prefs.lastUpdateCheck ?? .distantPast) > AppModel.updateInterval
            else { return }
            model.checkForUpdates(userInitiated: false)
        }
    }

    /// Keeps the title and tooltip next to the icon in step with the model.
    private func syncTray() {
        withObservationTracking {
            let title = model.trayTitle
            statusItem.button?.title = title.isEmpty ? "" : " " + title
            statusItem.button?.toolTip = model.trayTooltip
        } onChange: { [weak self] in
            DispatchQueue.main.async { self?.syncTray() }
        }
    }

    @objc private func clicked() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            showMenu()
        } else {
            togglePopover()
        }
    }

    private func togglePopover() {
        if popover.isShown {
            popover.performClose(nil)
            return
        }
        guard let button = statusItem.button else { return }
        model.panelOpened()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        NSApp.activate(ignoringOtherApps: true)
    }

    func popoverDidClose(_ notification: Notification) {
        model.panelOpen = false
    }

    private func showMenu() {
        if popover.isShown { popover.performClose(nil) }
        let t = model.texts
        let menu = NSMenu()
        menu.addItem(item(t.openFlareboard) { [weak self] in self?.togglePopover() })
        menu.addItem(item(t.openDashboard) { [weak self] in
            if let url = self?.model.dashboardURL { NSWorkspace.shared.open(url) }
        })
        menu.addItem(.separator())
        menu.addItem(item(t.checkUpdates) { [weak self] in
            guard let self else { return }
            model.checkForUpdates(userInitiated: true)
            model.openSettings()
            togglePopover()
        })
        menu.addItem(.separator())
        menu.addItem(item(t.quit, key: "q") { NSApp.terminate(nil) })
        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    private func item(_ title: String, key: String = "", _ action: @escaping () -> Void) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: #selector(MenuAction.run), keyEquivalent: key)
        let target = MenuAction(action)
        item.target = target
        item.representedObject = target
        return item
    }
}

/// A closure as a menu item's target.
private final class MenuAction: NSObject {
    let action: () -> Void
    init(_ action: @escaping () -> Void) { self.action = action }
    @objc func run() { action() }
}

#if DEBUG
if let i = CommandLine.arguments.firstIndex(of: "--snapshots"), i + 1 < CommandLine.arguments.count {
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.accessory)
    Snapshots.run(into: URL(fileURLWithPath: CommandLine.arguments[i + 1]))
    exit(0)
}
#endif

migrateLegacySettings(prefs: DefaultsPrefsStore(), secrets: KeychainSecretStore())
let model = AppModel()
let app = NSApplication.shared
let controller = StatusController(model: model)
app.delegate = controller
app.setActivationPolicy(.accessory)
app.run()
